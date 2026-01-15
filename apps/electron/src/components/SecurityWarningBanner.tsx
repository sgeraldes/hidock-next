import { useEffect, useState } from 'react'

export function SecurityWarningBanner(): React.ReactElement | null {
  const [warning, setWarning] = useState<string | null>(null)

  useEffect(() => {
    // Use the electronAPI exposed by preload script
    const cleanup = window.electronAPI?.onSecurityWarning((data) => {
      if (data.type === 'remote-debugging-enabled') {
        setWarning(data.message)
      }
    })
    return () => {
      cleanup?.()
    }
  }, [])

  if (!warning) return null

  return (
    <div
      style={{
        background: '#dc2626',
        color: 'white',
        padding: '8px 16px',
        textAlign: 'center',
        fontWeight: 'bold',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999
      }}
    >
      {'\u26A0\uFE0F'} {warning}
    </div>
  )
}
