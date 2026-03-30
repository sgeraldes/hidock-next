import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Wifi, Loader2 } from 'lucide-react'
import { useSettingsStore } from '../stores/settings-store'
import type { SettingsKey, SettingsMap, SettingsCategoryGroup, SettingEntry } from '../types/models'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { ScrollArea } from '../components/ui/scroll-area'
import { cn } from '../lib/utils'
import { getElectronAPI } from '../lib/electron-api'

// ── Toggle component ───────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}

function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors duration-standard ease-standard',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'bg-primary' : 'bg-muted-foreground/30'
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm',
          'transition-transform duration-standard ease-standard',
          checked ? 'translate-x-4' : 'translate-x-0'
        )}
      />
    </button>
  )
}

// ── Setting row ────────────────────────────────────────────────────────────────

interface SettingRowProps {
  entry: SettingEntry
  currentValue: SettingsMap[SettingsKey] | undefined
  onChange: (key: SettingsKey, value: SettingsMap[SettingsKey]) => void
}

function SettingRow({ entry, currentValue, onChange }: SettingRowProps) {
  const { definition } = entry
  const value = currentValue !== undefined ? currentValue : entry.value

  // Generate a human-readable label from the key
  const rawLabel = definition.key.split('.').pop() ?? definition.key
  const label = rawLabel
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()

  function renderControl() {
    if (definition.type === 'boolean') {
      return (
        <Toggle
          checked={Boolean(value)}
          onChange={(v) => onChange(definition.key, v as SettingsMap[SettingsKey])}
        />
      )
    }

    if (definition.type === 'enum' && definition.enumValues) {
      return (
        <Select
          value={String(value ?? '')}
          onValueChange={(v) => onChange(definition.key, v as SettingsMap[SettingsKey])}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {definition.enumValues.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (definition.type === 'number') {
      return (
        <Input
          type="number"
          className="w-32 font-mono"
          value={value !== undefined && value !== null ? String(value) : ''}
          min={definition.min}
          max={definition.max}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value)
            if (!isNaN(parsed)) {
              onChange(definition.key, parsed as SettingsMap[SettingsKey])
            }
          }}
        />
      )
    }

    // string / path — masked if key contains "apikey" or "key"
    const isSecret = definition.key.toLowerCase().includes('apikey') || definition.key.toLowerCase().includes('.key')
    return (
      <Input
        type={isSecret ? 'password' : 'text'}
        className="w-64 font-mono text-[12px]"
        value={value !== null && value !== undefined ? String(value) : ''}
        onChange={(e) => onChange(definition.key, e.target.value as SettingsMap[SettingsKey])}
        placeholder={definition.nullable ? '(optional)' : undefined}
      />
    )
  }

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border/40 last:border-0">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="font-sans text-[13px] font-medium text-foreground">{label}</span>
        <span className="font-mono text-[11px] text-muted-foreground/60">{definition.key}</span>
      </div>
      <div className="shrink-0">{renderControl()}</div>
    </div>
  )
}

// ── Test connection banner ─────────────────────────────────────────────────────

interface ConnectionTestResult {
  success: boolean
  error?: string
}

function ConnectionBanner({ result }: { result: ConnectionTestResult | null }) {
  if (!result) return null
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-md border text-[13px] font-sans',
        result.success
          ? 'bg-status-success/10 border-status-success/30 text-status-success'
          : 'bg-destructive/10 border-destructive/30 text-destructive'
      )}
    >
      {result.success ? (
        <CheckCircle className="w-4 h-4 shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 shrink-0" />
      )}
      <span>{result.success ? 'Connection successful' : result.error ?? 'Connection failed'}</span>
    </div>
  )
}

// ── Category tab content ───────────────────────────────────────────────────────

interface CategoryPanelProps {
  group: SettingsCategoryGroup
  settings: Partial<SettingsMap>
  onChange: (key: SettingsKey, value: SettingsMap[SettingsKey]) => void
  isAI?: boolean
}

