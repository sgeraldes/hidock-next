/**
 * LLM-based extraction of entities and relations from meeting transcripts.
 *
 * The LlmExtractor function is injected — no provider is imported here.
 * Electron will wire this to @hidock/ai-providers; tests inject a stub.
 */

/** Injected LLM function: takes a prompt, returns raw text (may include code fences). */
export type LlmExtractor = (prompt: string) => Promise<string>

export interface PersonEntity {
  name: string
  skills?: string[]
}

export interface ActionItemEntity {
  text: string
  owner?: string
}

export interface RiskEntity {
  text: string
  raised_by?: string
}

export interface ExtractionResult {
  people: PersonEntity[]
  topics: string[]
  projects: string[]
  decisions: string[]
  action_items: ActionItemEntity[]
  risks: RiskEntity[]
  next_steps: string[]
}

export interface ExtractionMeta {
  meetingId: string
  title?: string
  date?: string
}

function buildPrompt(transcript: string, meta: ExtractionMeta): string {
  // Grounded, rules-not-exemplars prompt (eval eval/extraction-prompt-2026-09).
  // Two deliberate design choices, each fixing an observed failure mode:
  //  1. NO verbatim example sentences — a weak model copies them into its output
  //     (few-shot bleed). Guidance is given as RULES instead.
  //  2. An explicit, first-priority GROUNDING rule: extract only what the
  //     transcript states, omit rather than invent. Same "never fabricate"
  //     principle used elsewhere in the pipeline (NULL-not-guessed provenance).
  // Validated on 18 real transcripts with gemma3:12b: 0 example-bleed,
  // 0 hallucinations (incl. the Health Concerns meeting that broke the
  // exemplar-based variant).
  return `You are a meeting intelligence analyst. Read the meeting transcript and extract structured knowledge that will be stored and searched later, so every item must stand on its own without the transcript beside it.

Meeting ID: ${meta.meetingId}${meta.title ? `\nTitle: ${meta.title}` : ''}${meta.date ? `\nDate: ${meta.date}` : ''}

TRANSCRIPT:
${transcript}

Return ONLY a valid JSON object (no markdown, no prose, no code fences) with exactly these keys:
{
  "people": [{ "name": <full name as spoken>, "skills": [<skill or expertise shown>] }],
  "topics": [<subject discussed>],
  "projects": [<named project / workstream / system>],
  "decisions": [<a decision the group settled on, as a full standalone sentence>],
  "action_items": [{ "text": <a task someone will do, as a full standalone sentence>, "owner": <person responsible, if explicitly named> }],
  "risks": [{ "text": <a risk, blocker, or concern>, "raised_by": <person, if named> }],
  "next_steps": [<a planned follow-up that is not yet an assigned task>]
}

DEFINITIONS (decisions and action_items are different):
- A DECISION is a choice the group CONCLUDED — a course of action selected, an option rejected, or a stance agreed. Capture what was decided and the subject it concerns. It is a conclusion, not a task.
- An ACTION_ITEM is a concrete TASK someone is expected to DO after the meeting — future work, usually attributable to a person.
- The SAME item must never appear in both decisions and action_items.

GROUNDING — THIS IS THE MOST IMPORTANT RULE:
- Extract ONLY what the transcript actually states. Every decision, action, risk, and next step must be directly supported by the transcript's own words.
- If the transcript does not clearly state a decision or action, LEAVE IT OUT. Use an empty array []. Extracting nothing for a category is correct and expected when the meeting contained nothing of that kind.
- NEVER invent, infer, or complete a plausible-sounding item that is not explicitly in the transcript. A short, plain fragment taken from what was actually said is CORRECT. A fluent, well-formed sentence that the transcript does not support is WRONG and must not be produced.
- Do NOT carry over content from these instructions or from any other meeting. Only this transcript.
- When in doubt, omit. Fewer faithful items beat more invented ones.

WRITING THE ITEMS:
- Make each item self-contained: include the subject/object, not a bare verb phrase, BUT only using words and facts grounded in this transcript. If the transcript only supports a short phrase, keep it short — do not pad it into a full sentence by adding unstated detail.
- owner / raised_by: include ONLY when a specific person is explicitly named for that item; otherwise omit the field. Never guess.
- people: real named individuals only; skip generic roles like "the team" or "everyone".
- Never output the literal word "string" or any placeholder.
- Return ONLY the JSON object.`
}

