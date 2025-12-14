/**
 * Error Types
 *
 * Custom error classes for consistent error handling across the application.
 * Each error type maps to a specific error code in the Result pattern.
 */

import type { ErrorCode } from './api'

/**
 * Base error class for all application errors
 */
export abstract class AppError extends Error {
  abstract readonly code: ErrorCode
  readonly details?: unknown

  constructor(message: string, details?: unknown) {
    super(message)
    this.name = this.constructor.name
    this.details = details

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * Convert to serializable error object for IPC
   */
  toResult() {
    return {
      success: false as const,
      error: {
        code: this.code,
        message: this.message,
        details: this.details
      }
    }
  }
}

/**
 * Entity not found in database
 */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const

  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`)
  }
}

/**
 * Input validation failed
 */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR' as const

  constructor(message: string, details?: unknown) {
    super(message, details)
  }
}

/**
 * Database operation failed
 */
export class DatabaseError extends AppError {
  readonly code = 'DATABASE_ERROR' as const

  constructor(message: string, details?: unknown) {
    super(`Database error: ${message}`, details)
  }
}

/**
 * Duplicate entry constraint violation
 */
export class DuplicateEntryError extends AppError {
  readonly code = 'DUPLICATE_ENTRY' as const

  constructor(entity: string, field: string, value: string) {
    super(`${entity} with ${field} "${value}" already exists`)
  }
}

/**
 * Invalid input parameters
 */
export class InvalidInputError extends AppError {
  readonly code = 'INVALID_INPUT' as const

  constructor(message: string, details?: unknown) {
    super(message, details)
  }
}

/**
 * External service is unavailable
 */
export class ServiceUnavailableError extends AppError {
  readonly code = 'SERVICE_UNAVAILABLE' as const

  constructor(service: string, details?: unknown) {
    super(`${service} is unavailable`, details)
  }
}

/**
 * Ollama service specifically unavailable (common case)
 */
export class OllamaUnavailableError extends AppError {
  readonly code = 'OLLAMA_UNAVAILABLE' as const

  constructor(details?: unknown) {
    super(
      'Ollama is not available. Please ensure Ollama is running and accessible at the configured URL.',
      details
    )
  }
}

/**
 * Transcription operation failed
 */
export class TranscriptionError extends AppError {
  readonly code = 'TRANSCRIPTION_ERROR' as const

  constructor(message: string, details?: unknown) {
    super(`Transcription failed: ${message}`, details)
  }
}

/**
 * Unexpected internal error
 */
export class InternalError extends AppError {
  readonly code = 'INTERNAL_ERROR' as const

  constructor(message: string, details?: unknown) {
    super(`Internal error: ${message}`, details)
  }
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * Convert any error to a Result error response
 */
export function toErrorResult(error: unknown) {
  if (isAppError(error)) {
    return error.toResult()
  }

  // Handle Zod validation errors
  if (error && typeof error === 'object' && 'issues' in error) {
    return {
      success: false as const,
      error: {
        code: 'VALIDATION_ERROR' as ErrorCode,
        message: 'Validation failed',
        details: error
      }
    }
  }

  // Handle standard errors
  if (error instanceof Error) {
    return {
      success: false as const,
      error: {
        code: 'INTERNAL_ERROR' as ErrorCode,
        message: error.message,
        details: error.stack
      }
    }
  }

  // Handle unknown errors
  return {
    success: false as const,
    error: {
      code: 'INTERNAL_ERROR' as ErrorCode,
      message: 'An unexpected error occurred',
      details: error
    }
  }
}

/**
 * Wrap an async function with error handling that returns Result
 */
export function withErrorHandling<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>
): (...args: Args) => Promise<{ success: true; data: T } | ReturnType<typeof toErrorResult>> {
  return async (...args: Args) => {
    try {
      const data = await fn(...args)
      return { success: true as const, data }
    } catch (error) {
      return toErrorResult(error)
    }
  }
}
