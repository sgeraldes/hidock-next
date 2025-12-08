import * as React from 'react'
import { cn } from '@/lib/utils'

interface SliderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value?: number[]
  defaultValue?: number[]
  min?: number
  max?: number
  step?: number
  onValueChange?: (value: number[]) => void
  disabled?: boolean
}

const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  (
    {
      className,
      value,
      defaultValue = [0],
      min = 0,
      max = 100,
      step = 1,
      onValueChange,
      disabled = false,
      ...props
    },
    ref
  ) => {
    const [internalValue, setInternalValue] = React.useState(defaultValue)
    const currentValue = value ?? internalValue
    const trackRef = React.useRef<HTMLDivElement>(null)

    const percentage = Math.min(100, Math.max(0, ((currentValue[0] - min) / (max - min)) * 100))

    const updateValue = React.useCallback(
      (clientX: number) => {
        if (disabled || !trackRef.current) return

        const rect = trackRef.current.getBoundingClientRect()
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
        const rawValue = min + percent * (max - min)
        const steppedValue = Math.round(rawValue / step) * step
        const clampedValue = Math.max(min, Math.min(max, steppedValue))

        const newValue = [clampedValue]
        setInternalValue(newValue)
        onValueChange?.(newValue)
      },
      [disabled, min, max, step, onValueChange]
    )

    const handleMouseDown = React.useCallback(
      (e: React.MouseEvent) => {
        if (disabled) return
        e.preventDefault()
        updateValue(e.clientX)

        const handleMouseMove = (e: MouseEvent) => {
          updateValue(e.clientX)
        }

        const handleMouseUp = () => {
          document.removeEventListener('mousemove', handleMouseMove)
          document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
      },
      [disabled, updateValue]
    )

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent) => {
        if (disabled) return

        let newValue = currentValue[0]

        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowUp':
            newValue = Math.min(max, currentValue[0] + step)
            break
          case 'ArrowLeft':
          case 'ArrowDown':
            newValue = Math.max(min, currentValue[0] - step)
            break
          case 'Home':
            newValue = min
            break
          case 'End':
            newValue = max
            break
          default:
            return
        }

        e.preventDefault()
        const newValueArray = [newValue]
        setInternalValue(newValueArray)
        onValueChange?.(newValueArray)
      },
      [disabled, currentValue, min, max, step, onValueChange]
    )

    return (
      <div
        ref={ref}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={currentValue[0]}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className={cn(
          'relative flex w-full touch-none select-none items-center',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {/* Track */}
        <div
          ref={trackRef}
          className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20"
        >
          {/* Range (filled portion) */}
          <div
            className="absolute h-full bg-primary transition-all"
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Thumb */}
        <div
          className={cn(
            'absolute block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors',
            'hover:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            disabled && 'pointer-events-none'
          )}
          style={{ left: `calc(${percentage}% - 8px)` }}
        />
      </div>
    )
  }
)
Slider.displayName = 'Slider'

export { Slider }