/** Strip markdown code fences (e.g. \`\`\`json ... \`\`\` or \`\`\` ... \`\`\`) */
function stripCodeFences(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  return s.trim()
}

function emptyResult(): ExtractionResult {
  return {
    people: [],
    topics: [],
    projects: [],
    decisions: [],
    action_items: [],
    risks: [],
    next_steps: [],
  }
}

function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return []
  return val.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

function asObj(val: unknown): Record<string, unknown> | null {
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    return val as Record<string, unknown>
  }
  return null
}

/**
 * Normalized key for within-result de-duplication. A weak model often emits the
 * SAME decision/action several times in one meeting's output (observed: an item
 * repeated 3x-5x, sometimes as both a decision and an action). Collapsing them
 * here — before the result reaches graph ingest OR the first-class-table promote
 * — stops repeated model output becoming repeated DB rows. Case-, punctuation-,
 * and whitespace-insensitive; mirrors the normalize() used downstream.
 */
function dedupKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** De-duplicate a string[] by normalized content, preserving first occurrence. */
function dedupStrings(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of items) {
    const k = dedupKey(v)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

/** De-duplicate objects by a normalized string field, preserving first occurrence. */
function dedupBy<T>(items: T[], keyOf: (t: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const v of items) {
    const k = dedupKey(keyOf(v))
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

/** Defensively parse LLM output into ExtractionResult */
function parseExtractionOutput(raw: string): ExtractionResult {
  const cleaned = stripCodeFences(raw)

  // Try to extract the first {...} block if there's prose around it
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  const jsonStr = jsonMatch ? jsonMatch[0] : cleaned

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return emptyResult()
  }

  const obj = asObj(parsed)
  if (!obj) return emptyResult()

  const people: PersonEntity[] = []
  if (Array.isArray(obj['people'])) {
    for (const item of obj['people'] as unknown[]) {
      const p = asObj(item)
      if (!p) continue
      const name = typeof p['name'] === 'string' ? p['name'].trim() : ''
      if (!name) continue
      people.push({ name, skills: asStringArray(p['skills']) })
    }
  }

  const action_items: ActionItemEntity[] = []
  if (Array.isArray(obj['action_items'])) {
    for (const item of obj['action_items'] as unknown[]) {
      const a = asObj(item)
      if (!a) continue
      const text = typeof a['text'] === 'string' ? a['text'].trim() : ''
      if (!text) continue
      const owner = typeof a['owner'] === 'string' ? a['owner'].trim() : undefined
      action_items.push({ text, owner: owner || undefined })
    }
  }

  const risks: RiskEntity[] = []
  if (Array.isArray(obj['risks'])) {
    for (const item of obj['risks'] as unknown[]) {
      const r = asObj(item)
      if (!r) continue
      const text = typeof r['text'] === 'string' ? r['text'].trim() : ''
      if (!text) continue
      const raised_by = typeof r['raised_by'] === 'string' ? r['raised_by'].trim() : undefined
      risks.push({ text, raised_by: raised_by || undefined })
    }
  }

  // De-duplicate every list within THIS meeting's result before returning, so a
  // model that repeats the same item several times does not create duplicate
  // graph nodes or duplicate first-class decision/action rows downstream.
  return {
    people: dedupBy(people, (p) => p.name),
    topics: dedupStrings(asStringArray(obj['topics'])),
    projects: dedupStrings(asStringArray(obj['projects'])),
    decisions: dedupStrings(asStringArray(obj['decisions'])),
    action_items: dedupBy(action_items, (a) => a.text),
    risks: dedupBy(risks, (r) => r.text),
    next_steps: dedupStrings(asStringArray(obj['next_steps'])),
  }
}

export async function extractGraphFromTranscript(
  transcript: string,
  meta: ExtractionMeta,
  llm: LlmExtractor
): Promise<ExtractionResult> {
  const prompt = buildPrompt(transcript, meta)
  const raw = await llm(prompt)
  return parseExtractionOutput(raw)
}
