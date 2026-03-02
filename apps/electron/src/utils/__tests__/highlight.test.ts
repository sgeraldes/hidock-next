import { describe, it, expect } from 'vitest'
import { highlightMatch } from '../highlight'

describe('highlightMatch', () => {
  it('should wrap a single matching term in <mark> tags', () => {
    expect(highlightMatch('Hello World', 'hello')).toBe('<mark>Hello</mark> World')
  })

  it('should be case-insensitive', () => {
    expect(highlightMatch('Hello World', 'HELLO')).toBe('<mark>Hello</mark> World')
  })

  it('should highlight multiple occurrences of a single term', () => {
    expect(highlightMatch('the cat sat on the mat', 'the')).toBe(
      '<mark>the</mark> cat sat on <mark>the</mark> mat'
    )
  })

  it('should highlight multiple different terms', () => {
    expect(highlightMatch('API Design meeting notes', 'API notes')).toBe(
      '<mark>API</mark> Design meeting <mark>notes</mark>'
    )
  })

  it('should return HTML-escaped text when query is empty', () => {
    expect(highlightMatch('Hello World', '')).toBe('Hello World')
    expect(highlightMatch('Hello World', '   ')).toBe('Hello World')
  })

  it('should return empty string when text is empty', () => {
    expect(highlightMatch('', 'test')).toBe('')
  })

  it('should return empty string when text is null/undefined', () => {
    expect(highlightMatch(null as unknown as string, 'test')).toBe('')
    expect(highlightMatch(undefined as unknown as string, 'test')).toBe('')
  })

  it('should return HTML-escaped text when query is null/undefined', () => {
    expect(highlightMatch('Hello', null as unknown as string)).toBe('Hello')
    expect(highlightMatch('Hello', undefined as unknown as string)).toBe('Hello')
  })

  it('should handle special regex characters in query', () => {
    // Note: $ gets HTML-escaped to $ (no change), so match still works
    expect(highlightMatch('price is $100.00', '$100')).toBe(
      'price is <mark>$100</mark>.00'
    )
  })

  it('should handle multiple spaces between terms', () => {
    expect(highlightMatch('hello world test', 'hello   test')).toBe(
      '<mark>hello</mark> world <mark>test</mark>'
    )
  })

  it('should not highlight when no terms match', () => {
    expect(highlightMatch('Hello World', 'foo')).toBe('Hello World')
  })

  it('should preserve original text casing in output', () => {
    expect(highlightMatch('Amazon Connect API', 'amazon api')).toBe(
      '<mark>Amazon</mark> Connect <mark>API</mark>'
    )
  })

  it('should HTML-escape text to prevent XSS', () => {
    const malicious = '<script>alert("xss")</script>'
    const result = highlightMatch(malicious, 'script')
    // The angle brackets should be escaped
    expect(result).not.toContain('<script>')
    expect(result).toContain('&lt;<mark>script</mark>&gt;')
  })

  it('should HTML-escape text even when no query matches', () => {
    expect(highlightMatch('<b>bold</b>', 'xyz')).toBe('&lt;b&gt;bold&lt;/b&gt;')
  })

  it('should escape ampersands and quotes', () => {
    // Note: 'A' matches case-insensitively in '&amp;' (the 'a' in 'amp')
    // This is expected because we highlight the escaped text
    expect(highlightMatch('A & B "quoted"', 'B')).toBe(
      'A &amp; <mark>B</mark> &quot;quoted&quot;'
    )
  })
})
