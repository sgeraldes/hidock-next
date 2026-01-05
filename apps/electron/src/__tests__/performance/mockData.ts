import { UnifiedRecording } from '@/types/unified-recording'

/**
 * Generate mock UnifiedRecording objects for performance testing.
 * Creates a mix of device-only, local-only, and both-locations recordings.
 */
export function generateMockRecordings(count: number): UnifiedRecording[] {
  const locations = ['device-only', 'local-only', 'both'] as const
  return Array.from({ length: count }, (_, i) => {
    const location = locations[i % 3]
    const baseDate = new Date(Date.now() - i * 86400000)

    // Base fields common to all recording types
    const base = {
      id: `mock-${i}`,
      filename: `recording-${i + 1}.wav`,
      size: 1024 * 1024 * (i % 50 + 1), // 1-50 MB
      duration: Math.floor(Math.random() * 3600), // 0-3600 seconds
      dateRecorded: baseDate,
      transcriptionStatus: 'none' as const,
      title: `Recording ${i + 1}`,
      category: ['meeting', 'note', 'memo'][i % 3],
      quality: ['valuable', 'archived', 'low-value'][i % 3] as 'valuable' | 'archived' | 'low-value',
    }

    // Return discriminated union based on location
    if (location === 'device-only') {
      return {
        ...base,
        location: 'device-only',
        deviceFilename: `REC${String(i).padStart(4, '0')}.WAV`,
        syncStatus: i % 2 === 0 ? 'not-synced' : 'syncing',
      }
    } else if (location === 'local-only') {
      return {
        ...base,
        location: 'local-only',
        localPath: `/path/to/recordings/${base.filename}`,
        syncStatus: 'synced',
        isImported: i % 10 === 0,
      }
    } else {
      return {
        ...base,
        location: 'both',
        deviceFilename: `REC${String(i).padStart(4, '0')}.WAV`,
        localPath: `/path/to/recordings/${base.filename}`,
        syncStatus: 'synced',
      }
    }
  })
}
