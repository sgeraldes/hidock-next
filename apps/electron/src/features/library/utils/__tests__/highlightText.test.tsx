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
