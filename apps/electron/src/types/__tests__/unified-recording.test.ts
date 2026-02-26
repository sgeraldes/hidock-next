/**
 * Unified Recording type guards and filter helpers
 *
 * Tests for discriminated union type guards, semantic/exclusive filters,
 * and the hasLocalPath empty-path guard (FIX-012).
 */

import { describe, it, expect } from 'vitest'
import {
  hasLocalPath,
  hasDeviceFile,
  isDeviceOnly,
  isLocalOnly,
  isBothLocations,
  matchesSemanticFilter,
  matchesExclusiveFilter,
  type UnifiedRecording,
  type DeviceOnlyRecording,
  type LocalOnlyRecording,
  type BothLocationsRecording,
} from '@/types/unified-recording'

// ============================================================
// Test fixtures
// ============================================================

const deviceOnlyRecording: DeviceOnlyRecording = {
  id: 'dev-1',
  filename: '2025May13-160405-Rec59.hda',
  size: 1024000,
  duration: 120,
  dateRecorded: new Date('2025-05-13T16:04:05'),
  transcriptionStatus: 'none',
  location: 'device-only',
  deviceFilename: '2025May13-160405-Rec59.hda',
  syncStatus: 'not-synced',
}

const localOnlyRecording: LocalOnlyRecording = {
  id: 'local-1',
  filename: '2025May13-160405-Rec59.wav',
  size: 2048000,
  duration: 120,
  dateRecorded: new Date('2025-05-13T16:04:05'),
  transcriptionStatus: 'complete',
  location: 'local-only',
  localPath: '/recordings/2025May13-160405-Rec59.wav',
  syncStatus: 'synced',
}

const bothLocationsRecording: BothLocationsRecording = {
  id: 'both-1',
  filename: '2025May13-160405-Rec59.hda',
  size: 1024000,
  duration: 120,
  dateRecorded: new Date('2025-05-13T16:04:05'),
  transcriptionStatus: 'processing',
  location: 'both',
  deviceFilename: '2025May13-160405-Rec59.hda',
  localPath: '/recordings/2025May13-160405-Rec59.wav',
  syncStatus: 'synced',
}

// ============================================================
// Type guard tests
// ============================================================

describe('isDeviceOnly', () => {
  it('returns true for device-only recordings', () => {
    expect(isDeviceOnly(deviceOnlyRecording)).toBe(true)
  })

  it('returns false for local-only recordings', () => {
    expect(isDeviceOnly(localOnlyRecording)).toBe(false)
  })

  it('returns false for both-locations recordings', () => {
    expect(isDeviceOnly(bothLocationsRecording)).toBe(false)
  })
})

describe('isLocalOnly', () => {
  it('returns true for local-only recordings', () => {
    expect(isLocalOnly(localOnlyRecording)).toBe(true)
  })

  it('returns false for device-only recordings', () => {
    expect(isLocalOnly(deviceOnlyRecording)).toBe(false)
  })

  it('returns false for both-locations recordings', () => {
    expect(isLocalOnly(bothLocationsRecording)).toBe(false)
  })
})

describe('isBothLocations', () => {
  it('returns true for both-locations recordings', () => {
    expect(isBothLocations(bothLocationsRecording)).toBe(true)
  })

  it('returns false for device-only recordings', () => {
    expect(isBothLocations(deviceOnlyRecording)).toBe(false)
  })

  it('returns false for local-only recordings', () => {
    expect(isBothLocations(localOnlyRecording)).toBe(false)
  })
})

describe('hasDeviceFile', () => {
  it('returns true for device-only recordings', () => {
    expect(hasDeviceFile(deviceOnlyRecording)).toBe(true)
  })

  it('returns true for both-locations recordings', () => {
    expect(hasDeviceFile(bothLocationsRecording)).toBe(true)
  })

  it('returns false for local-only recordings', () => {
    expect(hasDeviceFile(localOnlyRecording)).toBe(false)
  })
})

// ============================================================
// hasLocalPath (FIX-012)
// ============================================================

describe('hasLocalPath', () => {
  it('returns true for local-only recordings with valid path', () => {
    expect(hasLocalPath(localOnlyRecording)).toBe(true)
  })

  it('returns true for both-locations recordings with valid path', () => {
    expect(hasLocalPath(bothLocationsRecording)).toBe(true)
  })

  it('returns false for device-only recordings', () => {
    expect(hasLocalPath(deviceOnlyRecording)).toBe(false)
  })

  it('rejects recordings with empty localPath (FIX-012)', () => {
    const recording: LocalOnlyRecording = {
      ...localOnlyRecording,
      localPath: '',
    }
    expect(hasLocalPath(recording)).toBe(false)
  })

  it('rejects both-locations recordings with empty localPath', () => {
    const recording: BothLocationsRecording = {
      ...bothLocationsRecording,
      localPath: '',
    }
    expect(hasLocalPath(recording)).toBe(false)
  })
})

// ============================================================
// Type narrowing verification
// ============================================================

