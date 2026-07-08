import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

/**
 * Lightweight hover-card built on the Radix Popover primitive (no extra npm
 * package — @radix-ui/react-hover-card is not installed). Opens on pointer hover
 * and on keyboard focus, with an open/close delay so brief cursor passes don't
 * flicker the card. The content also keeps the card open while hovered so the
 * user can move the pointer from trigger to card.
 */

interface HoverCardContextValue {
  open: boolean
  handleOpen: () => void
  handleClose: () => void
}

const HoverCardContext = React.createContext<HoverCardContextValue | null>(null)

function useHoverCardContext(): HoverCardContextValue {
  const ctx = React.useContext(HoverCardContext)
  if (!ctx) throw new Error('HoverCard components must be used within <HoverCard>')
  return ctx
}

interface HoverCardProps {
  children: React.ReactNode
  openDelay?: number
  closeDelay?: number
  onOpenChange?: (open: boolean) => void
}

function HoverCard({ children, openDelay = 250, closeDelay = 150, onOpenChange }: HoverCardProps) {
  const [open, setOpen] = React.useState(false)
  const openTimer = React.useRef<ReturnType<typeof setTimeout>>()
  const closeTimer = React.useRef<ReturnType<typeof setTimeout>>()

  const clearTimers = React.useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const setOpenState = React.useCallback(
    (next: boolean) => {
      setOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange]
  )

  const handleOpen = React.useCallback(() => {
    clearTimers()
    openTimer.current = setTimeout(() => setOpenState(true), openDelay)
  }, [clearTimers, openDelay, setOpenState])

  const handleClose = React.useCallback(() => {
    clearTimers()
    closeTimer.current = setTimeout(() => setOpenState(false), closeDelay)
  }, [clearTimers, closeDelay, setOpenState])

  React.useEffect(() => clearTimers, [clearTimers])

  return (
    <HoverCardContext.Provider value={{ open, handleOpen, handleClose }}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpenState} modal={false}>
        {children}
      </PopoverPrimitive.Root>
    </HoverCardContext.Provider>
  )
}

interface HoverCardTriggerProps {
  children: React.ReactNode
  /** When true, merge trigger behavior onto the single child instead of a wrapper span. */
  asChild?: boolean
  className?: string
}

const HoverCardTrigger = React.forwardRef<HTMLElement, HoverCardTriggerProps>(
  ({ children, asChild = false, className }, ref) => {
    const { handleOpen, handleClose } = useHoverCardContext()
    const handlers = {
      onMouseEnter: handleOpen,
      onMouseLeave: handleClose,
      onFocus: handleOpen,
      onBlur: handleClose
    }

    if (asChild) {
      return (
        <PopoverPrimitive.Anchor asChild>
          <Slot ref={ref} {...handlers}>
            {children}
          </Slot>
        </PopoverPrimitive.Anchor>
      )
    }

    return (
      <PopoverPrimitive.Anchor asChild>
        <span ref={ref as React.Ref<HTMLSpanElement>} className={cn('inline-flex', className)} {...handlers}>
          {children}
        </span>
      </PopoverPrimitive.Anchor>
    )
  }
)
HoverCardTrigger.displayName = 'HoverCardTrigger'

const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 6, ...props }, ref) => {
  const { handleOpen, handleClose } = useHoverCardContext()
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        // Hover cards are informational — never steal focus from the trigger.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        className={cn(
          'z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})
HoverCardContent.displayName = 'HoverCardContent'

export { HoverCard, HoverCardTrigger, HoverCardContent }
