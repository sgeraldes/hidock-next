import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5",
    "font-sans font-medium tracking-tight",
    "rounded-md border border-transparent",
    "transition-all duration-standard ease-standard",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-40",
    "select-none",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          "bg-primary text-primary-foreground",
          "hover:brightness-110 active:brightness-95",
          "shadow-raised",
        ].join(" "),
        secondary: [
          "bg-secondary text-secondary-foreground border-border",
          "hover:bg-secondary/80 active:bg-secondary/60",
        ].join(" "),
        ghost: [
          "text-foreground",
          "hover:bg-muted active:bg-muted/60",
        ].join(" "),
        destructive: [
          "bg-destructive/10 text-destructive border-destructive/20",
          "hover:bg-destructive/20 active:bg-destructive/30",
        ].join(" "),
        outline: [
          "bg-transparent text-foreground border-border",
          "hover:bg-muted hover:border-border/80 active:bg-muted/60",
        ].join(" "),
      },
      size: {
        sm: "h-7 px-2.5 text-xs rounded",
        default: "h-[34px] px-3.5 text-[13px]",
        lg: "h-10 px-[18px] text-sm",
        icon: "h-[34px] w-[34px] rounded-md",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
