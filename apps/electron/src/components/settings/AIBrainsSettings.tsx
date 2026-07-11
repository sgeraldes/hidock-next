import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { toast } from '@/components/ui/toaster'
import type {
  BrainListItem,
  BrainId,
  BrainCapability,
  BrainAuthStatus,
} from '../../../electron/preload/index'

/** Human labels for capability chips (spec §D: generate/chat/embed/audio/agentic). */
const CAPABILITY_LABEL: Record<BrainCapability, string> = {
  generate: 'Generate',
  chat: 'Chat',
  embed: 'Embed',
  analyzeAudio: 'Audio',
  agentic: 'Agentic',
}

/**
 * Derive the auth badge label + tone from a brain's auth status. Prefers the
 * adapter-provided `detail` (e.g. "Running · llama3.2", "claude 2.1.205") when
 * present, falling back to a generic label keyed on the auth method. Green when
 * configured, muted otherwise (spec §D).
 */
function authBadge(auth: BrainAuthStatus): { text: string; ok: boolean } {
  if (auth.configured) {
    const generic =
      auth.method === 'api-key' ? 'Key set' : auth.method === 'cli-login' ? 'Logged in' : 'Connected'
    return { text: auth.detail || generic, ok: true }
  }
  const generic = auth.method === 'cli-login' || auth.method === 'oauth' ? 'Needs login' : 'Not configured'
  return { text: auth.detail || generic, ok: false }
}

const OK_BADGE = 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
const MUTED_BADGE = 'border-border bg-muted text-muted-foreground'

function AuthBadge({ auth }: { auth: BrainAuthStatus }) {
  const { text, ok } = authBadge(auth)
  return (
    <Badge className={ok ? OK_BADGE : MUTED_BADGE} title={auth.detail}>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`}
      />
      {text}
    </Badge>
  )
}

/** One brain row: label, capability chips, auth badge, enable toggle, default radio. */
function BrainRow({
  brain,
  onToggle,
}: {
  brain: BrainListItem
  onToggle: (id: BrainId, enabled: boolean) => void
}) {
  return (
    <div className="rounded-lg border border-border p-4 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{brain.label}</span>
          <AuthBadge auth={brain.auth} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {brain.capabilities.map((cap) => (
            <Badge key={cap} variant="neutral">
              {CAPABILITY_LABEL[cap] ?? cap}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-6 shrink-0">
        <label className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
          <span>Enabled</span>
          <Switch
            checked={brain.enabled}
            onCheckedChange={(v) => onToggle(brain.id, v)}
            aria-label={`Enable ${brain.label}`}
          />
        </label>
        <label className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
          <span>Default</span>
          <RadioGroupItem value={brain.id} aria-label={`Set ${brain.label} as default brain`} />
        </label>
      </div>
    </div>
  )
}

/**
 * AI Brains settings panel (H10). Data-driven off `window.electronAPI.brains.list`
 * — renders whatever brains the registry exposes (gemini-api, ollama, and any
 * later-phase adapters), never a hardcoded list. Lets the user enable/disable
 * each brain, pick the global default, and see its live auth status.
 */
export function AIBrainsSettings() {
  const [brains, setBrains] = useState<BrainListItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const list = await window.electronAPI?.brains?.list()
      if (list) setBrains(list)
    } catch {
      /* leave empty — the empty state renders */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const defaultId = brains.find((b) => b.isDefault)?.id ?? ''

  const handleToggle = useCallback(
    async (id: BrainId, enabled: boolean) => {
      // Optimistic update, revert + refetch on failure.
      setBrains((prev) => prev.map((b) => (b.id === id ? { ...b, enabled } : b)))
      try {
        await window.electronAPI.brains.setEnabled({ id, enabled })
      } catch (e) {
        toast.error(`Couldn't update brain: ${e instanceof Error ? e.message : String(e)}`)
        void load()
      }
    },
    [load]
  )

  const handleDefault = useCallback(
    async (id: string) => {
      const brainId = id as BrainId
      setBrains((prev) => prev.map((b) => ({ ...b, isDefault: b.id === brainId })))
      try {
        await window.electronAPI.brains.setDefault({ id: brainId })
      } catch (e) {
        toast.error(`Couldn't set default brain: ${e instanceof Error ? e.message : String(e)}`)
        void load()
      }
    },
    [load]
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Brains</CardTitle>
        <CardDescription>Choose which AI provider powers analysis, chat, and outputs.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading brains…</p>
        ) : brains.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI brains available.</p>
        ) : (
          <RadioGroup
            value={defaultId}
            onValueChange={handleDefault}
            aria-label="Default AI brain"
            className="gap-3"
          >
            {brains.map((brain) => (
              <BrainRow key={brain.id} brain={brain} onToggle={handleToggle} />
            ))}
          </RadioGroup>
        )}
      </CardContent>
    </Card>
  )
}
