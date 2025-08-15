/**
 * @fileoverview
 * This file contains the JensenLogger class for debug and error tracking.
 */

import { HIDOCK_CONSTANTS } from './constants';
import { LogEntry, LogLevel } from './types';

/**
 * Logger class for debug and error tracking
 * Maintains a circular buffer of log messages with timestamps
 */
export class JensenLogger {
    private messages: LogEntry[] = [];
    private consoleOutput = true;

    /**
     * Log an info message
     * @param module - Module name
     * @param procedure - Procedure/function name
     * @param message - Log message
     */
    public info(module: string, procedure: string, message: string): void {
        this._append("info", module, procedure, message);
    }

    /**
     * Log a debug message
     * @param module - Module name
     * @param procedure - Procedure/function name
     * @param message - Log message
     */
    public debug(module: string, procedure: string, message: string): void {
        this._append("debug", module, procedure, message);
    }

    /**
     * Log an error message
     * @param module - Module name
     * @param procedure - Procedure/function name
     * @param message - Log message
     */
    public error(module: string, procedure: string, message: string): void {
        this._append("error", module, procedure, message);
    }

    /**
     * Internal method to append log entries
     * @private
     */
    private _append(level: LogLevel, module: string, procedure: string, message: string): void {
        const logEntry: LogEntry = {
            level,
            module,
            procedure,
            message,
            time: new Date().getTime(),
        };

        this.messages.push(logEntry);

        if (this.consoleOutput) {
            this._print(logEntry);
        }

        // Maintain circular buffer - remove old entries
        if (this.messages.length > HIDOCK_CONSTANTS.MAX_LOG_ENTRIES) {
            this.messages.shift();
        }
    }

    /**
     * Print log entry to console
     * @private
     */
    private _print(logEntry: LogEntry): void {
        const timestamp = new Date(logEntry.time);
        const logFunction = console[logEntry.level] || console.log;
        logFunction(`[${timestamp.toISOString()}] ${logEntry.module}.${logEntry.procedure}: ${logEntry.message}`);
    }

    /**
     * Filter log messages by module and procedure
     */
    public filter(module: string, procedure: string): LogEntry[] {
        return this.messages.filter(entry => entry.module === module && entry.procedure === procedure);
    }

    /**
     * Search log messages
     */
    public search(module: string, procedure?: string, messageFilter?: string): LogEntry[] {
        return this.messages.filter(entry => {
            if (entry.module !== module) return false;
            if (procedure && entry.procedure !== procedure) return false;
            if (messageFilter && entry.message.indexOf(messageFilter) === -1) return false;
            return true;
        });
    }

    /**
     * Get the last N log entries
     */
    public peek(count: number): LogEntry[] {
        return this.messages.slice(-count);
    }

    public enableConsoleOutput(): void {
        this.consoleOutput = true;
    }

    public disableConsoleOutput(): void {
        this.consoleOutput = false;
    }
}