function CategoryPanel({ group, settings, onChange, isAI }: CategoryPanelProps) {
  const { testConnection } = useSettingsStore()
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)
  const [testing, setTesting] = useState(false)

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    const result = await testConnection()
    setTestResult(result)
    setTesting(false)
  }

  return (
    <div className="flex flex-col gap-4">
      {isAI && (
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wifi className="w-3.5 h-3.5" />
            )}
            {testing ? 'Testing…' : 'Test Connection'}
          </Button>
          <ConnectionBanner result={testResult} />
        </div>
      )}

      <div className="flex flex-col">
        {group.settings.map((entry) => (
          <SettingRow
            key={entry.definition.key}
            entry={entry}
            currentValue={settings[entry.definition.key]}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  )
}

// ── Tab definitions ───────────────────────────────────────────────────────────

const TAB_ORDER = ['ai', 'kb', 'suggestions', 'screenshots', 'calendar', 'mic', 'correlation', 'notes'] as const

const TAB_LABELS: Record<string, string> = {
  ai: 'AI Provider',
  kb: 'Knowledge Base',
  suggestions: 'Suggestions',
  screenshots: 'Screenshots',
  calendar: 'Calendar',
  mic: 'Microphone',
  correlation: 'Correlation',
  notes: 'Notes',
}

// ── Settings Page ─────────────────────────────────────────────────────────────

export default function Settings() {
  const { settings, loading, fetchAll, fetchCategory, set: setSetting } = useSettingsStore()
  const [groups, setGroups] = useState<SettingsCategoryGroup[]>([])
  const [activeTab, setActiveTab] = useState('ai')
  const [loadingCategories, setLoadingCategories] = useState(true)

  // Fetch all settings and categories on mount
  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    async function loadCategories() {
      setLoadingCategories(true)
      const loaded: SettingsCategoryGroup[] = []

      for (const cat of TAB_ORDER) {
        try {
          // fetchCategory updates the store; we read back via the API
          await fetchCategory(cat)
          const api = getElectronAPI()
          const group = api ? await api.settings.getCategory(cat) : null
          if (group) loaded.push(group)
        } catch {
          // ignore individual category errors
        }
      }

      setGroups(loaded)
      setLoadingCategories(false)
    }

    loadCategories()
  }, [fetchCategory])

  async function handleChange(key: SettingsKey, value: SettingsMap[SettingsKey]) {
    await setSetting(key, value)
  }

  const orderedGroups = TAB_ORDER
    .map((cat) => groups.find((g) => g.category === cat))
    .filter(Boolean) as SettingsCategoryGroup[]

  return (
    <div className="flex flex-col h-full p-6 gap-5 min-h-0">
      {/* Page header */}
      <div className="shrink-0">
        <h1 className="font-display text-2xl font-bold text-foreground tracking-tight">Settings</h1>
        <p className="font-sans text-sm text-muted-foreground mt-1">
          Configure your Meeting Assistant preferences and integrations
        </p>
      </div>

      {/* Content — centered, max width */}
      <div className="flex-1 min-h-0 flex justify-center">
        <div className="w-full max-w-[640px] flex flex-col min-h-0">
          {loading && loadingCategories ? (
            <div className="flex items-center justify-center flex-1">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : orderedGroups.length === 0 ? (
            <div className="flex items-center justify-center flex-1">
              <p className="font-sans text-sm text-muted-foreground">No settings available</p>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col min-h-0 flex-1">
              {/* Tab list — scrollable */}
              <div className="overflow-x-auto shrink-0">
                <TabsList className="min-w-max">
                  {orderedGroups.map((group) => (
                    <TabsTrigger key={group.category} value={group.category}>
                      {TAB_LABELS[group.category] ?? group.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              {/* Tab panels */}
              <ScrollArea className="flex-1 min-h-0">
                <div className="pr-2 pb-6">
                  {orderedGroups.map((group) => (
                    <TabsContent key={group.category} value={group.category}>
                      <CategoryPanel
                        group={group}
                        settings={settings}
                        onChange={handleChange}
                        isAI={group.category === 'ai'}
                      />
                    </TabsContent>
                  ))}
                </div>
              </ScrollArea>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  )
}
