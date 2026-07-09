import { describe, it, expect } from 'vitest'
import { cleanRole } from '../roleHygiene'

describe('cleanRole', () => {
  it('strips (mencionado) / (mentioned) artifacts', () => {
    expect(cleanRole('Engineer (mencionado)')).toBe('Engineer')
    expect(cleanRole('Product Manager (mentioned)')).toBe('Product Manager')
    expect(cleanRole('QA (mencionada)')).toBe('QA')
  })

  it('strips other extraction artifacts (EN + ES)', () => {
    expect(cleanRole('Designer (inferred)')).toBe('Designer')
    expect(cleanRole('Analista (inferido)')).toBe('Analista')
    expect(cleanRole('Lead (possible)')).toBe('Lead')
    expect(cleanRole('Owner (unconfirmed)')).toBe('Owner')
    expect(cleanRole('Client (no confirmado)')).toBe('Client')
  })

  it('tidies leftover separators and whitespace', () => {
    expect(cleanRole('PM · Client (inferred)')).toBe('PM · Client')
    expect(cleanRole('Engineer  (mencionado)  ')).toBe('Engineer')
    expect(cleanRole('Consultant - (mentioned)')).toBe('Consultant')
  })

  it('keeps meaningful (non-artifact) parentheticals', () => {
    expect(cleanRole('VP (Sales)')).toBe('VP (Sales)')
    expect(cleanRole('Director (EMEA)')).toBe('Director (EMEA)')
  })

  it('is empty-safe and idempotent', () => {
    expect(cleanRole(null)).toBe('')
    expect(cleanRole(undefined)).toBe('')
    expect(cleanRole('')).toBe('')
    const once = cleanRole('Engineer (mencionado)')
    expect(cleanRole(once)).toBe(once)
  })
})
