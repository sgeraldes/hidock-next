/**
 * JSON Parsers for Migration V11
 *
 * Safely parse JSON fields from legacy transcript data and extract structured items.
 * These parsers handle malformed JSON gracefully and return typed results.
 */

export interface ActionItem {
  id: string
  text: string
  assignee?: string
  due_date?: string
  status: 'pending' | 'completed'
  priority?: 'low' | 'medium' | 'high'
}

export interface Decision {
  id: string
  text: string
  made_by?: string
  context?: string
  impact?: string
}

export interface FollowUp {
  id: string
  text: string
  with_person?: string
  due_date?: string
  status: 'pending' | 'completed'
}

/**
 * Parse action_items JSON field from transcript
 * Handles various formats:
 * - Array of strings: ["task1", "task2"]
 * - Array of objects: [{text: "task1", assignee: "John"}, ...]
 * - Malformed JSON: returns empty array
 */
export function parseActionItems(jsonString: string | null | undefined): ActionItem[] {
  if (!jsonString) return []

  try {
    const parsed = JSON.parse(jsonString)

    // Handle array of strings
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
      return parsed.map((text, index) => ({
        id: crypto.randomUUID(),
        text: text.trim(),
        status: 'pending' as const
      }))
    }

    // Handle array of objects
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      return parsed.map(item => ({
        id: crypto.randomUUID(),
        text: item.text || item.action || item.task || String(item),
        assignee: item.assignee || item.owner || item.assigned_to,
        due_date: item.due_date || item.deadline || item.due,
        status: (item.status === 'completed' || item.done === true) ? 'completed' as const : 'pending' as const,
        priority: item.priority || undefined
      }))
    }

    // Single string
    if (typeof parsed === 'string') {
      return [{
        id: crypto.randomUUID(),
        text: parsed.trim(),
        status: 'pending' as const
      }]
    }

    return []
  } catch (error) {
    console.warn('[JsonParser] Failed to parse action_items:', error)
    return []
  }
}

/**
 * Parse decisions JSON field from transcript
 * Extracts key decisions made during the meeting
 */
export function parseDecisions(jsonString: string | null | undefined): Decision[] {
  if (!jsonString) return []

  try {
    const parsed = JSON.parse(jsonString)

    // Handle array of strings
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
      return parsed.map((text) => ({
        id: crypto.randomUUID(),
        text: text.trim()
      }))
    }

    // Handle array of objects
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      return parsed.map(item => ({
        id: crypto.randomUUID(),
        text: item.text || item.decision || String(item),
        made_by: item.made_by || item.decider || item.owner,
        context: item.context || item.rationale,
        impact: item.impact || item.effects
      }))
    }

    // Single string
    if (typeof parsed === 'string') {
      return [{
        id: crypto.randomUUID(),
        text: parsed.trim()
      }]
    }

    return []
  } catch (error) {
    console.warn('[JsonParser] Failed to parse decisions:', error)
    return []
  }
}

/**
 * Parse follow-ups from action items or dedicated field
 * Follow-ups are action items that involve communicating with someone
 */
export function parseFollowUps(jsonString: string | null | undefined): FollowUp[] {
  if (!jsonString) return []

  try {
    const parsed = JSON.parse(jsonString)

    // Handle array of strings
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
      return parsed.map((text) => ({
        id: crypto.randomUUID(),
        text: text.trim(),
        status: 'pending' as const
      }))
    }

    // Handle array of objects
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      return parsed.map(item => ({
        id: crypto.randomUUID(),
        text: item.text || item.followup || item.follow_up || String(item),
        with_person: item.with_person || item.person || item.contact,
        due_date: item.due_date || item.deadline,
        status: (item.status === 'completed' || item.done === true) ? 'completed' as const : 'pending' as const
      }))
    }

    // Single string
    if (typeof parsed === 'string') {
      return [{
        id: crypto.randomUUID(),
        text: parsed.trim(),
        status: 'pending' as const
      }]
    }

    return []
  } catch (error) {
    console.warn('[JsonParser] Failed to parse follow_ups:', error)
    return []
  }
}

/**
 * Extract follow-ups from action items by detecting communication keywords
 */
export function extractFollowUpsFromActionItems(actionItems: ActionItem[]): FollowUp[] {
  const followUpKeywords = [
    'follow up',
    'followup',
    'reach out',
    'contact',
    'call',
    'email',
    'meet with',
    'schedule',
    'send to',
    'notify',
    'update'
  ]

  const followUps: FollowUp[] = []

  for (const item of actionItems) {
    const textLower = item.text.toLowerCase()
    const isFollowUp = followUpKeywords.some(keyword => textLower.includes(keyword))

    if (isFollowUp) {
      followUps.push({
        id: crypto.randomUUID(),
        text: item.text,
        with_person: item.assignee,
        due_date: item.due_date,
        status: item.status
      })
    }
  }

  return followUps
}
