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
  return `You are a meeting intelligence assistant. Analyze the following meeting transcript and extract structured information.

Meeting ID: ${meta.meetingId}${meta.title ? `\nTitle: ${meta.title}` : ''}${meta.date ? `\nDate: ${meta.date}` : ''}

TRANSCRIPT:
${transcript}

Return ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "people": [{ "name": "string", "skills": ["string"] }],
  "topics": ["string"],
  "projects": ["string"],
  "decisions": ["string"],
  "action_items": [{ "text": "string", "owner": "string" }],
  "risks": [{ "text": "string", "raised_by": "string" }],
  "next_steps": ["string"]
}

Rules:
- people: all persons mentioned (speakers and referenced individuals). Include skills they demonstrated.
- topics: main subjects discussed
- projects: specific project names mentioned
- decisions: explicit decisions made
- action_items: tasks assigned, include owner if identifiable
- risks: risks raised or discussed
- next_steps: follow-up actions or items
- Use empty arrays [] for categories with no data.
- Return ONLY the JSON object, nothing else.`
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

  return {
    people,
    topics: asStringArray(obj['topics']),
    projects: asStringArray(obj['projects']),
    decisions: asStringArray(obj['decisions']),
    action_items,
    risks,
    next_steps: asStringArray(obj['next_steps']),
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
