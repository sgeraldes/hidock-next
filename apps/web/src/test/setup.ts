import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { server } from './mocks/server'

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// Clean up after each test case (e.g. clearing jsdom)
afterEach(() => {
    cleanup()
    server.resetHandlers()
})

// Close server after all tests
afterAll(() => server.close())

// Mock localStorage — not provided by this jsdom setup, and the device service's
// recording cache (loadCacheFromStorage) calls localStorage.getItem/removeItem.
const localStorageStore = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
    writable: true,
    configurable: true,
    value: {
        getItem: (key: string) => (localStorageStore.has(key) ? localStorageStore.get(key)! : null),
        setItem: (key: string, value: string) => { localStorageStore.set(key, String(value)) },
        removeItem: (key: string) => { localStorageStore.delete(key) },
        clear: () => { localStorageStore.clear() },
        key: (i: number) => Array.from(localStorageStore.keys())[i] ?? null,
        get length() { return localStorageStore.size },
    },
})

// Mock WebUSB API
Object.defineProperty(navigator, 'usb', {
    writable: true,
    configurable: true, // Allow the mock to be deleted in tests
    value: {
        requestDevice: vi.fn(),
        getDevices: vi.fn().mockResolvedValue([]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    },
})

// Mock Web Audio API
Object.defineProperty(window, 'AudioContext', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
        createMediaStreamSource: vi.fn(),
        createScriptProcessor: vi.fn(),
        createAnalyser: vi.fn(),
        close: vi.fn(),
    })),
})

// Mock MediaRecorder
Object.defineProperty(window, 'MediaRecorder', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        state: 'inactive',
    })),
})
