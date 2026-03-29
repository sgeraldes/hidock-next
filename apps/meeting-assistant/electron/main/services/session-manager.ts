import { randomUUID } from 'node:crypto'

export interface Session {
  id: string
  title: string
  startedAt: number      // Unix ms
  endedAt: number | null
  status: 'recording' | 'processing' | 'completed'
  meetingId: string | null
  audioPath: string | null
  transcriptPath: string | null
}

export class SessionManager {
  private currentSession: Session | null = null
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map()

  /** Start a new recording session */
  startSession(title?: string): Session {
    if (this.currentSession && this.currentSession.status === 'recording') {
      throw new Error('A recording session is already active')
    }
    const session: Session = {
      id: randomUUID(),
      title: title ?? `Session ${new Date().toLocaleString()}`,
      startedAt: Date.now(),
      endedAt: null,
      status: 'recording',
      meetingId: null,
      audioPath: null,
      transcriptPath: null,
    }
    this.currentSession = session
    this.emit('session-start', session)
    return session
  }

  /** End the current session */
  endSession(): Session | null {
    if (!this.currentSession || this.currentSession.status !== 'recording') {
      return null
    }
    this.currentSession.endedAt = Date.now()
    this.currentSession.status = 'processing'
    const session = { ...this.currentSession }
    this.emit('session-end', session)
    return session
  }

  /** Mark session as completed */
  completeSession(sessionId: string): void {
    if (this.currentSession?.id === sessionId) {
      this.currentSession.status = 'completed'
      this.emit('session-complete', { ...this.currentSession })
    }
  }

  /** Link a meeting to a session */
  linkMeeting(sessionId: string, meetingId: string): void {
    if (this.currentSession?.id === sessionId) {
      this.currentSession.meetingId = meetingId
      this.emit('session-update', { ...this.currentSession })
    }
  }

  /** Get current active session */
  getCurrentSession(): Session | null {
    return this.currentSession ? { ...this.currentSession } : null
  }

  /** Check if currently recording */
  isRecording(): boolean {
    return this.currentSession?.status === 'recording'
  }

  // Simple typed event emitter
  on(event: string, listener: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(listener)
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      try { listener(...args) } catch { /* don't crash on listener errors */ }
    }
  }
}

// Singleton instance
let sessionManagerInstance: SessionManager | null = null

export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager()
  }
  return sessionManagerInstance
}
