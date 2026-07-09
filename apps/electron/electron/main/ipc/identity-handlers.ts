/**
 * Identity Suggestion IPC Handlers (Round 4a)
 *
 * Surfaces the resolver's 0.5–0.8 confidence band as a reviewable queue:
 *   identity:getSuggestions   — list suggestions (optionally by status)
 *   identity:acceptSuggestion — write a manual alias + perform the link
 *   identity:rejectSuggestion — write a rejected-alias block
 * Uses the Result pattern.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  getIdentitySuggestions,
  acceptIdentitySuggestion,
  rejectIdentitySuggestion,
  supersedeOrphanedSuggestions,
  getMergeJournal,
  getMergeImpact,
  getMentionSnippets,
  getPersonContext,
  getContactAliases,
  getAmbiguousBuckets,
  getBucketResolution,
  resolveMention,
  IdentitySuggestion,
  AcceptSuggestionResult,
  MergeJournalEntry,
  MentionResult,
  PersonContext,
  ContactAlias,
  AmbiguousBucket,
  BucketResolution
} from '../services/database'
import { discoverContactMerges, discoverProjectMerges, DiscoveryResult } from '../services/identity-discovery'
import { autoSplitAmbiguousBuckets } from '../services/org-reconciler'
import { success, error, Result } from '../types/api'

const StatusSchema = z.enum(['pending', 'accepted', 'rejected'])
const IdSchema = z.string().min(1).max(200)
const MentionSnippetsRequestSchema = z.object({
  name: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(10).optional()
})
const PersonContextRequestSchema = IdSchema
const KindSchema = z.enum(['contact', 'project'])
const MergeJournalRequestSchema = z.object({ kind: KindSchema, keeperId: IdSchema })
const MergeImpactRequestSchema = z.object({ kind: KindSchema, keeperId: IdSchema, loserId: IdSchema })
const ResolveMentionRequestSchema = z.object({
  recordingId: IdSchema,
  sourceName: z.string().min(1).max(200),
  // null = the user marked this recording's mention "Unclear" (leave unattributed).
  contactId: IdSchema.nullable(),
  method: z.string().min(1).max(40).optional()
})

export function registerIdentityHandlers(): void {
  /**
   * List identity suggestions. Optional status filter passed as a bare string.
   */
  ipcMain.handle('identity:getSuggestions', async (_, request?: unknown): Promise<Result<IdentitySuggestion[]>> => {
    try {
      let status: 'pending' | 'accepted' | 'rejected' | undefined
      if (request !== undefined && request !== null) {
        const parsed = StatusSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid status filter', parsed.error.format())
        }
        status = parsed.data
      }
      return success(getIdentitySuggestions(status))
    } catch (err) {
      console.error('identity:getSuggestions error:', err)
      return error('DATABASE_ERROR', 'Failed to fetch identity suggestions', err)
    }
  })

  /**
   * Accept a suggestion: alias + link the pairing, mark accepted.
   */
  ipcMain.handle('identity:acceptSuggestion', async (_, id: unknown): Promise<Result<AcceptSuggestionResult>> => {
    try {
      const parsed = IdSchema.safeParse(id)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid suggestion id', parsed.error.format())
      }
      return success(acceptIdentitySuggestion(parsed.data))
    } catch (err) {
      console.error('identity:acceptSuggestion error:', err)
      return error('DATABASE_ERROR', 'Failed to accept identity suggestion', err)
    }
  })

  /**
   * Reject a suggestion: write a rejected-alias block, mark rejected.
   */
  ipcMain.handle('identity:rejectSuggestion', async (_, id: unknown): Promise<Result<IdentitySuggestion>> => {
    try {
      const parsed = IdSchema.safeParse(id)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid suggestion id', parsed.error.format())
      }
      return success(rejectIdentitySuggestion(parsed.data))
    } catch (err) {
      console.error('identity:rejectSuggestion error:', err)
      return error('DATABASE_ERROR', 'Failed to reject identity suggestion', err)
    }
  })

  /**
   * Keeper-death cascade: after a merge performed outside the accept flow (third-door
   * merge-into, direction swap, or group-canonical batch), supersede every pending
   * suggestion whose keeper (target_id) no longer exists. Optional kind filter.
   * Returns { superseded }.
   */
  ipcMain.handle(
    'identity:supersedeOrphaned',
    async (_, kind?: unknown): Promise<Result<{ superseded: number }>> => {
      try {
        let k: 'person' | 'project' | undefined
        if (kind !== undefined && kind !== null) {
          const parsed = z.enum(['person', 'project']).safeParse(kind)
          if (!parsed.success) {
            return error('VALIDATION_ERROR', 'Invalid kind filter', parsed.error.format())
          }
          k = parsed.data
        }
        return success({ superseded: supersedeOrphanedSuggestions(k) })
      } catch (err) {
        console.error('identity:supersedeOrphaned error:', err)
        return error('DATABASE_ERROR', 'Failed to supersede orphaned suggestions', err)
      }
    }
  )

  /**
   * Primary-source evidence for a name: transcript excerpts where it literally
   * occurs, plus every recording id that contains it (so the renderer can detect
   * two names co-occurring in one conversation). { name, limit? }.
   */
  ipcMain.handle('identity:getMentionSnippets', async (_, request?: unknown): Promise<Result<MentionResult>> => {
    try {
      const parsed = MentionSnippetsRequestSchema.safeParse(request)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid mention snippets request', parsed.error.format())
      }
      return success(getMentionSnippets(parsed.data.name, parsed.data.limit ?? 2))
    } catch (err) {
      console.error('identity:getMentionSnippets error:', err)
      return error('DATABASE_ERROR', 'Failed to fetch mention snippets', err)
    }
  })

  /**
   * Graph-neighborhood context for one side of a merge card: the person's closest
   * co-attendees and topics/projects. Accepts a contact id OR a raw name.
   */
  ipcMain.handle('identity:getPersonContext', async (_, idOrName?: unknown): Promise<Result<PersonContext>> => {
    try {
      const parsed = PersonContextRequestSchema.safeParse(idOrName)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid person context request', parsed.error.format())
      }
      return success(getPersonContext(parsed.data))
    } catch (err) {
      console.error('identity:getPersonContext error:', err)
      return error('DATABASE_ERROR', 'Failed to fetch person context', err)
    }
  })

  /**
   * "Also known as" aliases for a contact (the PersonDetail chip row): every
   * non-rejected alias folded onto this person, newest first. Bare contact id.
   */
  ipcMain.handle('identity:getAliases', async (_, contactId: unknown): Promise<Result<ContactAlias[]>> => {
    try {
      const parsed = IdSchema.safeParse(contactId)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid contact id', parsed.error.format())
      }
      return success(getContactAliases(parsed.data))
    } catch (err) {
      console.error('identity:getAliases error:', err)
      return error('DATABASE_ERROR', 'Failed to fetch contact aliases', err)
    }
  })

  /**
   * Discovery sweep over the People corpus: scores existing contact pairs and
   * writes identity_suggestions for probable duplicates. Long-running (invoked
   * explicitly from the People "Discovery" action); returns a DiscoveryResult.
   */
  ipcMain.handle('identity:discoverContacts', async (): Promise<Result<DiscoveryResult>> => {
    try {
      return success(discoverContactMerges())
    } catch (err) {
      console.error('identity:discoverContacts error:', err)
      return error('DATABASE_ERROR', 'Failed to run contact discovery sweep', err)
    }
  })

  /**
   * Discovery sweep over the Projects corpus (name + shared-meeting/graph overlap).
   */
  ipcMain.handle('identity:discoverProjects', async (): Promise<Result<DiscoveryResult>> => {
    try {
      return success(discoverProjectMerges())
    } catch (err) {
      console.error('identity:discoverProjects error:', err)
      return error('DATABASE_ERROR', 'Failed to run project discovery sweep', err)
    }
  })

  /**
   * Merge history for an entity (the "Merge history" row in its detail view):
   * the open, undoable merges folded into this keeper. { kind, keeperId }.
   */
  ipcMain.handle('identity:getMergeJournal', async (_, request?: unknown): Promise<Result<MergeJournalEntry[]>> => {
    try {
      const parsed = MergeJournalRequestSchema.safeParse(request)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid merge journal request', parsed.error.format())
      }
      return success(getMergeJournal(parsed.data.kind, parsed.data.keeperId))
    } catch (err) {
      console.error('identity:getMergeJournal error:', err)
      return error('DATABASE_ERROR', 'Failed to fetch merge journal', err)
    }
  })

  /**
   * Link counts for both sides of a proposed merge, so the renderer can gate a
   * high-stakes merge (both sides heavily linked) behind a type-to-confirm step.
   */
  ipcMain.handle(
    'identity:getMergeImpact',
    async (_, request?: unknown): Promise<Result<{ keeper: number; loser: number }>> => {
      try {
        const parsed = MergeImpactRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid merge impact request', parsed.error.format())
        }
        return success(getMergeImpact(parsed.data.kind, parsed.data.keeperId, parsed.data.loserId))
      } catch (err) {
        console.error('identity:getMergeImpact error:', err)
        return error('DATABASE_ERROR', 'Failed to compute merge impact', err)
      }
    }
  )

  /**
   * Ambiguous mention buckets: bare first names ("Sergio") that denote several
   * distinct real people, with per-bucket resolution progress. Drives the
   * "Resolve per meeting" cards in the identity queue.
   */
  ipcMain.handle('identity:getAmbiguousBuckets', async (): Promise<Result<AmbiguousBucket[]>> => {
    try {
      return success(getAmbiguousBuckets())
    } catch (err) {
      console.error('identity:getAmbiguousBuckets error:', err)
      return error('DATABASE_ERROR', 'Failed to fetch ambiguous buckets', err)
    }
  })

  /**
   * Full per-recording resolution view for one bucket: the candidate real people,
   * and each recording with the system's best guess + the signal behind it.
   */
  ipcMain.handle('identity:getBucketResolution', async (_, contactId: unknown): Promise<Result<BucketResolution | null>> => {
    try {
      const parsed = IdSchema.safeParse(contactId)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid contact id', parsed.error.format())
      }
      return success(getBucketResolution(parsed.data))
    } catch (err) {
      console.error('identity:getBucketResolution error:', err)
      return error('DATABASE_ERROR', 'Failed to fetch bucket resolution', err)
    }
  })

  /**
   * Assign (or clear, with contactId=null) the real person a bucket mention denotes
   * in ONE recording. Non-destructive: records the decision and links that recording's
   * meeting to the chosen person; the bucket is never merged.
   */
  ipcMain.handle('identity:resolveMention', async (_, request?: unknown): Promise<Result<{ ok: true }>> => {
    try {
      const parsed = ResolveMentionRequestSchema.safeParse(request)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid resolve-mention request', parsed.error.format())
      }
      const { recordingId, sourceName, contactId, method } = parsed.data
      resolveMention(recordingId, sourceName, contactId, method ?? 'manual', 1.0)
      return success({ ok: true })
    } catch (err) {
      console.error('identity:resolveMention error:', err)
      return error('DATABASE_ERROR', 'Failed to resolve mention', err)
    }
  })

  /**
   * Maintenance sweep: auto-resolve every bucket recording whose signal is
   * unambiguous (sole speaker or sole matching attendee), leaving the rest for the
   * user. Returns how many buckets were seen and how many mentions were split.
   */
  ipcMain.handle('identity:autoSplitBuckets', async (): Promise<Result<{ buckets: number; resolved: number }>> => {
    try {
      return success(autoSplitAmbiguousBuckets())
    } catch (err) {
      console.error('identity:autoSplitBuckets error:', err)
      return error('DATABASE_ERROR', 'Failed to auto-split buckets', err)
    }
  })
}
