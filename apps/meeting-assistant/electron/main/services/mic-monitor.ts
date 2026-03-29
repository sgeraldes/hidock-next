export type MicStatus = 'active' | 'inactive'
export type MicStatusListener = (status: MicStatus) => void

export class MicMonitor {
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private lastStatus: MicStatus = 'inactive'
  private listeners: Set<MicStatusListener> = new Set()
  private pollIntervalMs: number

  constructor(pollIntervalMs = 3000) {
    this.pollIntervalMs = pollIntervalMs
  }

  start(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => void this.checkMic(), this.pollIntervalMs)
    void this.checkMic()  // immediate first check
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  on(listener: MicStatusListener): void {
    this.listeners.add(listener)
  }

  off(listener: MicStatusListener): void {
    this.listeners.delete(listener)
  }

  getStatus(): MicStatus {
    return this.lastStatus
  }

  private async checkMic(): Promise<void> {
    try {
      const status = await this.detectMicActivity()
      if (status !== this.lastStatus) {
        this.lastStatus = status
        for (const listener of this.listeners) {
          try { listener(status) } catch { /* ignore */ }
        }
      }
    } catch {
      // Silently fail — mic detection is best-effort
    }
  }

  private async detectMicActivity(): Promise<MicStatus> {
    const platform = process.platform

    if (platform === 'win32') {
      return this.detectWindows()
    } else if (platform === 'darwin') {
      return this.detectMacOS()
    } else {
      return this.detectLinux()
    }
  }

  private async detectWindows(): Promise<MicStatus> {
    // Check Windows registry for mic usage via PowerShell
    // Uses the same approach as meeting-recorder's MicDetector
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const exec = promisify(execFile)

    try {
      const { stdout } = await exec('powershell', [
        '-NoProfile', '-Command',
        'Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\*\\*" -Name LastUsedTimeStart -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LastUsedTimeStart | Sort-Object -Descending | Select-Object -First 1',
      ], { timeout: 5000 })

      const timestamp = parseInt(stdout.trim(), 10)
      if (isNaN(timestamp) || timestamp === 0) return 'inactive'

      // Windows FILETIME: 100-nanosecond intervals since 1601-01-01
      // Convert to Unix ms: subtract epoch diff, divide by 10000
      const EPOCH_DIFF = 11644473600000n // ms between 1601 and 1970
      const unixMs = Number(BigInt(timestamp) / 10000n - EPOCH_DIFF)
      const ageMs = Date.now() - unixMs

      // Active if used within last 30 seconds (grace period)
      return ageMs < 30_000 ? 'active' : 'inactive'
    } catch {
      return 'inactive'
    }
  }

  private async detectMacOS(): Promise<MicStatus> {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const exec = promisify(execFile)

    try {
      const { stdout } = await exec('lsof', ['-c', 'coreaudiod'], { timeout: 5000 })
      // If coreaudiod has open files, mic may be active
      return stdout.includes('KQUEUE') ? 'active' : 'inactive'
    } catch {
      return 'inactive'
    }
  }

  private async detectLinux(): Promise<MicStatus> {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const exec = promisify(execFile)

    try {
      const { stdout } = await exec('pactl', ['list', 'source-outputs'], { timeout: 5000 })
      // If there are source outputs, something is using the mic
      return stdout.includes('Source Output') ? 'active' : 'inactive'
    } catch {
      return 'inactive'
    }
  }
}
