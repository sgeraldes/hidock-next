import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join, isAbsolute } from 'path'
import { randomUUID } from 'crypto'
import ffmpegPath from 'ffmpeg-static'
import { getConfig } from './config'
import { queryAll, queryOne, runInTransaction, runNoSave } from './database'

export interface AcousticSegment {
  start: number
  end: number
  speaker: string
}

export interface AcousticSpeaker {
  label: string
  embedding: number[]
  speechSeconds: number
  qualityScore?: number
}

export interface AcousticWorkerResult {
  model: string
  modelVersion: string
  device: string
  segments: AcousticSegment[]
  speakers: AcousticSpeaker[]
}

interface VoiceClusterRow {
  id: string
  model: string
  model_version: string
  embedding_dimension: number
  centroid_json: string
  observation_count: number
  total_speech_seconds: number
  contact_id: string | null
  contact_name: string | null
}

export interface VoiceMatch {
  localSpeakerLabel: string
  voiceClusterId: string
  stableLabel: string
  status: 'matched' | 'new' | 'needs_review'
  similarity: number | null
  runnerUpMargin: number | null
  contactId: string | null
  contactName: string | null
  speechSeconds: number
}

export interface SpeakerLinkingResult {
  available: boolean
  model: string
  modelVersion: string | null
  device: string | null
  segments: AcousticSegment[]
  matches: VoiceMatch[]
  reason?: string
}

export interface MatchDecision {
  clusterId: string | null
  similarity: number | null
  runnerUpMargin: number | null
  status: 'matched' | 'new' | 'needs_review'
}

export class SpeakerLinkingUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpeakerLinkingUnavailableError'
  }
}

export function normalizeEmbedding(values: number[]): number[] {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return []
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(magnitude) || magnitude <= 1e-12) return []
  return values.map((value) => value / magnitude)
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return -1
  const a = normalizeEmbedding(left)
  const b = normalizeEmbedding(right)
  if (!a.length || !b.length) return -1
  return a.reduce((sum, value, index) => sum + value * b[index], 0)
}

export function decideVoiceMatch(
  embedding: number[],
  candidates: Array<{ id: string; centroid: number[] }>,
  threshold: number,
  requiredMargin: number,
  excludedClusterIds: ReadonlySet<string> = new Set()
): MatchDecision {
  const ranked = candidates
    .filter((candidate) => !excludedClusterIds.has(candidate.id))
    .map((candidate) => ({ id: candidate.id, similarity: cosineSimilarity(embedding, candidate.centroid) }))
    .filter((candidate) => candidate.similarity >= -0.5)
    .sort((a, b) => b.similarity - a.similarity)
  if (!ranked.length) {
    return { clusterId: null, similarity: null, runnerUpMargin: null, status: 'new' }
  }
  const best = ranked[0]
  const margin = best.similarity - (ranked[1]?.similarity ?? -1)
  if (best.similarity >= threshold && margin >= requiredMargin) {
    return { clusterId: best.id, similarity: best.similarity, runnerUpMargin: margin, status: 'matched' }
  }
  return {
    clusterId: null,
    similarity: best.similarity,
    runnerUpMargin: margin,
    status: best.similarity >= threshold ? 'needs_review' : 'new'
  }
}

export function updateCentroid(
  previous: number[],
  previousWeight: number,
  observation: number[],
  observationWeight: number
): number[] {
  const a = normalizeEmbedding(previous)
  const b = normalizeEmbedding(observation)
  if (!a.length) return b
  if (!b.length || a.length !== b.length) return a
  const oldWeight = Math.max(0, previousWeight)
  const newWeight = Math.max(0.001, observationWeight)
  return normalizeEmbedding(a.map((value, index) =>
    ((value * oldWeight) + (b[index] * newWeight)) / (oldWeight + newWeight)
  ))
}

function resolveWorkerPath(configured: string): string {
  if (configured) return isAbsolute(configured) ? configured : join(process.cwd(), configured)
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'speaker-linking', 'worker.py')
    if (existsSync(packaged)) return packaged
  }
  return join(process.cwd(), 'resources', 'speaker-linking', 'worker.py')
}

