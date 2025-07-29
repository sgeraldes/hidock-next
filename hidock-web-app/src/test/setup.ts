import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
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