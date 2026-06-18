import { titleCase } from '@data/format'

interface StatusBadgeProps {
  value: string
  tone?: 'neutral' | 'good' | 'warning'
}

export function StatusBadge({ value, tone = 'neutral' }: StatusBadgeProps): JSX.Element {
  return <span className={`status-badge status-badge--${tone}`}>{titleCase(value)}</span>
}
