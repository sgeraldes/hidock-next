/**
 * Output Templates
 *
 * Hardcoded templates for generating meeting outputs.
 * These are constants, not stored in the database.
 */

export const OUTPUT_TEMPLATES = {
  meeting_minutes: {
    id: 'meeting_minutes',
    name: 'Meeting Minutes',
    description: 'Formal meeting minutes with attendees, agenda, discussion, decisions, and action items',
    prompt: `Generate formal meeting minutes from this transcript.

Structure the output as:
## Meeting Minutes
**Date:** [date]
**Attendees:** [list]

### Agenda
[inferred from discussion]

### Discussion
[key points discussed]

### Decisions Made
[numbered list]

### Action Items
[who, what, when]

Transcript:
{transcript}`
  },

  interview_feedback: {
    id: 'interview_feedback',
    name: 'Interview Feedback',
    description: 'Structured candidate assessment for interview debriefs',
    prompt: `Generate interview feedback from this transcript.

Structure the output as:
## Interview Feedback
**Candidate:** [name if mentioned]
**Date:** [date]
**Interviewers:** [list]

### Technical Skills
[assessment with evidence]

### Communication
[assessment with evidence]

### Culture Fit
[assessment with evidence]

### Strengths
[bullet points]

### Areas of Concern
[bullet points]

### Recommendation
[Hire / No Hire / Maybe with reasoning]

Transcript:
{transcript}`
  },

  project_status: {
    id: 'project_status',
    name: 'Project Status Report',
    description: 'Progress summary with blockers and next steps',
    prompt: `Generate a project status report from these meeting transcripts.

Structure the output as:
## Project Status Report
**Project:** {project_name}
**Period:** [date range]

### Summary
[2-3 sentence overview]

### Progress
[what was accomplished]

### Blockers
[current impediments]

### Next Steps
[planned actions]

### Key Decisions
[decisions made in these meetings]

Transcripts:
{transcripts}`
  },

  action_items: {
    id: 'action_items',
    name: 'Action Items Summary',
    description: 'Consolidated list of action items from meeting(s)',
    prompt: `Extract all action items from this transcript.

Format as:
## Action Items

| Owner | Action | Due Date | Status |
|-------|--------|----------|--------|
| [name] | [task] | [date if mentioned] | Pending |

Be specific about who owns each action. If no owner mentioned, mark as "TBD".

Transcript:
{transcript}`
  },

  claude_code_prompt: {
    id: 'claude_code_prompt',
    name: 'Claude Code Handoff Prompt',
    description: 'Ready-to-paste prompt for a Claude Code session to execute the follow-up work from this call',
    prompt: `You are preparing a HANDOFF PROMPT: a self-contained prompt that the user will paste into a Claude Code (AI coding agent) session to execute the follow-up work from this call. The agent will NOT have access to the recording — everything it needs must be in the prompt.

First, classify the call as one of: sales-to-delivery handoff, project/technical kickoff, engineering/working session, status/review call, demo, interview, 1:1, other.

Then write the handoff prompt with this structure (fill every section from the transcript; write "None mentioned" when truly absent):

# Follow-up: [short title of the call]

## Context
[2-4 sentences: what this call was, who participated (names/roles), what was decided at a high level. Written so an agent with zero prior context understands.]

## Call type: [classification]

## Objective for this session
[The single most valuable thing to produce next, based on the call type:
- sales-to-delivery → draft the Solution Design Document (SDD) / delivery plan
- kickoff → scaffold the project: repo structure, initial specs, backlog
- engineering session → implement or spec the discussed changes
- status/review → updated status report + remediation tasks for blockers
- demo → capture feedback into issues/backlog items
- interview → structured interview feedback document
State it as a direct instruction to the agent.]

## Facts and requirements from the call
[Bulleted, exhaustive: every technical detail, constraint, name, system, integration, deadline, budget/scope statement mentioned. Quote exact figures and names.]

## Decisions made
[Numbered list with who decided, if identifiable.]

## Action items
| Owner | Action | Due |
|-------|--------|-----|

## Open questions to resolve
[Things left ambiguous in the call that the agent should ask the user or flag.]

## Suggested first steps
[3-5 concrete steps the agent should take, in order.]

Output ONLY the handoff prompt in markdown. Do not add commentary before or after.

Transcript:
{transcript}`
  }
} as const

export type OutputTemplateId = keyof typeof OUTPUT_TEMPLATES

export interface OutputTemplate {
  id: OutputTemplateId
  name: string
  description: string
  prompt: string
}

/**
 * Get all available templates
 */
export function getTemplates(): OutputTemplate[] {
  return Object.values(OUTPUT_TEMPLATES) as OutputTemplate[]
}

/**
 * Get a specific template by ID
 */
export function getTemplate(id: OutputTemplateId): OutputTemplate | undefined {
  return OUTPUT_TEMPLATES[id] as OutputTemplate | undefined
}
