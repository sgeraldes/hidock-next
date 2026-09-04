// Arm (c) prompt: rules-not-exemplars (fixes few-shot bleed) + explicit
// anti-hallucination instruction (fixes fabrication-under-pressure directly,
// not by relying on a bigger model to absorb it). Designed for gemma3:12b.
export function improvedPromptC(transcript, meta) {
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
