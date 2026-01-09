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
