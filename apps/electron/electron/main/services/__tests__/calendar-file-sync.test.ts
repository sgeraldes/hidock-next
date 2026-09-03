import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

import { parseShortcutCalendarFile } from '../calendar-file-sync'

describe('iPhone calendar file parser', () => {
  it('parses Shortcut TSV rows into stable meeting records', () => {
    const input = [
      'title\tstart\tend\tlocation\turl',
      'Delivery review\t2026-09-03T09:00:00+01:00\t2026-09-03T09:30:00+01:00\tTeams\thttps://teams.microsoft.com/l/meetup-join/abc'
    ].join('\n')

    const first = parseShortcutCalendarFile(input)
    const second = parseShortcutCalendarFile(input)

    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      id: expect.stringMatching(/^iphone-calendar:/),
      subject: 'Delivery review',
      start_time: '2026-09-03T08:00:00.000Z',
      end_time: '2026-09-03T08:30:00.000Z',
      location: 'Teams',
      meeting_url: 'https://teams.microsoft.com/l/meetup-join/abc',
      is_recurring: 0
    })
    expect(second[0].id).toBe(first[0].id)
  })

  it('allows blank locations and Teams links', () => {
    const rows = parseShortcutCalendarFile(
      [
        'title|||start|||end|||location|||url',
        'Private appointment|||2026-09-03T10:00:00Z|||2026-09-03T10:30:00Z||||||',
        'END|||1'
      ].join('\n')
    )

    expect(rows[0].location).toBeUndefined()
    expect(rows[0].meeting_url).toBeUndefined()
  })

  it('accepts the spaced END marker emitted by Shortcuts text actions', () => {
    const rows = parseShortcutCalendarFile(
      [
        'Meeting ||| 2026-09-03T10:00:00Z ||| 2026-09-03T10:30:00Z ||| Teams ||| ',
        'END ||| 1'
      ].join('\n')
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].subject).toBe('Meeting')
  })

  it('rejects a partially synced Shortcut snapshot', () => {
    expect(() => parseShortcutCalendarFile([
      'title|||start|||end|||location|||url',
      'Meeting|||2026-09-03T10:00:00Z|||2026-09-03T10:30:00Z||||||'
    ].join('\n'))).toThrow(/incomplete/i)

    expect(() => parseShortcutCalendarFile([
      'title|||start|||end|||location|||url',
      'Meeting|||2026-09-03T10:00:00Z|||2026-09-03T10:30:00Z||||||',
      'END|||2'
    ].join('\n'))).toThrow(/expected 2 events, found 1/i)
  })

  it.each([
    ['missing columns', 'Meeting\t2026-09-03T10:00:00Z\t2026-09-03T10:30:00Z'],
    ['bad date', 'Meeting\tnot-a-date\t2026-09-03T10:30:00Z\t\t'],
    ['backwards duration', 'Meeting\t2026-09-03T11:00:00Z\t2026-09-03T10:30:00Z\t\t']
  ])('rejects the complete snapshot for %s', (_name, input) => {
    expect(() => parseShortcutCalendarFile(input)).toThrow()
  })

  it('keeps an event but ignores a non-Teams URL', () => {
    const rows = parseShortcutCalendarFile(
      'Meeting\t2026-09-03T10:00:00Z\t2026-09-03T10:30:00Z\t\thttps://example.com/join'
    )
    expect(rows[0].subject).toBe('Meeting')
    expect(rows[0].meeting_url).toBeUndefined()
  })
})
