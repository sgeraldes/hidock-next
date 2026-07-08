import { useCallback, useEffect, useState } from 'react'

/**
 * Client-side name/email → canonical contact resolver.
 *
 * Several surfaces (KnowledgeGraph rows, Actionables recipients) carry raw name
 * or email strings rather than contact ids. This hook loads all contacts ONCE
 * into a module-level cache and resolves those strings to real contact ids so
 * they can be rendered as navigable <EntityMention> people. Resolution is
 * case-insensitive; email is preferred over name when both are present.
 */

export interface ResolvedContact {
  id: string
  name: string
  email: string | null
  type?: string
}

let contactsCache: ResolvedContact[] | null = null
let inflight: Promise<ResolvedContact[]> | null = null

async function loadContacts(): Promise<ResolvedContact[]> {
  if (contactsCache) return contactsCache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await window.electronAPI.contacts.getAll()
      contactsCache = res.success ? ((res.data.contacts as unknown) as ResolvedContact[]) : []
    } catch {
      contactsCache = []
    } finally {
      inflight = null
    }
    return contactsCache ?? []
  })()
  return inflight
}

/** Clear the module cache — used by tests so mocks aren't shared across cases. */
export function resetContactResolverCache(): void {
  contactsCache = null
  inflight = null
}

export function useContactResolver() {
  const [contacts, setContacts] = useState<ResolvedContact[]>(contactsCache ?? [])
  const [ready, setReady] = useState<boolean>(contactsCache !== null)

  useEffect(() => {
    if (contactsCache) {
      setContacts(contactsCache)
      setReady(true)
      return
    }
    let cancelled = false
    loadContacts().then((c) => {
      if (!cancelled) {
        setContacts(c)
        setReady(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const resolveByName = useCallback(
    (name?: string | null): ResolvedContact | undefined => {
      const n = name?.trim().toLowerCase()
      if (!n) return undefined
      return contacts.find((c) => c.name?.trim().toLowerCase() === n)
    },
    [contacts]
  )

  const resolveByEmail = useCallback(
    (email?: string | null): ResolvedContact | undefined => {
      const e = email?.trim().toLowerCase()
      if (!e) return undefined
      return contacts.find((c) => c.email?.trim().toLowerCase() === e)
    },
    [contacts]
  )

  /** Resolve a recipient string that may be an email or a display name. */
  const resolveRecipient = useCallback(
    (value?: string | null): ResolvedContact | undefined => {
      const v = value?.trim()
      if (!v) return undefined
      if (v.includes('@')) return resolveByEmail(v)
      return resolveByName(v)
    },
    [resolveByEmail, resolveByName]
  )

  return { contacts, ready, resolveByName, resolveByEmail, resolveRecipient }
}
