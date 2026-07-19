/**
 * Pure mappers from Microsoft Graph JSON → connector entity types.
 * Kept separate + dependency-free (only @hidock/connectors types) so they can
 * be unit-tested without MSAL, network, or Electron.
 */
import type { ExternalMeeting, ExternalPerson } from '@hidock/connectors'

interface GraphDateTimeTimeZone {
  dateTime?: string
  timeZone?: string
}

interface GraphEmailAddress {
  name?: string
  address?: string
}

/**
 * Graph returns e.g. "2026-07-09T10:00:00.0000000". With the request header
 * `Prefer: outlook.timezone="UTC"` the value is UTC but carries no offset, so
 * we append 'Z' before parsing. Values that already carry an offset are left
 * as-is.
 */
export function graphDateToIso(dt?: GraphDateTimeTimeZone): string {
  const raw = dt?.dateTime
  if (!raw) return ''
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)
  const normalized = hasZone ? raw : `${raw}Z`
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

export function mapEmailAddress(email?: GraphEmailAddress): ExternalPerson {
  const address = email?.address?.trim()
  const displayName = email?.name?.trim()
  return {
    externalId: (address || displayName || 'unknown').toLowerCase(),
    name: displayName || address || 'Unknown',
    email: address || undefined,
  }
}

export function mapGraphEvent(ev: Record<string, any>): ExternalMeeting {
  const attendees: ExternalPerson[] | undefined = Array.isArray(ev.attendees)
    ? ev.attendees.map((a: any) => ({
        ...mapEmailAddress(a?.emailAddress),
        metadata: { attendeeType: a?.type, response: a?.status?.response },
      }))
    : undefined
  return {
    externalId: String(ev.id ?? ''),
    title: ev.subject?.trim() || '(no subject)',
    start: graphDateToIso(ev.start),
    end: graphDateToIso(ev.end),
    location: ev.location?.displayName || undefined,
    description: ev.bodyPreview || undefined,
    isOnline: Boolean(ev.isOnlineMeeting),
    onlineJoinUrl: ev.onlineMeeting?.joinUrl || undefined,
    organizer: ev.organizer?.emailAddress ? mapEmailAddress(ev.organizer.emailAddress) : undefined,
    attendees,
    metadata: {
      webLink: ev.webLink,
      seriesMasterId: ev.seriesMasterId,
      showAs: ev.showAs,
    },
  }
}

export function mapGraphContact(c: Record<string, any>): ExternalPerson {
  const emails: string[] = Array.isArray(c.emailAddresses)
    ? c.emailAddresses.map((e: any) => e?.address).filter((a: unknown): a is string => typeof a === 'string')
    : []
  const name =
    c.displayName?.trim() || [c.givenName, c.surname].filter(Boolean).join(' ').trim() || emails[0] || 'Unknown'
  return {
    externalId: String(c.id ?? emails[0] ?? name),
    name,
    email: emails[0] || undefined,
    emails: emails.length > 1 ? emails : undefined,
    company: c.companyName || undefined,
    title: c.jobTitle || undefined,
    department: c.department || undefined,
    metadata: { mobilePhone: c.mobilePhone },
  }
}

/** Map a /me/people result item. */
export function mapGraphPerson(p: Record<string, any>): ExternalPerson {
  const scored = Array.isArray(p.scoredEmailAddresses) ? p.scoredEmailAddresses : []
  const email: string | undefined = scored[0]?.address || undefined
  return {
    externalId: (p.id || email || p.displayName || 'unknown').toString().toLowerCase(),
    name: p.displayName?.trim() || email || 'Unknown',
    email,
    emails: scored.length > 1 ? scored.map((s: any) => s.address).filter(Boolean) : undefined,
    company: p.companyName || undefined,
    title: p.jobTitle || undefined,
    department: p.department || undefined,
    metadata: { personType: p.personType?.subclass },
  }
}