function runWorker(
  audioPath: string,
  shouldContinue: () => boolean
): Promise<AcousticWorkerResult> {
  const config = getConfig().transcription
  const workerPath = resolveWorkerPath(config.speakerLinkingWorkerPath)
  if (!existsSync(workerPath)) {
    return Promise.reject(new SpeakerLinkingUnavailableError(`speaker-linking worker not found: ${workerPath}`))
  }
  const configuredPython = config.speakerLinkingPythonPath || (process.platform === 'win32' ? 'py' : 'python3')
  const localRuntime = process.platform === 'win32'
    ? join(process.cwd(), '.venv-speaker-linking', 'Scripts', 'python.exe')
    : join(process.cwd(), '.venv-speaker-linking', 'bin', 'python')
  const python = /^(py|python|python3)(\.exe)?$/i.test(configuredPython) && existsSync(localRuntime)
    ? localRuntime
    : configuredPython
  const args = [
    ...(process.platform === 'win32' && /(^|[\\/])py(?:\.exe)?$/i.test(python) ? ['-3.11'] : []),
    workerPath,
    '--audio', audioPath,
    '--model', config.speakerLinkingModel,
    '--fallback-model', config.speakerLinkingFallbackModel || 'pyannote/speaker-diarization-3.1',
    '--min-speech-seconds', String(config.speakerLinkingMinSpeechSeconds)
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FFMPEG_PATH: ffmpegPath || process.env.FFMPEG_PATH,
        HF_TOKEN: config.localAsrHfToken || process.env.HF_TOKEN,
        HUGGINGFACE_HUB_TOKEN: config.localAsrHfToken || process.env.HUGGINGFACE_HUB_TOKEN
      }
    })
    let stdout = ''
    let stderr = ''
    const cap = 25 * 1024 * 1024
    const timeoutMs = Math.max(30, config.speakerLinkingTimeoutSeconds) * 1000
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`speaker-linking timed out after ${Math.round(timeoutMs / 1000)} seconds`))
    }, timeoutMs)
    const cancellation = setInterval(() => {
      if (!shouldContinue()) {
        child.kill()
        clearTimeout(timeout)
        clearInterval(cancellation)
        reject(new Error('speaker-linking cancelled because recording became ineligible'))
      }
    }, 1000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < cap) stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < cap) stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      clearInterval(cancellation)
      reject(new SpeakerLinkingUnavailableError(`failed to start speaker-linking worker: ${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      clearInterval(cancellation)
      if (code !== 0) {
        const detail = stderr.trim().split('\n').slice(-12).join('\n') || `speaker-linking exited with code ${code}`
        if (/ModuleNotFoundError|No module named|GatedRepo|401|403|not authorized|cannot access gated/i.test(detail)) {
          reject(new SpeakerLinkingUnavailableError(detail))
        } else {
          reject(new Error(detail))
        }
        return
      }
      try {
        const parsed = JSON.parse(stdout) as AcousticWorkerResult
        if (!parsed.model || !parsed.modelVersion || !Array.isArray(parsed.segments) || !Array.isArray(parsed.speakers)) {
          throw new Error('worker returned an incomplete result')
        }
        resolve(parsed)
      } catch (error) {
        reject(new Error(`invalid speaker-linking worker output: ${(error as Error).message}`))
      }
    })
  })
}

function parseCentroid(row: VoiceClusterRow): number[] {
  try {
    const parsed = JSON.parse(row.centroid_json)
    return Array.isArray(parsed) ? parsed.map(Number) : []
  } catch {
    return []
  }
}

function stableVoiceLabel(clusterId: string): string {
  return `Voice ${clusterId.replace(/-/g, '').slice(0, 6).toUpperCase()}`
}

function removeExistingRecordingEvidence(recordingId: string): void {
  const affected = queryAll<{ voice_cluster_id: string }>(
    'SELECT DISTINCT voice_cluster_id FROM voice_cluster_observations WHERE recording_id = ?',
    [recordingId]
  ).map((row) => row.voice_cluster_id)
  runNoSave('DELETE FROM recording_voice_clusters WHERE recording_id = ?', [recordingId])
  runNoSave('DELETE FROM voice_cluster_observations WHERE recording_id = ?', [recordingId])
  for (const clusterId of affected) {
    const observations = queryAll<{ embedding_json: string; speech_seconds: number }>(
      'SELECT embedding_json, speech_seconds FROM voice_cluster_observations WHERE voice_cluster_id = ?',
      [clusterId]
    )
    if (!observations.length) {
      runNoSave('DELETE FROM voice_clusters WHERE id = ?', [clusterId])
      continue
    }
    let centroid: number[] = []
    let totalWeight = 0
    for (const observation of observations) {
      let embedding: number[] = []
      try {
        const parsed = JSON.parse(observation.embedding_json)
        embedding = Array.isArray(parsed) ? parsed.map(Number) : []
      } catch { /* malformed evidence is ignored */ }
      if (!embedding.length) continue
      centroid = updateCentroid(centroid, totalWeight, embedding, observation.speech_seconds)
      totalWeight += Math.max(0.001, observation.speech_seconds)
    }
    if (!centroid.length) {
      runNoSave('DELETE FROM voice_clusters WHERE id = ?', [clusterId])
      continue
    }
    runNoSave(
      `UPDATE voice_clusters SET centroid_json = ?, observation_count = ?, total_speech_seconds = ?,
       updated_at = ? WHERE id = ?`,
      [JSON.stringify(centroid), observations.length, totalWeight, new Date().toISOString(), clusterId]
    )
  }
}

function persistMatches(recordingId: string, result: AcousticWorkerResult): VoiceMatch[] {
  const config = getConfig().transcription
  return runInTransaction(() => {
    removeExistingRecordingEvidence(recordingId)
    const dimension = result.speakers.find((speaker) => speaker.embedding.length > 0)?.embedding.length ?? 0
    if (!dimension) return []
    const clusters = queryAll<VoiceClusterRow>(
      `SELECT vc.*, c.name AS contact_name FROM voice_clusters vc
       LEFT JOIN contacts c ON c.id = vc.contact_id
       WHERE vc.model = ? AND vc.model_version = ? AND vc.embedding_dimension = ?`,
      [result.model, result.modelVersion, dimension]
    )
    const candidates = clusters.map((cluster) => ({ id: cluster.id, centroid: parseCentroid(cluster) }))
    const rowsById = new Map(clusters.map((cluster) => [cluster.id, cluster]))
    const used = new Set<string>()
    const matches: VoiceMatch[] = []
    for (const speaker of result.speakers) {
      const embedding = normalizeEmbedding(speaker.embedding)
      if (!embedding.length || speaker.speechSeconds < config.speakerLinkingMinSpeechSeconds) continue
      const decision = decideVoiceMatch(
        embedding,
        candidates,
        config.speakerLinkingMatchThreshold,
        config.speakerLinkingMatchMargin,
        used
      )
      const clusterId = decision.clusterId ?? randomUUID()
      let row = rowsById.get(clusterId)
      if (row) {
        const centroid = updateCentroid(
          parseCentroid(row),
          row.total_speech_seconds,
          embedding,
          speaker.speechSeconds
        )
        runNoSave(
          `UPDATE voice_clusters SET centroid_json = ?, observation_count = observation_count + 1,
           total_speech_seconds = total_speech_seconds + ?, updated_at = ? WHERE id = ?`,
          [JSON.stringify(centroid), speaker.speechSeconds, new Date().toISOString(), clusterId]
        )
      } else {
        runNoSave(
          `INSERT INTO voice_clusters
           (id, model, model_version, embedding_dimension, centroid_json, observation_count, total_speech_seconds)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
          [clusterId, result.model, result.modelVersion, dimension, JSON.stringify(embedding), speaker.speechSeconds]
        )
        row = {
          id: clusterId,
          model: result.model,
          model_version: result.modelVersion,
          embedding_dimension: dimension,
          centroid_json: JSON.stringify(embedding),
          observation_count: 1,
          total_speech_seconds: speaker.speechSeconds,
          contact_id: null,
          contact_name: null
        }
        rowsById.set(clusterId, row)
        candidates.push({ id: clusterId, centroid: embedding })
      }
      used.add(clusterId)
      const stableLabel = stableVoiceLabel(clusterId)
      runNoSave(
        `INSERT INTO voice_cluster_observations
         (id, voice_cluster_id, recording_id, local_speaker_label, embedding_json, speech_seconds,
          quality_score, similarity, runner_up_margin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(), clusterId, recordingId, speaker.label, JSON.stringify(embedding), speaker.speechSeconds,
          speaker.qualityScore ?? null, decision.similarity, decision.runnerUpMargin
        ]
      )
      runNoSave(
        `INSERT INTO recording_voice_clusters
         (recording_id, local_speaker_label, transcript_speaker_label, voice_cluster_id,
          match_status, similarity, runner_up_margin)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [recordingId, speaker.label, stableLabel, clusterId, decision.status, decision.similarity, decision.runnerUpMargin]
      )
      matches.push({
        localSpeakerLabel: speaker.label,
        voiceClusterId: clusterId,
        stableLabel,
        status: decision.status,
        similarity: decision.similarity,
        runnerUpMargin: decision.runnerUpMargin,
        contactId: row.contact_id,
        contactName: row.contact_name,
        speechSeconds: speaker.speechSeconds
      })
    }
    return matches
  })
}

