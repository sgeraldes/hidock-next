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
  IdentitySuggestion
} from '../services/database'
import { discoverContactMerges, discoverProjectMerges, DiscoveryResult } from '../services/identity-discovery'
import { success, error, Result } from '../types/api'

const StatusSchema = z.enum(['pending', 'accepted', 'rejected'])
const IdSchema = z.string().min(1).max(200)

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
  ipcMain.handle('identity:acceptSuggestion', async (_, id: unknown): Promise<Result<IdentitySuggestion>> => {
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
}
