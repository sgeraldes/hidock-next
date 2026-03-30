/**
 * Zod validation schemas for Jensen IPC handlers.
 * Enforces security constraints on all user-supplied values crossing the IPC boundary.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Filename safety — prevents path traversal, null bytes, and absolute paths
// ---------------------------------------------------------------------------

const JensenFilenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((s) => !s.includes('..'), 'Path traversal not allowed')
  .refine((s) => !s.includes('\0'), 'Null bytes not allowed')
  .refine((s) => !/^[/\\]/.test(s), 'Absolute paths not allowed')

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const JensenDeleteFileSchema = z.object({
  filename: JensenFilenameSchema,
})

export const JensenSetAutoRecordSchema = z.object({
  enabled: z.boolean(),
})

export const JensenDownloadFileSchema = z.object({
  filename: JensenFilenameSchema,
  fileSize: z.number().int().positive().max(2_000_000_000),
})

export const JensenRealtimeDataSchema = z.object({
  offset: z.number().int().min(0),
})

export const JensenBluetoothScanSchema = z.object({
  duration: z.number().int().positive().optional(),
})

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type JensenDeleteFile = z.infer<typeof JensenDeleteFileSchema>
export type JensenSetAutoRecord = z.infer<typeof JensenSetAutoRecordSchema>
export type JensenDownloadFile = z.infer<typeof JensenDownloadFileSchema>
export type JensenRealtimeData = z.infer<typeof JensenRealtimeDataSchema>
export type JensenBluetoothScan = z.infer<typeof JensenBluetoothScanSchema>
