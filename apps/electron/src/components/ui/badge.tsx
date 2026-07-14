import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Entity-typed badge/chip. Colors match the per-entity palette used across the
// app (person=blue, project=emerald, meeting=violet, date=amber, neutral=muted).
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-tight transition-colors',
  {
    variants: {
      variant: {
        person:
          'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300',
        project:
          'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        meeting:
          'border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300',
        date:
          'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        neutral: 'border-border bg-muted text-muted-foreground'
      }
    },
    defaultVariants: {
      variant: 'neutral'
    }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
