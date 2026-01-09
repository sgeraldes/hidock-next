/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by "opening the circuit" when too many failures occur.
 * After a timeout, the circuit transitions to "half-open" to test if the service has recovered.
 */

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerConfig {
  /**
   * Number of consecutive failures before opening the circuit
   */
  failureThreshold: number

  /**
   * Time in milliseconds to wait before transitioning from open to half-open
   */
  resetTimeout: number

  /**
   * Optional callback when circuit state changes
   */
  onStateChange?: (state: CircuitState) => void
}

export interface Result<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Circuit Breaker implementation for protecting against cascading failures
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failureCount = 0
  private lastFailureTime: number | null = null
  private readonly config: CircuitBreakerConfig

  constructor(config: CircuitBreakerConfig) {
    this.config = config
  }

  /**
   * Get the current circuit state
   */
  getState(): CircuitState {
    return this.state
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<Result<T>> {
    // Check if circuit is open
    if (this.state === 'open') {
      // Check if we should transition to half-open
      if (this.shouldAttemptReset()) {
        this.transitionTo('half-open')
      } else {
        return {
          success: false,
          error: 'Circuit breaker is open - too many recent failures'
        }
      }
    }

    try {
      const data = await fn()
      this.onSuccess()
      return { success: true, data }
    } catch (error) {
      this.onFailure()
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Check if enough time has passed to attempt reset
   */
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return false
    return Date.now() - this.lastFailureTime >= this.config.resetTimeout
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.failureCount = 0
    if (this.state === 'half-open') {
      this.transitionTo('closed')
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.state === 'half-open') {
      // Failed in half-open state - go back to open
      this.transitionTo('open')
    } else if (this.failureCount >= this.config.failureThreshold) {
      // Threshold exceeded - open the circuit
      this.transitionTo('open')
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      console.log(`[CircuitBreaker] Transitioning from ${this.state} to ${newState}`)
      this.state = newState
      this.config.onStateChange?.(newState)

      if (newState === 'closed') {
        this.failureCount = 0
        this.lastFailureTime = null
      }
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.transitionTo('closed')
    this.failureCount = 0
    this.lastFailureTime = null
  }
}

/**
 * IPC categories for organizing circuit breakers
 */
export type IPCCategory = 'database' | 'transcription' | 'device' | 'calendar' | 'storage' | 'rag'

/**
 * Resilient IPC Client with circuit breaker protection
 *
 * Organizes circuit breakers by category (database, transcription, device, etc.)
 * to prevent failures in one area from affecting others.
 */
export class ResilientIPCClient {
  private breakers: Map<IPCCategory, CircuitBreaker>

  constructor() {
    this.breakers = new Map()

    // Initialize circuit breakers for each category
    const categories: IPCCategory[] = ['database', 'transcription', 'device', 'calendar', 'storage', 'rag']

    for (const category of categories) {
      this.breakers.set(
        category,
        new CircuitBreaker({
          failureThreshold: 5, // Open after 5 consecutive failures
          resetTimeout: 30000, // Try again after 30 seconds
          onStateChange: (state) => {
            console.log(`[ResilientIPCClient] ${category} circuit: ${state}`)
          }
        })
      )
    }
  }

  /**
   * Execute an IPC call with circuit breaker protection
   */
  async call<T>(
    category: IPCCategory,
    fn: () => Promise<T>
  ): Promise<Result<T>> {
    const breaker = this.breakers.get(category)
    if (!breaker) {
      return {
        success: false,
        error: `Unknown IPC category: ${category}`
      }
    }

    return breaker.execute(fn)
  }

  /**
   * Get the state of a specific circuit
   */
  getCircuitState(category: IPCCategory): CircuitState | undefined {
    return this.breakers.get(category)?.getState()
  }

  /**
   * Manually reset a specific circuit
   */
  resetCircuit(category: IPCCategory): void {
    this.breakers.get(category)?.reset()
  }

  /**
   * Reset all circuits
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset()
    }
  }
}

/**
 * Global singleton instance
 */
let globalClient: ResilientIPCClient | null = null

/**
 * Get the global resilient IPC client instance
 */
export function getResilientIPCClient(): ResilientIPCClient {
  if (!globalClient) {
    globalClient = new ResilientIPCClient()
  }
  return globalClient
}

/**
 * Helper function to make resilient IPC calls
 *
 * @example
 * ```ts
 * const result = await resilientCall('database', () =>
 *   window.electronAPI.recordings.getAll()
 * )
 *
 * if (result.success) {
 *   console.log('Recordings:', result.data)
 * } else {
 *   console.error('Failed:', result.error)
 * }
 * ```
 */
export async function resilientCall<T>(
  category: IPCCategory,
  fn: () => Promise<T>
): Promise<Result<T>> {
  return getResilientIPCClient().call(category, fn)
}
