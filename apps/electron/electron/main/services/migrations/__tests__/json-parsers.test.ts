/**
 * Unit tests for JSON parsers (V11 migration)
 */

import { describe, it, expect } from 'vitest'
import { parseActionItems, parseDecisions, parseFollowUps } from '../json-parsers'

describe('parseActionItems', () => {
  it('should handle null input', () => {
    const result = parseActionItems(null)
    expect(result).toEqual([])
  })

  it('should handle empty string', () => {
    const result = parseActionItems('')
    expect(result).toEqual([])
  })

  it('should handle empty array', () => {
    const result = parseActionItems('[]')
    expect(result).toEqual([])
  })

  it('should parse array format', () => {
    const json = JSON.stringify([
      { text: 'Complete report', assignee: 'John', priority: 'high' }
    ])
    const result = parseActionItems(json)
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('Complete report')
    expect(result[0].assignee).toBe('John')
  })

  it('should handle legacy field names', () => {
    const json = JSON.stringify([{ task: 'Fix bug', assigned_to: 'Bob' }])
    const result = parseActionItems(json)
    expect(result[0].text).toBe('Fix bug')
    expect(result[0].assignee).toBe('Bob')
  })

  it('should handle invalid JSON gracefully', () => {
    const result = parseActionItems('invalid json')
    expect(result).toEqual([])
  })

  it('should parse array of strings', () => {
    const json = JSON.stringify(['Task 1', 'Task 2'])
    const result = parseActionItems(json)
    expect(result).toHaveLength(2)
    expect(result[0].text).toBe('Task 1')
  })
})

describe('parseDecisions', () => {
  it('should handle null input', () => {
    const result = parseDecisions(null)
    expect(result).toEqual([])
  })

  it('should parse decisions with context', () => {
    const json = JSON.stringify([
      { text: 'Use TypeScript', context: 'Better type safety', made_by: 'Tech Lead' }
    ])
    const result = parseDecisions(json)
    expect(result[0].text).toBe('Use TypeScript')
    expect(result[0].context).toBe('Better type safety')
  })

  it('should handle legacy field names', () => {
    const json = JSON.stringify([{ decision: 'Use microservices' }])
    const result = parseDecisions(json)
    expect(result[0].text).toBe('Use microservices')
  })
})

describe('parseFollowUps', () => {
  it('should handle null input', () => {
    const result = parseFollowUps(null)
    expect(result).toEqual([])
  })

  it('should parse follow-ups with owner and date', () => {
    const json = JSON.stringify([
      { text: 'Schedule meeting', with_person: 'PM', due_date: '2024-12-25' }
    ])
    const result = parseFollowUps(json)
    expect(result[0].text).toBe('Schedule meeting')
    expect(result[0].with_person).toBe('PM')
  })

  it('should handle legacy field names', () => {
    const json = JSON.stringify([{ follow_up: 'Send updates', person: 'Manager' }])
    const result = parseFollowUps(json)
    expect(result[0].text).toBe('Send updates')
    expect(result[0].with_person).toBe('Manager')
  })
})
