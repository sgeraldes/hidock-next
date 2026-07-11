/**
 * FeatureDisabledPage + FeatureRoute — Track I, Gate 3 (honest route guard).
 *
 * When a route's owning feature is disabled we render an HONEST page — the
 * feature's name, WHY it is off (user / preset / cascade `requires:X`), and a
 * one-click way to turn it back on — never a blank screen, a crash, or a silent
 * redirect. Deep links to a disabled surface (e.g. `/meeting/:id` while Calendar
 * is off) land here too.
 */

import { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Settings as SettingsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FEATURES, type FeatureId } from '@/shared/feature-registry'
import { useFeatureResolved, describeDisableReason } from '@/store/useFeatureStore'

export function FeatureDisabledPage({ feature }: { feature: FeatureId }): React.ReactElement {
  const navigate = useNavigate()
  const resolved = useFeatureResolved(feature)
  const def = FEATURES[feature]
  const why = describeDisableReason(resolved?.reason) ?? 'This feature is turned off.'
  const needsRestart = resolved && !resolved.runtimeToggleable

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <Lock className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold">{def.label} is turned off</h1>
        <p className="mt-2 text-sm text-muted-foreground">{def.description}</p>
        <p className="mt-4 text-sm font-medium text-foreground">{why}</p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={() => navigate('/settings#features')} className="gap-2">
            <SettingsIcon className="h-4 w-4" />
            Enable in Settings
          </Button>
        </div>
        {needsRestart && (
          <p className="mt-3 text-xs text-muted-foreground">
            Enabling {def.label} takes effect after a restart.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Route wrapper: renders `children` when `feature` is enabled, otherwise the
 * honest FeatureDisabledPage. Re-evaluates on store change, so an open page swaps
 * to the disabled page live if the feature is turned off while it is showing.
 */
export function FeatureRoute({
  feature,
  children,
}: {
  feature: FeatureId
  children: ReactNode
}): React.ReactElement {
  const resolved = useFeatureResolved(feature)
  // Default to enabled when unknown (config not yet loaded) so we never flash the
  // disabled page during the initial config fetch under the default `full` preset.
  const enabled = resolved?.enabled ?? true
  if (!enabled) return <FeatureDisabledPage feature={feature} />
  return <>{children}</>
}
