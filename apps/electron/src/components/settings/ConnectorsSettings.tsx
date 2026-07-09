import { useEffect, useMemo, useState, useCallback } from 'react'
import { RefreshCw, Plug, PlugZap, ChevronDown, ChevronRight, ExternalLink, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toaster'
import type {
  ConnectorSummary,
  ConnectorStatus,
  ConnectorStatusState,
  SourceContainer,
} from '@hidock/connectors'

const STATUS_META: Record<ConnectorStatusState, { label: string; className: string }> = {
  disconnected: { label: 'Disconnected', className: 'border-border bg-muted text-muted-foreground' },
  connecting: { label: 'Connecting…', className: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  'auth-needed': { label: 'Sign-in needed', className: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  connected: { label: 'Connected', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  syncing: { label: 'Syncing…', className: 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300' },
  error: { label: 'Error', className: 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300' },
}

function StatusBadge({ status }: { status: ConnectorStatus }) {
  const meta = STATUS_META[status.state] ?? STATUS_META.disconnected
  return <Badge className={meta.className}>{meta.label}</Badge>
}

/** The device-code sign-in prompt, surfaced from status.detail while connecting. */
function DeviceCodePrompt({ status }: { status: ConnectorStatus }) {
  const detail = status.detail as { verificationUri?: string; userCode?: string; fullMessage?: string } | undefined
  const [copied, setCopied] = useState(false)
  if (!detail?.userCode || !detail?.verificationUri) return null
  const copy = () => {
    navigator.clipboard?.writeText(detail.userCode!).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
      <p className="mb-2 text-amber-800 dark:text-amber-200">
        To finish signing in, open the link and enter the code:
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={detail.verificationUri}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary underline"
        >
          {detail.verificationUri}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 font-mono text-base tracking-widest"
          aria-label="Copy device code"
        >
          {detail.userCode}
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
      </div>
    </div>
  )
}

function SetupSteps({ steps, docsUrl }: { steps: string[]; docsUrl?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-border bg-muted/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        First-time setup ({steps.length} steps)
      </button>
      {open && (
        <ol className="list-decimal space-y-1.5 px-8 pb-3 text-sm text-muted-foreground">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
          {docsUrl && (
            <li>
              <a href={docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                Microsoft app-registration docs <ExternalLink className="h-3 w-3" />
              </a>
            </li>
          )}
        </ol>
      )}
    </div>
  )
}

function ConnectorCard({ summary, onChanged }: { summary: ConnectorSummary; onChanged: (s: ConnectorSummary) => void }) {
  const { descriptor, status } = summary
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of summary.fields) init[f.key] = f.secret ? '' : String(f.value ?? '')
    return init
  })
  const [busy, setBusy] = useState<null | 'save' | 'connect' | 'disconnect' | 'sync' | 'sources'>(null)
  const [containers, setContainers] = useState<SourceContainer[]>([])

  const isConnected = status.state === 'connected' || status.state === 'syncing'
  const dirty = useMemo(
    () => summary.fields.some((f) => (f.secret ? values[f.key] !== '' : values[f.key] !== String(f.value ?? ''))),
    [summary.fields, values]
  )

  const save = async () => {
    setBusy('save')
    try {
      const next = await window.electronAPI.connectors.configure(descriptor.id, values)
      onChanged(next)
      // Clear entered secret inputs (they're now stored + redacted).
      setValues((v) => {
        const cleared = { ...v }
        for (const f of descriptor.configFields) if (f.secret) cleared[f.key] = ''
        return cleared
      })
      toast.success(`${descriptor.displayName} settings saved`)
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const connect = async () => {
    setBusy('connect')
    try {
      const next = await window.electronAPI.connectors.connect(descriptor.id)
      onChanged(next)
    } catch (e) {
      toast.error(`Connect failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async () => {
    setBusy('disconnect')
    try {
      const next = await window.electronAPI.connectors.disconnect(descriptor.id)
      onChanged(next)
      setContainers([])
    } finally {
      setBusy(null)
    }
  }

  const loadSources = useCallback(async () => {
    setBusy('sources')
    try {
      const list = await window.electronAPI.connectors.listContainers(descriptor.id)
      setContainers(list)
    } catch {
      /* ignore */
    } finally {
      setBusy(null)
    }
  }, [descriptor.id])

  useEffect(() => {
    if (isConnected && descriptor.capabilityKinds.includes('sources') && containers.length === 0) {
      void loadSources()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected])

  const sync = async () => {
    setBusy('sync')
    try {
      const outcome = await window.electronAPI.connectors.sync(descriptor.id)
      onChanged(await window.electronAPI.connectors.get(descriptor.id))
      toast.success(
        `${descriptor.displayName} synced — ${outcome.meetings} meetings, ${outcome.contacts} contacts, ${outcome.artifacts} files`
      )
    } catch (e) {
      toast.error(`Sync failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const sourceState = useMemo(() => {
    const map = new Map(summary.sources?.map((s) => [s.externalId, s]) ?? [])
    return map
  }, [summary.sources])

  const toggleSource = async (containerId: string, enabled: boolean) => {
    try {
      const next = await window.electronAPI.connectors.setSourceEnabled(descriptor.id, containerId, enabled)
      onChanged(next)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{descriptor.displayName}</h3>
            <StatusBadge status={status} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{descriptor.description}</p>
        </div>
      </div>

      {status.state === 'error' && status.message && (
        <p className="text-sm text-red-600 dark:text-red-400">{status.message}</p>
      )}

      {(status.state === 'connecting') && <DeviceCodePrompt status={status} />}

      {descriptor.auth.setupSteps && descriptor.auth.setupSteps.length > 0 && (
        <SetupSteps steps={descriptor.auth.setupSteps} docsUrl={descriptor.auth.docsUrl} />
      )}

      {descriptor.configFields.length > 0 && (
        <div className="space-y-3">
          {descriptor.configFields.map((field) => {
            const view = summary.fields.find((f) => f.key === field.key)
            const placeholder = field.secret && view?.hasValue ? '•••••••• (saved)' : field.placeholder
            return (
              <div key={field.key}>
                <label htmlFor={`${descriptor.id}-${field.key}`} className="text-sm font-medium">
                  {field.label}
                  {field.required && <span className="text-red-500"> *</span>}
                </label>
                <Input
                  id={`${descriptor.id}-${field.key}`}
                  type={field.secret ? 'password' : field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
                  value={values[field.key] ?? ''}
                  placeholder={placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  disabled={busy !== null}
                  className="mt-1"
                  autoComplete="off"
                />
                {field.help && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
              </div>
            )
          })}
        </div>
      )}

      {containers.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Sources to sync</p>
          {containers.map((c) => {
            const persisted = sourceState.get(c.externalId)
            const enabled = persisted ? persisted.enabled : true
            return (
              <div key={c.externalId} className="flex items-center justify-between rounded border border-border px-3 py-2">
                <div className="text-sm">
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{c.kind}</span>
                  {persisted?.lastSyncAt && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      · last {new Date(persisted.lastSyncAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <Switch checked={enabled} onCheckedChange={(v) => toggleSource(c.externalId, v)} aria-label={`Sync ${c.name}`} />
              </div>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {descriptor.configFields.length > 0 && (
          <Button onClick={save} disabled={busy !== null || !dirty} size="sm">
            {busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </Button>
        )}
        {isConnected ? (
          <Button variant="outline" size="sm" onClick={disconnect} disabled={busy !== null}>
            <PlugZap className="mr-1.5 h-4 w-4" /> Disconnect
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={connect} disabled={busy !== null}>
            <Plug className="mr-1.5 h-4 w-4" /> {busy === 'connect' ? 'Connecting…' : 'Connect'}
          </Button>
        )}
        {isConnected && descriptor.capabilityKinds.includes('sources') && (
          <Button variant="outline" size="sm" onClick={sync} disabled={busy !== null}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${busy === 'sync' ? 'animate-spin' : ''}`} /> Sync now
          </Button>
        )}
        {status.lastSyncAt && (
          <span className="text-xs text-muted-foreground">Last synced {new Date(status.lastSyncAt).toLocaleString()}</span>
        )}
      </div>
    </div>
  )
}

export function ConnectorsSettings() {
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const list = await window.electronAPI?.connectors?.list()
      if (list) setConnectors(list)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const api = window.electronAPI?.connectors
    if (!api?.onStatusChanged) return
    const unsubscribe = api.onStatusChanged(({ id, status }) => {
      setConnectors((prev) => prev.map((c) => (c.descriptor.id === id ? { ...c, status } : c)))
    })
    return unsubscribe
  }, [load])

  const onChanged = useCallback((next: ConnectorSummary) => {
    setConnectors((prev) => prev.map((c) => (c.descriptor.id === next.descriptor.id ? next : c)))
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connectors</CardTitle>
        <CardDescription>
          Connect external systems — Microsoft 365 (calendar + contacts) and Slack — to feed meetings, people, and
          knowledge into your library.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading connectors…</p>
        ) : connectors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No connectors available.</p>
        ) : (
          connectors.map((c) => <ConnectorCard key={c.descriptor.id} summary={c} onChanged={onChanged} />)
        )}
      </CardContent>
    </Card>
  )
}
