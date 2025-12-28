import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'

// Domain Event Types
export interface DomainEvent {
  type: string
  timestamp: string
  payload: any
}

export interface QualityAssessedEvent extends DomainEvent {
  type: 'quality:assessed'
  payload: {
    recordingId: string
    quality: 'high' | 'medium' | 'low'
    assessmentMethod: 'auto' | 'manual'
    confidence: number
    reason?: string
  }
}

export interface StorageTierAssignedEvent extends DomainEvent {
  type: 'storage:tier-assigned'
  payload: {
    recordingId: string
    tier: 'hot' | 'warm' | 'cold' | 'archive'
    previousTier?: string
    reason: string
  }
}

export interface RecordingCleanupSuggestedEvent extends DomainEvent {
  type: 'storage:cleanup-suggested'
  payload: {
    recordingIds: string[]
    tier: 'hot' | 'warm' | 'cold' | 'archive'
    reason: string
  }
}

export type KnownDomainEvent = QualityAssessedEvent | StorageTierAssignedEvent | RecordingCleanupSuggestedEvent

/**
 * Sanitize event payload before broadcasting to renderer process
 * Removes sensitive data and ensures safe transmission
 */
function sanitizeEventPayload<T extends DomainEvent>(event: T): T {
  // Deep clone to avoid mutation
  const sanitized = JSON.parse(JSON.stringify(event))

  // Remove any potentially sensitive fields
  if (sanitized.payload) {
    // Remove internal system fields
    delete sanitized.payload.internal
    delete sanitized.payload.systemData

    // Sanitize any error messages that might contain sensitive paths
    if (sanitized.payload.reason && typeof sanitized.payload.reason === 'string') {
      // Remove full file paths, keep only filenames
      sanitized.payload.reason = sanitized.payload.reason.replace(/[A-Za-z]:[\\/][^\s]+/g, '[path]')
    }

    // Sanitize assessedBy to remove email addresses or usernames
    if (sanitized.payload.assessedBy && typeof sanitized.payload.assessedBy === 'string') {
      // If it looks like an email, replace with generic identifier
      if (sanitized.payload.assessedBy.includes('@')) {
        sanitized.payload.assessedBy = 'user'
      }
    }
  }

  return sanitized
}

/**
 * DomainEventBus - Event bus for domain events across the application
 * Supports both in-process EventEmitter and renderer process communication
 */
class DomainEventBus extends EventEmitter {
  private mainWindow: BrowserWindow | null = null
  private domainListenerCount: Map<string, number> = new Map()
  private readonly MAX_LISTENERS_PER_EVENT = 20

  constructor() {
    super()
    this.setMaxListeners(100) // Global limit across all events
  }

  /**
   * Set the main window for broadcasting events to renderer
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Emit a domain event to both internal listeners and renderer process
   */
  emitDomainEvent<T extends DomainEvent>(event: T): void {
    const enrichedEvent: T = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString()
    }

    // Emit to internal listeners
    this.emit(event.type, enrichedEvent)
    this.emit('*', enrichedEvent) // Wildcard listener for all events

    // Broadcast to renderer if available (sanitized)
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const sanitized = sanitizeEventPayload(enrichedEvent)
      this.mainWindow.webContents.send('domain-event', sanitized)
    }

    console.log(`[EventBus] Emitted: ${event.type}`, enrichedEvent.payload)
  }

  /**
   * Subscribe to a specific domain event type
   */
  onDomainEvent<T extends DomainEvent>(eventType: string, handler: (event: T) => void): () => void {
    // Enforce per-event listener limit
    const currentCount = this.domainListenerCount.get(eventType) || 0
    if (currentCount >= this.MAX_LISTENERS_PER_EVENT) {
      console.warn(`[EventBus] Max listeners (${this.MAX_LISTENERS_PER_EVENT}) reached for event ${eventType}`)
      // Remove oldest listener to make room
      const listeners = this.listeners(eventType)
      if (listeners.length > 0) {
        this.off(eventType, listeners[0] as any)
        this.domainListenerCount.set(eventType, currentCount - 1)
      }
    }
    
    this.on(eventType, handler)
    this.domainListenerCount.set(eventType, (this.domainListenerCount.get(eventType) || 0) + 1)
    
    // Return cleanup function
    return () => {
      this.off(eventType, handler)
      const count = this.domainListenerCount.get(eventType) || 0
      this.domainListenerCount.set(eventType, Math.max(0, count - 1))
    }
  }

  /**
   * Subscribe to all domain events
   */
  onAnyDomainEvent(handler: (event: DomainEvent) => void): () => void {
    // Enforce per-event listener limit
    const currentCount = this.domainListenerCount.get('*') || 0
    if (currentCount >= this.MAX_LISTENERS_PER_EVENT) {
      console.warn(`[EventBus] Max listeners (${this.MAX_LISTENERS_PER_EVENT}) reached for wildcard events`)
      const listeners = this.listeners('*')
      if (listeners.length > 0) {
        this.off('*', listeners[0] as any)
        this.domainListenerCount.set('*', currentCount - 1)
      }
    }
    
    this.on('*', handler)
    this.domainListenerCount.set('*', (this.domainListenerCount.get('*') || 0) + 1)
    
    return () => {
      this.off('*', handler)
      const count = this.domainListenerCount.get('*') || 0
      this.domainListenerCount.set('*', Math.max(0, count - 1))
    }
  }
}

// Singleton instance
let eventBusInstance: DomainEventBus | null = null

export function getEventBus(): DomainEventBus {
  if (!eventBusInstance) {
    eventBusInstance = new DomainEventBus()
  }
  return eventBusInstance
}

export function setMainWindowForEventBus(window: BrowserWindow): void {
  getEventBus().setMainWindow(window)
}
