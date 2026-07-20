/**
 * IPC handlers for the AI Brains settings surface (H10). Namespace: `brains:*`.
 *
 * Bridges the renderer Settings → "AI Brains" panel to the main-process brain
 * seam: list registered brains (with capabilities + enable/default flags from
 * config + live auth status), toggle enable, set the default brain, set per-task
 * routing, and store per-brain credentials.
 *
 * READ-ONLY over the registry/adapters — this file never mutates
 * `brain-registry.ts` or a brain's internals; it only reads the registry and
 * persists user choices into `config.brains` via `updateConfig` (and secrets via
 * the BrainCredentialStore). Follows the 3-file IPC pattern in
 * `.claude/rules/electron-ipc.md`.
 */
import { ipcMain } from 'electron'
import { getConfig, updateConfig } from '../services/config'
import { getBrainRegistry } from '../services/brains/brain-registry'
import { getBrainCredentialStore } from '../services/brains/brain-credential-store'
import { getVectorStore } from '../services/vector-store'

/**
 * Kick the provider-scoped backfill after the EMBED routing changes so the
 * newly active provider's partition starts filling immediately (fire-and-
 * forget; the backfill is idempotent and skips chunks already in the
 * partition — switching BACK to a previous provider is a cheap no-op scan).
 */
function kickEmbedReindex(reason: string): void {
  void getVectorStore()
    .backfillMissingTranscripts()
    .then((r) => console.log(`[brains] embed reindex after ${reason}:`, r))
    .catch((e) => console.error(`[brains] embed reindex after ${reason} failed:`, e))
}
import type { AIBrain, BrainAuthStatus, BrainCapability, BrainId, BrainTask } from '../services/brains/types'

/**
 * Serialisable shape sent to the renderer for a single brain. The renderer keeps
 * a structurally-identical mirror of this (+ BrainId/BrainCapability/
 * BrainAuthStatus) inline in `electron/preload/index.ts`, because the web
 * tsconfig program can't import from `main/services/brains`. Keep the two in sync.
 */
export interface BrainListItem {
  id: BrainId
  label: string
  capabilities: BrainCapability[]
  enabled: boolean
  isDefault: boolean
  auth: BrainAuthStatus
}

const UNKNOWN_AUTH: BrainAuthStatus = { configured: false, method: 'none', detail: 'Status unavailable' }

/** Resolve one brain's auth status defensively — a throwing/hanging adapter must
 * never break the whole list. */
async function safeAuth(brain: AIBrain): Promise<BrainAuthStatus> {
  try {
    return await brain.authStatus()
  } catch {
    return UNKNOWN_AUTH
  }
}

export function registerBrainsHandlers(): void {
  // List all registered brains with their config flags + live auth status.
  ipcMain.handle('brains:list', async (): Promise<BrainListItem[]> => {
    const brains = getBrainRegistry().list()
    const cfg = getConfig().brains
    // Resolve every brain's auth in parallel; each is individually guarded.
    const auths = await Promise.all(brains.map((b) => safeAuth(b)))
    return brains.map((brain, i) => ({
      id: brain.id,
      label: brain.label,
      capabilities: [...brain.capabilities()],
      enabled: cfg?.enabled?.[brain.id] ?? false,
      isDefault: cfg?.defaultBrain === brain.id,
      auth: auths[i],
    }))
  })

  // Toggle a brain's add-on enable flag → config.brains.enabled[id].
  ipcMain.handle('brains:setEnabled', async (_e, args: { id: BrainId; enabled: boolean }) => {
    const { id, enabled } = args ?? ({} as { id: BrainId; enabled: boolean })
    const current = getConfig().brains
    await updateConfig('brains', {
      enabled: { ...current.enabled, [id]: enabled },
    })
    // Enabling an embed-capable brain can change the active embed partition.
    if (enabled && getBrainRegistry().get(id)?.capabilities().has('embed')) {
      kickEmbedReindex(`enable ${id}`)
    }
    return { success: true }
  })

  // Set the global default brain → config.brains.defaultBrain.
  ipcMain.handle('brains:setDefault', async (_e, args: { id: BrainId }) => {
    const { id } = args ?? ({} as { id: BrainId })
    await updateConfig('brains', { defaultBrain: id })
    return { success: true }
  })

  // Current per-task routing overrides (renderer pickers initialize from this).
  ipcMain.handle('brains:getRouting', async (): Promise<Partial<Record<BrainTask, BrainId>>> => {
    return { ...getConfig().brains?.taskRouting }
  })

  // Set (or clear) a per-task routing override → config.brains.taskRouting[task].
  // A null id clears the override (task falls back to the default brain).
  ipcMain.handle('brains:setTaskRouting', async (_e, args: { task: BrainTask; id: BrainId | null }) => {
    const { task, id } = args ?? ({} as { task: BrainTask; id: BrainId | null })
    const current = getConfig().brains
    const routing: Partial<Record<BrainTask, BrainId>> = { ...current.taskRouting }
    if (id === null || id === undefined) {
      delete routing[task]
    } else {
      routing[task] = id
    }
    await updateConfig('brains', { taskRouting: routing })
    // Provider partitions: a new EMBED route means a new active partition —
    // start filling it in the background right away.
    if (task === 'embed') kickEmbedReindex(`routing embed→${id ?? 'auto'}`)
    return { success: true }
  })

  // Store (or clear) a per-brain secret in the encrypted credential store.
  // NOTE: the Gemini key is auto-synced from the plaintext config field by
  // config.ts; this channel is mainly for future key-based brains.
  ipcMain.handle('brains:setCredential', async (_e, args: { id: BrainId; field: string; value: string | null }) => {
    const { id, field, value } = args ?? ({} as { id: BrainId; field: string; value: string | null })
    getBrainCredentialStore().setSecret(id, field, value)
    return { success: true }
  })
}
