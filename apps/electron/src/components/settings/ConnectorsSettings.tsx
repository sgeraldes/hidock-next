import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  RefreshCw,
  Plug,
  PlugZap,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  Plus,
  Trash2,
  Settings2,
  Globe,
} from 'lucide-react'
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
  const detail = status.detail as
    | { mode?: string; verificationUri?: string; userCode?: string; fullMessage?: string }
    | undefined
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

/** The browser (auth-code) prompt — shown while the system browser is opened. */
function AuthCodePrompt({ status }: { status: ConnectorStatus }) {
  const detail = status.detail as { mode?: string; authUrl?: string; fullMessage?: string } | undefined
  if (detail?.mode !== 'auth-code' || !detail.authUrl) return null
  return (
    <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm">
      <p className="mb-2 inline-flex items-center gap-1.5 text-blue-800 dark:text-blue-200">
        <Globe className="h-4 w-4" aria-hidden="true" />
        We opened your browser to sign in to Microsoft. Approve access there, then return here.
      </p>
      <a
        href={detail.authUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-medium text-primary underline"
      >
        Didn’t see it? Open the sign-in page
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
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
        App registration steps ({steps.length})
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

/**
 * A single connector account (INSTANCE). Handles config, connect/disconnect,
 * sources, and sync — all keyed by `summary.instanceId`.
 */
function AccountBlock({
  summary,
  onChanged,
  onRemoved,
}: {
  summary: ConnectorSummary
  onChanged: (s: ConnectorSummary) => void
  onRemoved?: (instanceId: string) => void
}) {
  const { descriptor, status, instanceId } = summary
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of summary.fields) init[f.key] = f.secret ? '' : String(f.value ?? '')
    return init
  })
  const [busy, setBusy] = useState<null | 'save' | 'connect' | 'disconnect' | 'sync' | 'sources' | 'remove'>(null)
  const [containers, setContainers] = useState<SourceContainer[]>([])
  // Whether the "own app registration (advanced)" path is revealed. When a
  // default app ships (setupOptional), the walkthrough + advanced fields collapse.
  const hasOwnClientId = useMemo(
    () => summary.fields.some((f) => f.key === 'clientId' && String(f.value ?? '') !== ''),
    [summary.fields]
  )
  const [showAdvanced, setShowAdvanced] = useState(() => !descriptor.setupOptional || hasOwnClientId)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(summary.label)

  const isConnected = status.state === 'connected' || status.state === 'syncing'
  const interactiveAuth = descriptor.auth.kind === 'oauth' || descriptor.auth.kind === 'device-code'

  // Which config fields to render: hide `advanced` ones until revealed.
  const visibleFields = descriptor.configFields.filter(
    (f) => !(f.advanced && descriptor.setupOptional && !showAdvanced)
  )

  const dirty = useMemo(
    () =>
      visibleFields.some((f) => {
        const view = summary.fields.find((sf) => sf.key === f.key)
        return f.secret ? values[f.key] !== '' : values[f.key] !== String(view?.value ?? '')
      }),
    [visibleFields, summary.fields, values]
  )

  const save = async () => {
    setBusy('save')
    try {
      const next = await window.electronAPI.connectors.configure(instanceId, values)
      onChanged(next)
      setValues((v) => {
        const cleared = { ...v }
        for (const f of descriptor.configFields) if (f.secret) cleared[f.key] = ''
        return cleared
      })
      toast.success(`${summary.label} settings saved`)
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const connect = async (authMode?: 'auth-code' | 'device-code') => {
    setBusy('connect')
    try {
      const next = await window.electronAPI.connectors.connect(instanceId, authMode)
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
      const next = await window.electronAPI.connectors.disconnect(instanceId)
      onChanged(next)
      setContainers([])
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('remove')
    try {
      await window.electronAPI.connectors.removeInstance(instanceId)
      onRemoved?.(instanceId)
      toast.success(`${summary.label} removed`)
    } catch (e) {
      toast.error(`Remove failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const saveLabel = async () => {
    const trimmed = labelDraft.trim()
    setEditingLabel(false)
    if (!trimmed || trimmed === summary.label) return
    try {
      const next = await window.electronAPI.connectors.setInstanceLabel(instanceId, trimmed)
      onChanged(next)
    } catch {
      /* ignore */
    }
  }

  const loadSources = useCallback(async () => {
    setBusy('sources')
    try {
      const list = await window.electronAPI.connectors.listContainers(instanceId)
      setContainers(list)
    } catch {
      /* ignore */
    } finally {
      setBusy(null)
    }
  }, [instanceId])

  useEffect(() => {
    if (isConnected && descriptor.capabilityKinds.includes('sources') && containers.length === 0) {
      void loadSources()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected])

  const sync = async () => {
    setBusy('sync')
    try {
      const outcome = await window.electronAPI.connectors.sync(instanceId)
      onChanged(await window.electronAPI.connectors.get(instanceId))
      toast.success(
        `${summary.label} synced — ${outcome.meetings} meetings, ${outcome.contacts} contacts, ${outcome.artifacts} files`
      )
    } catch (e) {
      toast.error(`Sync failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const sourceState = useMemo(
    () => new Map(summary.sources?.map((s) => [s.externalId, s]) ?? []),
    [summary.sources]
  )

  const toggleSource = async (containerId: string, enabled: boolean) => {
    try {
      const next = await window.electronAPI.connectors.setSourceEnabled(instanceId, containerId, enabled)
      onChanged(next)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {summary.multiInstance && editingLabel ? (
              <Input
                value={labelDraft}
                autoFocus
                onChange={(e) => setLabelDraft(e.target.value)}
                onBlur={saveLabel}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveLabel()
                  if (e.key === 'Escape') {
                    setLabelDraft(summary.label)
                    setEditingLabel(false)
                  }
                }}
                className="h-7 w-56"
                aria-label="Account label"
              />
            ) : (
              <button
                type="button"
                className="truncate font-semibold text-left hover:underline disabled:no-underline"
                onClick={() => summary.multiInstance && setEditingLabel(true)}
                disabled={!summary.multiInstance}
                title={summary.multiInstance ? 'Rename account' : undefined}
              >
                {summary.label}
              </button>
            )}
            <StatusBadge status={status} />
          </div>
        </div>
        {summary.multiInstance && onRemoved && (
          <Button
            variant="ghost"
            size="sm"
            onClick={remove}
            disabled={busy !== null}
            aria-label={`Remove ${summary.label}`}
            className="text-muted-foreground hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {status.state === 'error' && status.message && (
        <p className="text-sm text-red-600 dark:text-red-400">{status.message}</p>
      )}

      {status.state === 'connecting' && <AuthCodePrompt status={status} />}
      {status.state === 'connecting' && <DeviceCodePrompt status={status} />}

      {/* Advanced disclosure for zero-setup (default-app) connectors. */}
      {descriptor.setupOptional && (
        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={showAdvanced}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Use your own app registration (advanced)
          {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      )}

      {/* Setup steps: always for non-optional; only when advanced-revealed otherwise. */}
      {descriptor.auth.setupSteps &&
        descriptor.auth.setupSteps.length > 0 &&
        (!descriptor.setupOptional || showAdvanced) && (
          <SetupSteps steps={descriptor.auth.setupSteps} docsUrl={descriptor.auth.docsUrl} />
        )}

      {visibleFields.length > 0 && (
        <div className="space-y-3">
          {visibleFields.map((field) => {
            const view = summary.fields.find((f) => f.key === field.key)
            const placeholder = field.secret && view?.hasValue ? '•••••••• (saved)' : field.placeholder
            return (
              <div key={field.key}>
                <label htmlFor={`${instanceId}-${field.key}`} className="text-sm font-medium">
                  {field.label}
                  {field.required && <span className="text-red-500"> *</span>}
                </label>
                <Input
                  id={`${instanceId}-${field.key}`}
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
        {visibleFields.length > 0 && (
          <Button onClick={save} disabled={busy !== null || !dirty} size="sm">
            {busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </Button>
        )}
        {isConnected ? (
          <Button variant="outline" size="sm" onClick={disconnect} disabled={busy !== null}>
            <PlugZap className="mr-1.5 h-4 w-4" /> Disconnect
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={() => connect('auth-code')} disabled={busy !== null}>
              <Plug className="mr-1.5 h-4 w-4" /> {busy === 'connect' ? 'Connecting…' : 'Connect'}
            </Button>
            {interactiveAuth && (
              <button
                type="button"
                onClick={() => connect('device-code')}
                disabled={busy !== null}
                className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
              >
                Use a code instead
              </button>
            )}
          </>
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

/**
 * One card per connector TYPE. Renders the type's description once, then each
 * configured account (instance). Multi-instance types get an "Add account" button.
 */
function ConnectorTypeCard({
  descriptorId,
  accounts,
  onChanged,
  onAdded,
  onRemoved,
}: {
  descriptorId: string
  accounts: ConnectorSummary[]
  onChanged: (s: ConnectorSummary) => void
  onAdded: (s: ConnectorSummary) => void
  onRemoved: (instanceId: string) => void
}) {
  const descriptor = accounts[0]?.descriptor
  const multi = accounts[0]?.multiInstance ?? false
  const [adding, setAdding] = useState(false)

  const addAccount = async () => {
    setAdding(true)
    try {
      const created = await window.electronAPI.connectors.addInstance(descriptorId)
      onAdded(created)
    } catch (e) {
      toast.error(`Add account failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAdding(false)
    }
  }

  if (!descriptor) return null

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{descriptor.displayName}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{descriptor.description}</p>
        </div>
        {multi && (
          <Button variant="outline" size="sm" onClick={addAccount} disabled={adding}>
            <Plus className="mr-1.5 h-4 w-4" /> {adding ? 'Adding…' : 'Add account'}
          </Button>
        )}
      </div>
      <div className="space-y-3">
        {accounts.map((a) => (
          <AccountBlock
            key={a.instanceId}
            summary={a}
            onChanged={onChanged}
            // Allow removal only when more than one account exists, so the type
            // card (and its "Add account" button) never disappears entirely.
            onRemoved={multi && accounts.length > 1 ? onRemoved : undefined}
          />
        ))}
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
      setConnectors((prev) => prev.map((c) => (c.instanceId === id ? { ...c, status } : c)))
    })
    return unsubscribe
  }, [load])

  const onChanged = useCallback((next: ConnectorSummary) => {
    setConnectors((prev) => prev.map((c) => (c.instanceId === next.instanceId ? next : c)))
  }, [])

  const onAdded = useCallback((next: ConnectorSummary) => {
    setConnectors((prev) => [...prev, next])
  }, [])

  const onRemoved = useCallback((instanceId: string) => {
    setConnectors((prev) => prev.filter((c) => c.instanceId !== instanceId))
  }, [])

  // Group instances by connector type, preserving first-seen order.
  const groups = useMemo(() => {
    const map = new Map<string, ConnectorSummary[]>()
    for (const c of connectors) {
      const t = c.descriptor.id
      if (!map.has(t)) map.set(t, [])
      map.get(t)!.push(c)
    }
    return [...map.entries()]
  }, [connectors])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connectors</CardTitle>
        <CardDescription>
          Connect external systems — Microsoft 365 (calendar + contacts) and Slack — to feed meetings, people, and
          knowledge into your library. Microsoft 365 supports multiple accounts (e.g. personal + work).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading connectors…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No connectors available.</p>
        ) : (
          groups.map(([type, accounts]) => (
            <ConnectorTypeCard
              key={type}
              descriptorId={type}
              accounts={accounts}
              onChanged={onChanged}
              onAdded={onAdded}
              onRemoved={onRemoved}
            />
          ))
        )}
      </CardContent>
    </Card>
  )
}
