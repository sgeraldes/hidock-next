export type VectorStartupPhase = 'idle' | 'queued' | 'loading' | 'ready' | 'failed'

export interface VectorStartupState {
  phase: VectorStartupPhase
  loaded: number
  total: number
  error: string | null
}

let state: VectorStartupState = { phase: 'idle', loaded: 0, total: 0, error: null }

export function getVectorStartupState(): VectorStartupState {
  return { ...state }
}

export function markVectorStartupQueued(): void {
  if (state.phase === 'idle') state = { phase: 'queued', loaded: 0, total: 0, error: null }
}

export function markVectorStartupLoading(): void {
  state = { phase: 'loading', loaded: 0, total: 0, error: null }
}

export function updateVectorStartupProgress(loaded: number, total: number): void {
  state = { phase: 'loading', loaded, total, error: null }
}

export function markVectorStartupReady(total: number): void {
  state = { phase: 'ready', loaded: total, total, error: null }
}

export function markVectorStartupFailed(error: unknown): void {
  state = {
    ...state,
    phase: 'failed',
    error: error instanceof Error ? error.message : String(error),
  }
}
