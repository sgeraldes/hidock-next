import { describe, it, expect } from 'vitest'
import { isGenericEntityLabel, normalizeGenericLabel } from '../src/stop-list.js'

describe('isGenericEntityLabel — English collective/role words', () => {
  const generic = [
    'All',
    'All attendees',
    'All Participants',
    'All team members',
    'Team',
    'the team',
    'Project Manager',
    'Manager',
    'Everyone',
    'Stakeholders',
    'Team Lead',
    'Unknown speaker',
  ]
  it.each(generic)('flags "%s" as generic', (label) => {
    expect(isGenericEntityLabel(label)).toBe(true)
  })
})

describe('isGenericEntityLabel — Spanish collective/role words', () => {
  const generic = [
    'todos',
    'Todas',
    'el equipo',
    'Equipo',
    'participantes',
    'Todos los participantes',
    'asistentes',       // no accent
    'Asistentes',
    'gerente',
    'Gerente de proyecto',
    'jefe de proyecto',
    'miembros del equipo',
    'los demás',        // with accent
    'gestión',          // with accent
    'líder',            // with accent
  ]
  it.each(generic)('flags "%s" as generic', (label) => {
    expect(isGenericEntityLabel(label)).toBe(true)
  })
})

describe('isGenericEntityLabel — leading-quantifier stripping', () => {
  it.each(['all engineers', 'the developers', 'todos los miembros', 'our team'])(
    'flags "%s" via quantifier strip',
    (label) => {
      expect(isGenericEntityLabel(label)).toBe(true)
    }
  )
})

describe('isGenericEntityLabel — real named entities are NOT flagged', () => {
  const real = [
    'Mario',
    'Alice Smith',
    'Bob',
    'Yaraví Garcia',
    'Sebastian Geraldes',
    'Phoenix',      // project
    'Roadmap',      // topic
    'SQL',          // skill
    'María López',  // real Spanish name (accented)
    'José',
  ]
  it.each(real)('keeps "%s"', (label) => {
    expect(isGenericEntityLabel(label)).toBe(false)
  })

  it('does not flag empty/blank labels', () => {
    expect(isGenericEntityLabel('')).toBe(false)
    expect(isGenericEntityLabel('   ')).toBe(false)
    expect(isGenericEntityLabel(null)).toBe(false)
    expect(isGenericEntityLabel(undefined)).toBe(false)
  })
})

describe('normalizeGenericLabel', () => {
  it('accent-strips, lowercases, and collapses punctuation/whitespace', () => {
    expect(normalizeGenericLabel('  Todos LOS   Participantes! ')).toBe('todos los participantes')
    expect(normalizeGenericLabel('Líder')).toBe('lider')
  })
})
