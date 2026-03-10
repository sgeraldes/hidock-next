/**
 * Tests for highlightText utility
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { highlightText } from '../highlightText'

describe('highlightText', () => {
  it('returns plain text when query is empty', () => {
    const result = highlightText('Hello World', '')
    expect(result).toBe('Hello World')
  })

  it('returns plain text when query does not match', () => {
    const result = highlightText('Hello World', 'xyz')
    expect(result).toBe('Hello World')
  })

  it('highlights matching text case-insensitively', () => {
    const result = highlightText('Hello World', 'hello')
    const { container } = render(<>{result}</>)
    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('Hello')
  })

  it('highlights multiple occurrences', () => {
    const result = highlightText('test one test two', 'test')
    const { container } = render(<>{result}</>)
    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(2)
  })

  it('handles special regex characters in query', () => {
    const result = highlightText('file (1).mp3', '(1)')
    const { container } = render(<>{result}</>)
    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('(1)')
  })

  it('preserves surrounding text', () => {
    const result = highlightText('abc def ghi', 'def')
    const { container } = render(<>{result}</>)
    expect(container.textContent).toBe('abc def ghi')
    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('def')
  })
})

describe('highlightText — multi-token queries', () => {
  it('highlights both words in a two-word query', () => {
    const result = highlightText('Sofia - Ejercicio Connect', 'Sofia Connect')
    const { container } = render(<>{result}</>)
    const texts = Array.from(container.querySelectorAll('mark')).map((m) => m.textContent)
    expect(texts).toContain('Sofia')
    expect(texts).toContain('Connect')
  })

  it('handles extra whitespace in query', () => {
    const result = highlightText('Hello World', '  hello  ')
    const { container } = render(<>{result}</>)
    expect(container.querySelectorAll('mark')).toHaveLength(1)
    expect(container.querySelector('mark')!.textContent).toBe('Hello')
  })

  it('preserves full text content with multi-token highlighting', () => {
    const result = highlightText('Sofia - Ejercicio Connect', 'sofia connect')
    const { container } = render(<>{result}</>)
    expect(container.textContent).toBe('Sofia - Ejercicio Connect')
  })

  it('single-word query still works', () => {
    const result = highlightText('Hello World', 'world')
    const { container } = render(<>{result}</>)
    expect(container.querySelector('mark')!.textContent).toBe('World')
  })
})
