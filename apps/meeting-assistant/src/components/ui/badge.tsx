import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1",
    "rounded px-1.5 py-0.5",
    "font-sans text-[11px] font-medium leading-none tracking-wide",
    "border",
    "transition-colors duration-micro",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-primary/15 text-primary border-primary/20",
        ].join(" "),
        live: [
          "bg-status-live/15 text-status-live border-status-live/25",
        ].join(" "),
        success: [
          "bg-status-success/15 text-status-success border-status-success/25",
        ].join(" "),
        warning: [
          "bg-status-warning/15 text-status-warning border-status-warning/25",
        ].join(" "),
        info: [
          "bg-status-info/15 text-status-info border-status-info/25",
        ].join(" "),
        accent: [
          "bg-accent/15 text-accent border-accent/25",
        ].join(" "),
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