export async function runSpeakerLinkingPreflight(
  recordingId: string,
  audioPath: string,
  shouldContinue: () => boolean
): Promise<SpeakerLinkingResult> {
  const config = getConfig().transcription
  if (!config.speakerLinkingEnabled) {
    return {
      available: false,
      model: config.speakerLinkingModel,
      modelVersion: null,
      device: null,
      segments: [],
      matches: [],
      reason: 'disabled in transcription settings'
    }
  }
  const result = await runWorker(audioPath, shouldContinue)
  if (!shouldContinue()) throw new Error('speaker-linking cancelled because recording became ineligible')
  const matches = persistMatches(recordingId, result)
  return {
    available: true,
    model: result.model,
    modelVersion: result.modelVersion,
    device: result.device,
    segments: result.segments,
    matches
  }
}

function overlapSeconds(a: AcousticSegment, b: AcousticSegment): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

/**
 * Re-label provider turns by maximum overlap with the independent local
 * acoustic segmentation. Provider text/timestamps stay intact; only the
 * anonymous speaker label is reconciled. Unmatched turns remain unchanged.
 */
export function reconcileProviderSpeakers(
  speakersJson: string | undefined,
  linking: SpeakerLinkingResult
): string | undefined {
  if (!speakersJson || !linking.available || !linking.matches.length) return speakersJson
  try {
    const turns = JSON.parse(speakersJson) as Array<Record<string, unknown>>
    if (!Array.isArray(turns)) return speakersJson
    const stableByLocal = new Map(linking.matches.map((match) => [match.localSpeakerLabel, match.stableLabel]))
    const rewritten = turns.map((turn) => {
      const start = Number(turn.start)
      const end = Number(turn.end)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return turn
      const target = { start, end, speaker: '' }
      const overlapByLocal = new Map<string, number>()
      for (const segment of linking.segments) {
        const overlap = overlapSeconds(target, segment)
        if (overlap > 0) overlapByLocal.set(segment.speaker, (overlapByLocal.get(segment.speaker) ?? 0) + overlap)
      }
      const best = [...overlapByLocal.entries()].sort((a, b) => b[1] - a[1])[0]
      if (!best || best[1] / (end - start) < 0.35) return turn
      const stable = stableByLocal.get(best[0])
      return stable ? { ...turn, speaker: stable } : turn
    })
    return JSON.stringify(rewritten)
  } catch {
    return speakersJson
  }
}

