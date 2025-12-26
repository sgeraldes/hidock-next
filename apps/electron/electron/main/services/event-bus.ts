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
 * DomainEventBus - Event bus for domain events across the application
 * Supports both in-process EventEmitter and renderer process communication
 */
class DomainEventBus extends EventEmitter {
  private mainWindow: BrowserWindow | null = null

  constructor() {
    super()
    this.setMaxListeners(50) // Increase listener limit for complex event flows
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

    // Broadcast to renderer if available
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('domain-event', enrichedEvent)
    }

    console.log(`[EventBus] Emitted: ${event.type}`, enrichedEvent.payload)
  }

  /**
   * Subscribe to a specific domain event type
   */
  onDomainEvent<T extends DomainEvent>(eventType: string, handler: (event: T) => void): () => void {
    this.on(eventType, handler)
    return () => this.off(eventType, handler)
  }

  /**
   * Subscribe to all domain events
   */
  onAnyDomainEvent(handler: (event: DomainEvent) => void): () => void {
    this.on('*', handler)
    return () => this.off('*', handler)
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
