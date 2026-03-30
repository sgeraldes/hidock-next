import { EventEmitter } from 'node:events'
import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export type ErrorLevel = 'error' | 'warn' | 'info' | 'debug'

export interface LogEntry {
  timestamp: string
  level: ErrorLevel
  source: string
  message: string
  details?: unknown
}

export class ErrorHandler extends EventEmitter {
  private logDir: string
  private logLevel: ErrorLevel = 'info'

  constructor() {
    super()
    this.logDir = join(app.getPath('documents'), 'MeetingAssistant', 'logs')
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
  }

  setLogLevel(level: ErrorLevel): void {
    this.logLevel = level
  }

  log(level: ErrorLevel, source: string, message: string, details?: unknown): void {
    const levels: ErrorLevel[] = ['error', 'warn', 'info', 'debug']
    if (levels.indexOf(level) > levels.indexOf(this.logLevel)) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      details,
    }

    // Write to daily log file
    const dateStr = new Date().toISOString().split('T')[0]
    const logFile = join(this.logDir, `${dateStr}.jsonl`)
    appendFileSync(logFile, JSON.stringify(entry) + '\n')

    // Emit for real-time monitoring
    this.emit('log', entry)

    // Critical errors also emit special event for UI notification
    if (level === 'error') {
      this.emit('critical-error', entry)
    }

    console[level === 'debug' ? 'log' : level](`[${source}] ${message}`, details ?? '')
  }

  error(source: string, message: string, details?: unknown): void {
    this.log('error', source, message, details)
  }

  warn(source: string, message: string, details?: unknown): void {
    this.log('warn', source, message, details)
  }

  info(source: string, message: string, details?: unknown): void {
    this.log('info', source, message, details)
  }

  debug(source: string, message: string, details?: unknown): void {
    this.log('debug', source, message, details)
  }
}

/** Singleton instance */
export const errorHandler = new ErrorHandler()
