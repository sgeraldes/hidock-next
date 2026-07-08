import { describe, it, expect } from 'vitest'
import {
  nameRarity,
  COMMON_DELTA,
  RARE_DELTA,
  COMMON_MENTIONS,
} from '../name-rarity'

describe('nameRarity', () => {
  it('demotes a common name with many bearers', () => {
    // 'Juan' borne by 3 contacts — a fuzzy match on it is weak.
    const r = nameRarity({ bearers: 3, tokenLength: 4 })
    expect(r.rarity).toBe('common')
    expect(r.delta).toBe(COMMON_DELTA)
  })

  it('demotes a short token shared by two bearers (nickname collision)', () => {
    // 'Ale' (len 3) borne by 2 people — short + multiple bearers ⇒ common.
    const r = nameRarity({ bearers: 2, tokenLength: 3 })
    expect(r.rarity).toBe('common')
    expect(r.delta).toBe(COMMON_DELTA)
  })

  it('demotes a heavily-spoken token even with few bearers', () => {
    const r = nameRarity({ bearers: 1, tokenLength: 8, mentions: COMMON_MENTIONS })
    expect(r.rarity).toBe('common')
    expect(r.delta).toBe(COMMON_DELTA)
  })

  it('boosts a rare full name with one bearer', () => {
    // 'Yaraví' (folded 'yaravi', len 6) borne by a single contact — the match stands.
    const r = nameRarity({ bearers: 1, tokenLength: 6 })
    expect(r.rarity).toBe('rare')
    expect(r.delta).toBe(RARE_DELTA)
  })

  it('boosts a rare name with two bearers', () => {
    const r = nameRarity({ bearers: 2, tokenLength: 7 })
    expect(r.rarity).toBe('rare')
    expect(r.delta).toBe(RARE_DELTA)
  })

  it('treats a short token with a single bearer as normal (neither common nor rare)', () => {
    // 'Edu' (len 3, 1 bearer) — short but not shared, and too short to be "rare".
    const r = nameRarity({ bearers: 1, tokenLength: 3 })
    expect(r.rarity).toBe('normal')
    expect(r.delta).toBe(0)
  })

  it('treats a longer name with three bearers as common at the boundary', () => {
    const r = nameRarity({ bearers: 3, tokenLength: 9 })
    expect(r.rarity).toBe('common')
  })

  it('clamps negative/missing inputs without throwing', () => {
    expect(nameRarity({ bearers: -5, tokenLength: 0 })).toEqual({ rarity: 'normal', delta: 0 })
  })
})