describe('type narrowing', () => {
  it('narrows to DeviceOnlyRecording and accesses deviceFilename', () => {
    const rec: UnifiedRecording = deviceOnlyRecording

    if (isDeviceOnly(rec)) {
      // TypeScript should allow this without errors
      expect(rec.deviceFilename).toBe('2025May13-160405-Rec59.hda')
      expect(rec.syncStatus).toBe('not-synced')
    } else {
      // Should not reach here
      expect.unreachable('Expected device-only recording')
    }
  })

  it('narrows to LocalOnlyRecording and accesses localPath', () => {
    const rec: UnifiedRecording = localOnlyRecording

    if (isLocalOnly(rec)) {
      expect(rec.localPath).toBe('/recordings/2025May13-160405-Rec59.wav')
      expect(rec.syncStatus).toBe('synced')
    } else {
      expect.unreachable('Expected local-only recording')
    }
  })

  it('narrows to BothLocationsRecording and accesses both paths', () => {
    const rec: UnifiedRecording = bothLocationsRecording

    if (isBothLocations(rec)) {
      expect(rec.deviceFilename).toBe('2025May13-160405-Rec59.hda')
      expect(rec.localPath).toBe('/recordings/2025May13-160405-Rec59.wav')
    } else {
      expect.unreachable('Expected both-locations recording')
    }
  })

  it('narrows via hasLocalPath to access localPath', () => {
    const rec: UnifiedRecording = localOnlyRecording

    if (hasLocalPath(rec)) {
      // TypeScript narrows to LocalOnlyRecording | BothLocationsRecording
      expect(rec.localPath).toBeTruthy()
    } else {
      expect.unreachable('Expected recording with local path')
    }
  })

  it('narrows via hasDeviceFile to access deviceFilename', () => {
    const rec: UnifiedRecording = deviceOnlyRecording

    if (hasDeviceFile(rec)) {
      // TypeScript narrows to DeviceOnlyRecording | BothLocationsRecording
      expect(rec.deviceFilename).toBeTruthy()
    } else {
      expect.unreachable('Expected recording with device file')
    }
  })

  it('switch exhaustiveness on location discriminant', () => {
    const recordings: UnifiedRecording[] = [
      deviceOnlyRecording,
      localOnlyRecording,
      bothLocationsRecording,
    ]

    for (const rec of recordings) {
      switch (rec.location) {
        case 'device-only':
          expect(rec.deviceFilename).toBeTruthy()
          break
        case 'local-only':
          expect(rec.localPath).toBeTruthy()
          break
        case 'both':
          expect(rec.deviceFilename).toBeTruthy()
          expect(rec.localPath).toBeTruthy()
          break
        default: {
          // This ensures exhaustiveness at compile time
          const _exhaustive: never = rec
          expect.unreachable(`Unexpected location: ${(_exhaustive as UnifiedRecording).location}`)
        }
      }
    }
  })
})

// ============================================================
// Semantic filter helpers
// ============================================================

describe('matchesSemanticFilter', () => {
  it('"all" matches every location', () => {
    expect(matchesSemanticFilter('device-only', 'all')).toBe(true)
    expect(matchesSemanticFilter('local-only', 'all')).toBe(true)
    expect(matchesSemanticFilter('both', 'all')).toBe(true)
  })

  it('"on-source" matches device-only and both', () => {
    expect(matchesSemanticFilter('device-only', 'on-source')).toBe(true)
    expect(matchesSemanticFilter('both', 'on-source')).toBe(true)
    expect(matchesSemanticFilter('local-only', 'on-source')).toBe(false)
  })

  it('"locally-available" matches local-only and both', () => {
    expect(matchesSemanticFilter('local-only', 'locally-available')).toBe(true)
    expect(matchesSemanticFilter('both', 'locally-available')).toBe(true)
    expect(matchesSemanticFilter('device-only', 'locally-available')).toBe(false)
  })

  it('"synced" matches only both', () => {
    expect(matchesSemanticFilter('both', 'synced')).toBe(true)
    expect(matchesSemanticFilter('device-only', 'synced')).toBe(false)
    expect(matchesSemanticFilter('local-only', 'synced')).toBe(false)
  })
})

describe('matchesExclusiveFilter', () => {
  it('"all" matches every location', () => {
    expect(matchesExclusiveFilter('device-only', 'all')).toBe(true)
    expect(matchesExclusiveFilter('local-only', 'all')).toBe(true)
    expect(matchesExclusiveFilter('both', 'all')).toBe(true)
  })

  it('"source-only" matches only device-only', () => {
    expect(matchesExclusiveFilter('device-only', 'source-only')).toBe(true)
    expect(matchesExclusiveFilter('local-only', 'source-only')).toBe(false)
    expect(matchesExclusiveFilter('both', 'source-only')).toBe(false)
  })

  it('"local-only" matches only local-only', () => {
    expect(matchesExclusiveFilter('local-only', 'local-only')).toBe(true)
    expect(matchesExclusiveFilter('device-only', 'local-only')).toBe(false)
    expect(matchesExclusiveFilter('both', 'local-only')).toBe(false)
  })

  it('"synced" matches only both', () => {
    expect(matchesExclusiveFilter('both', 'synced')).toBe(true)
    expect(matchesExclusiveFilter('device-only', 'synced')).toBe(false)
    expect(matchesExclusiveFilter('local-only', 'synced')).toBe(false)
  })
})
