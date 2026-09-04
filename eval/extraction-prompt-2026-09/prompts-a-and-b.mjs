// The CURRENT prompt (verbatim from packages/knowledge-graph/src/extract.ts buildPrompt).
export function currentPrompt(transcript, meta) {
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

// The IMPROVED prompt. Targets the observed failure modes on llama3.2:
//  - literal "string" echoes  -> placeholders are <angle-bracket> descriptors, never "string"
//  - verb-fragments           -> explicit "self-contained sentence" rule + good/bad examples
//  - decision/action bleed     -> sharp definitions distinguishing the two + "never list the same item as both"
//  - hallucinated owners       -> "omit owner unless explicitly named"
export function improvedPrompt(transcript, meta) {
  return `You are a meeting intelligence analyst. Read the meeting transcript and extract structured knowledge that will be stored and searched later, so every item must stand on its own without the transcript next to it.

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

DEFINITIONS (read carefully — decisions and action_items are different):
- A DECISION is a choice the group CONCLUDED (a course of action selected, an option rejected, a stance agreed). Write WHAT was decided and, when stated, the SUBJECT it concerns. It is about a conclusion, not a task.
- An ACTION_ITEM is a concrete TASK someone is expected to DO after the meeting. It is about future work, usually attributable to a person.
- The SAME item must never appear in both decisions and action_items. If it is a settled choice, it is a decision; if it is work to be done, it is an action_item.

RULES:
- Write each decision, action_item, risk, and next_step as a COMPLETE, SELF-CONTAINED sentence a reader could understand months later with no other context. Include the subject/object — never a bare verb phrase.
  GOOD decision: "The team will keep the existing map because no path specification is available yet."
  BAD decision (do NOT do this): "Keep the map", "use error code 12", "prioritize ticket".
  GOOD action_item: "Kelly will sync with Nick about the multi-part file transfer ticket raised on 28 Feb."
  BAD action_item (do NOT do this): "sync with Nick", "prioritize ticket", "put in the dashboard".
- Prefer FEWER, HIGHER-QUALITY items over many fragments. If nothing genuinely qualifies, use an empty array [].
- owner / raised_by: include ONLY when a specific person is explicitly named for that item; otherwise omit the field entirely. Never guess an owner.
- Never output the literal word "string" or any placeholder text — only real content drawn from the transcript.
- people: real individuals only (speakers and those referenced by name); skip generic roles like "the team" or "everyone".
- Return ONLY the JSON object.`
}
