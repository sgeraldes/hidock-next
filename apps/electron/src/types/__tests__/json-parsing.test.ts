import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseJsonArray, parseAttendees } from '../index'

describe('parseJsonArray', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  describe('null/undefined inputs', () => {
    it('should return empty array for null', () => {
      const result = parseJsonArray(null)
      expect(result).toEqual([])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should return empty array for undefined', () => {
      const result = parseJsonArray(undefined)
      expect(result).toEqual([])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should return empty array for empty string', () => {
      const result = parseJsonArray('')
      expect(result).toEqual([])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })
  })

  describe('valid arrays', () => {
    it('should parse valid string array', () => {
      const result = parseJsonArray<string>('["foo", "bar", "baz"]')
      expect(result).toEqual(['foo', 'bar', 'baz'])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should parse valid number array', () => {
      const result = parseJsonArray<number>('[1, 2, 3]')
      expect(result).toEqual([1, 2, 3])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should parse valid object array', () => {
      const result = parseJsonArray<{ id: string }>('[{"id": "1"}, {"id": "2"}]')
      expect(result).toEqual([{ id: '1' }, { id: '2' }])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should parse empty array', () => {
      const result = parseJsonArray('[]')
      expect(result).toEqual([])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })
  })

  describe('non-array JSON values', () => {
    it('should return empty array for JSON object and log warning', () => {
      const result = parseJsonArray('{"key": "value"}')
      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[parseJsonArray] Parsed JSON is not an array, returning empty array',
        { parsed: { key: 'value' } }
      )
    })

    it('should return empty array for JSON string and log warning', () => {
      const result = parseJsonArray('"hello"')
      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[parseJsonArray] Parsed JSON is not an array, returning empty array',
        { parsed: 'hello' }
      )
    })

    it('should return empty array for JSON number and log warning', () => {
      const result = parseJsonArray('42')
      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[parseJsonArray] Parsed JSON is not an array, returning empty array',
        { parsed: 42 }
      )
    })

    it('should return empty array for JSON boolean and log warning', () => {
      const result = parseJsonArray('true')
      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[parseJsonArray] Parsed JSON is not an array, returning empty array',
        { parsed: true }
      )
    })

    it('should return empty array for JSON null and log warning', () => {
      const result = parseJsonArray('null')
      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[parseJsonArray] Parsed JSON is not an array, returning empty array',
        { parsed: null }
      )
    })
  })

  describe('invalid JSON syntax', () => {
    it('should return empty array for malformed JSON and log warning', () => {
      const result = parseJsonArray('{invalid json}')
      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalled()
      expect(consoleWarnSpy.mock.calls[0][0]).toBe('[parseJsonArray] Failed to parse JSON')
    })

    it('should return empty array for unclosed array and log warning', () => {
      const result = parseJsonArray('[1, 2, 3')
      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalled()
      expect(consoleWarnSpy.mock.calls[0][0]).toBe('[parseJsonArray] Failed to parse JSON')
    })

    it('should return empty array for trailing comma and log warning', () => {
      const result = parseJsonArray('[1, 2, 3,]')
      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalled()
      expect(consoleWarnSpy.mock.calls[0][0]).toBe('[parseJsonArray] Failed to parse JSON')
    })
  })
})

describe('parseAttendees', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  describe('null/undefined inputs', () => {
    it('should return empty array for null', () => {
      const result = parseAttendees(null)
      expect(result).toEqual([])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should return empty array for undefined', () => {
      const result = parseAttendees(undefined)
      expect(result).toEqual([])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should return empty array for empty string', () => {
      const result = parseAttendees('')
      expect(result).toEqual([])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })
  })

  describe('valid attendee arrays', () => {
    it('should parse valid attendee array', () => {
      const json = JSON.stringify([
        { name: 'Alice', email: 'alice@example.com', status: 'accepted' },
        { name: 'Bob', email: 'bob@example.com', status: 'declined' }
      ])
      const result = parseAttendees(json)

      expect(result).toEqual([
        { name: 'Alice', email: 'alice@example.com', status: 'accepted' },
        { name: 'Bob', email: 'bob@example.com', status: 'declined' }
      ])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should parse attendees with optional fields', () => {
      const json = JSON.stringify([
        { name: 'Alice' },
        { email: 'bob@example.com' },
        { status: 'tentative' }
      ])
      const result = parseAttendees(json)

      expect(result).toEqual([
        { name: 'Alice' },
        { email: 'bob@example.com' },
        { status: 'tentative' }
      ])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should parse empty attendee array', () => {
      const result = parseAttendees('[]')
      expect(result).toEqual([])
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })
  })

  describe('non-array JSON values', () => {
    it('should return empty array for JSON object and log warning', () => {
      const result = parseAttendees('{"name": "Alice"}')
      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[parseAttendees] Parsed JSON is not an array, returning empty array',
        { parsed: { name: 'Alice' } }
      )
    })

    it('should return empty array for JSON string and log warning', () => {
      const result = parseAttendees('"Alice"')
      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[parseAttendees] Parsed JSON is not an array, returning empty array',
        { parsed: 'Alice' }
      )
    })
  })

  describe('invalid attendee entries', () => {
    it('should filter out null values and log warnings', () => {
      const json = JSON.stringify([
        { name: 'Alice', email: 'alice@example.com' },
        null,
        { name: 'Bob', email: 'bob@example.com' }
      ])
      const result = parseAttendees(json)

      expect(result).toEqual([
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' }
      ])
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[parseAttendees] Skipping non-object attendee',
        { item: null }
      )
    })

    it('should filter out string primitives and log warnings', () => {
      const json = JSON.stringify([
        { name: 'Alice', email: 'alice@example.com' },
        'invalid',
        { name: 'Bob', email: 'bob@example.com' }
      ])
      const result = parseAttendees(json)

      expect(result).toEqual([
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' }
      ])
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[parseAttendees] Skipping non-object attendee',
        { item: 'invalid' }
      )
    })

    it('should filter out number primitives and log warnings', () => {
      const json = JSON.stringify([
        { name: 'Alice', email: 'alice@example.com' },
        123,
        { name: 'Bob', email: 'bob@example.com' }
      ])
      const result = parseAttendees(json)

      expect(result).toEqual([
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' }
      ])
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[parseAttendees] Skipping non-object attendee',
        { item: 123 }
      )
    })

    it('should filter out multiple invalid entries', () => {
      const json = JSON.stringify([
        { name: 'Alice', email: 'alice@example.com' },
        null,
        'invalid',
        123,
        true,
        { name: 'Bob', email: 'bob@example.com' }
      ])
      const result = parseAttendees(json)

      expect(result).toEqual([
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' }
      ])
      expect(consoleWarnSpy).toHaveBeenCalledTimes(4)
    })

    it('should return empty array if all entries are invalid', () => {
      const json = JSON.stringify([null, 'invalid', 123, true])
      const result = parseAttendees(json)

      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalledTimes(4)
    })
  })

  describe('invalid JSON syntax', () => {
    it('should return empty array for malformed JSON and log warning', () => {
      const result = parseAttendees('{invalid json}')
      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalled()
      expect(consoleWarnSpy.mock.calls[0][0]).toBe('[parseAttendees] Failed to parse attendees JSON')
    })

    it('should return empty array for unclosed array and log warning', () => {
      const result = parseAttendees('[{"name": "Alice"}')
      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalled()
      expect(consoleWarnSpy.mock.calls[0][0]).toBe('[parseAttendees] Failed to parse attendees JSON')
    })
  })
})
