import { useState } from 'react'
import { cn } from '../../lib/utils'
import { getElectronAPI } from '../../lib/electron-api'

interface TitlebarProps {
  pageName: string
}

export function Titlebar({ pageName }: TitlebarProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  const handleMinimize = () => {
    const api = getElectronAPI()
    if (!api) return
    api.window.minimize()
  }

  const handleMaximize = async () => {
    const api = getElectronAPI()
    if (!api) return
    await api.window.maximize()
    const maximized = await api.window.isMaximized()
    setIsMaximized(maximized)
  }

  const handleClose = () => {
    const api = getElectronAPI()
    if (!api) return
    api.window.close()
  }

  return (
    <div className="flex items-center h-12 px-4 border-b border-border bg-background titlebar-drag-region shrink-0">
      {/* Left: Page breadcrumb */}
      <span className="font-sans text-sm text-muted-foreground">{pageName}</span>

      {/* Right: Window controls */}
      <div className="titlebar-no-drag flex items-center gap-2 ml-auto">
        {/* Minimize — amber */}
        <button
          onClick={handleMinimize}
          aria-label="Minimize"
          className={cn(
            'w-3 h-3 rounded-full',
            'bg-[hsl(var(--status-warning))]',
            'hover:brightness-110 hover:scale-110',
            'transition-all duration-[var(--duration-micro,100ms)]',
          )}
        />

        {/* Maximize / Restore — green */}
        <button
          onClick={handleMaximize}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          className={cn(
            'w-3 h-3 rounded-full',
            'bg-[hsl(var(--status-success))]',
            'hover:brightness-110 hover:scale-110',
            'transition-all duration-[var(--duration-micro,100ms)]',
          )}
        />

        {/* Close — red */}
        <button
          onClick={handleClose}
          aria-label="Close"
          className={cn(
            'w-3 h-3 rounded-full',
            'bg-[hsl(var(--destructive))]',
            'hover:brightness-110 hover:scale-110',
            'transition-all duration-[var(--duration-micro,100ms)]',
          )}
        />
      </div>
    </div>
  )
}
