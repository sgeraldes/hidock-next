/**
 * Features settings — Track I phase 1: MINIMAL preset selector only.
 *
 * The full per-feature panel (cards, individual toggles, cascade confirm dialog)
 * is phase I3. This slice ships just the named-preset dropdown so "HiDock
 * Library Management" actually stops transcription/assistant/graph/calendar
 * work, plus an honest summary of what the selected preset turns off and a
 * restart banner when a change can't apply live.
 */

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RotateCcw } from 'lucide-react'
import { useConfigStore } from '@/store/domain/useConfigStore'
import { usePendingRestart, useFeatureStore, describeDisableReason } from '@/store/useFeatureStore'
import {
  ALL_FEATURE_IDS,
  FEATURES,
  PRESET_INFO,
  type PresetId,
} from '@/shared/feature-registry'
import { toast } from '@/components/ui/toaster'

const SELECTABLE_PRESETS: PresetId[] = ['library-only', 'library-transcription', 'full', 'custom']

export function FeaturesSettings(): React.ReactElement {
  const { config, updateConfig } = useConfigStore()
  const resolved = useFeatureStore((s) => s.resolved)
  const pendingRestart = usePendingRestart()
  const [saving, setSaving] = useState(false)

  const preset: PresetId = config?.features?.preset ?? 'full'

  const applyPreset = async (next: PresetId) => {
    if (next === preset) return
    setSaving(true)
    try {
      // Switching to a NAMED preset clears the sparse flag overrides so the
      // preset's baseline is authoritative; `custom` keeps the current flags.
      const flags = next === 'custom' ? (config?.features?.flags ?? {}) : {}
      await updateConfig('features', { preset: next, flags })
      toast({
        title: 'Feature preset applied',
        description: PRESET_INFO[next].label,
        variant: 'success',
      })
    } catch (e) {
      toast.error('Failed to apply preset', e instanceof Error ? e.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  // Honest summary of what the CURRENT resolved state turns off (incl. cascade).
  const disabled = ALL_FEATURE_IDS.filter(
    (id) => !id.startsWith('connector:') && !resolved[id]?.enabled
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Features</CardTitle>
        <CardDescription>
          Choose how much of the app runs. Smaller presets skip background work entirely.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="feature-preset" className="text-sm font-medium">
            Preset
          </label>
          <select
            id="feature-preset"
            aria-label="Feature preset"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={preset}
            disabled={saving}
            onChange={(e) => applyPreset(e.target.value as PresetId)}
          >
            {SELECTABLE_PRESETS.map((id) => (
              <option key={id} value={id}>
                {PRESET_INFO[id].label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{PRESET_INFO[preset].description}</p>
        </div>

        {disabled.length > 0 && (
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium">Turned off by this preset:</p>
            <ul className="mt-1 space-y-0.5">
              {disabled.map((id) => (
                <li key={id} className="text-xs text-muted-foreground">
                  {FEATURES[id].label}
                  {resolved[id]?.reason?.startsWith('requires:') && (
                    <span className="ml-1 text-muted-foreground/70">
                      — {describeDisableReason(resolved[id]?.reason)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {pendingRestart.length > 0 && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
          >
            <p className="text-xs">
              Restart required to enable:{' '}
              <span className="font-medium">
                {pendingRestart.map((id) => FEATURES[id].label).join(', ')}
              </span>
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => window.electronAPI?.app?.restart()}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restart now
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