export function buildSpeakerLinkingContext(linking: SpeakerLinkingResult): string {
  if (!linking.available) return `LOCAL SPEAKER LINKING: unavailable (${linking.reason ?? 'unknown reason'})`
  const identities = linking.matches.map((match) =>
    `${match.localSpeakerLabel} -> ${match.stableLabel}` +
    (match.contactName ? ` (known contact: ${match.contactName})` : ' (identity unknown)')
  )
  return `LOCAL ACOUSTIC SPEAKER EVIDENCE (authoritative for speaker boundaries; names remain evidence-bound):
Model: ${linking.model}@${linking.modelVersion}; device: ${linking.device ?? 'unknown'}
Voices: ${identities.join('; ') || 'none with enough speech'}
Segments: ${linking.segments.map((segment) =>
    `${segment.start.toFixed(2)}-${segment.end.toFixed(2)}s ${segment.speaker}`
  ).join(', ')}`
}

/** Bind only clusters already anchored to a contact. Unknown clusters stay anonymous. */
export function applyKnownVoiceBindings(recordingId: string): number {
  return runInTransaction(() => {
    const rows = queryAll<{ transcript_speaker_label: string; contact_id: string }>(
      `SELECT DISTINCT rvc.transcript_speaker_label, vc.contact_id
       FROM recording_voice_clusters rvc
       JOIN voice_clusters vc ON vc.id = rvc.voice_cluster_id
       WHERE rvc.recording_id = ? AND rvc.transcript_speaker_label IS NOT NULL AND vc.contact_id IS NOT NULL`,
      [recordingId]
    )
    let inserted = 0
    for (const row of rows) {
      const existing = queryOne(
        'SELECT 1 FROM transcript_speakers WHERE recording_id = ? AND speaker_label = ?',
        [recordingId, row.transcript_speaker_label]
      )
      if (existing) continue
      runNoSave(
        'INSERT INTO transcript_speakers (id, recording_id, speaker_label, contact_id) VALUES (?, ?, ?, ?)',
        [randomUUID(), recordingId, row.transcript_speaker_label, row.contact_id]
      )
      inserted++
    }
    return inserted
  })
}

/** A manual/self-ID speaker binding becomes the evidence anchor for its voice cluster. */
export function anchorVoiceClusterForSpeaker(
  recordingId: string,
  speakerLabel: string,
  contactId: string,
  method: 'manual' | 'self-identification',
  confidence: number
): boolean {
  const mapping = queryOne<{ voice_cluster_id: string }>(
    `SELECT voice_cluster_id FROM recording_voice_clusters
     WHERE recording_id = ? AND transcript_speaker_label = ?`,
    [recordingId, speakerLabel]
  )
  if (!mapping) return false
  runNoSave(
    `UPDATE voice_clusters SET contact_id = ?, contact_link_method = ?,
     contact_link_confidence = ?, updated_at = ? WHERE id = ?`,
    [contactId, method, confidence, new Date().toISOString(), mapping.voice_cluster_id]
  )
  return true
}
