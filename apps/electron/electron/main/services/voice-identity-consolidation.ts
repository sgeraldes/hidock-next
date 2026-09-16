import { randomUUID } from 'crypto'
import { queryAll, queryOne, runInTransaction, runNoSave } from './database'

const ANCHORED_IDENTITY_MERGE_THRESHOLD = 0.9

interface VoiceClusterRow {
  id: string
  model: string
  model_version: string
  embedding_dimension: number
  centroid_json: string
  contact_id: string | null
  contact_link_method: string | null
  created_at: string
}

export interface VoiceIdentityConsolidationResult {
  canonicalClusterId: string | null
  mergedClusterIds: string[]
  updatedRecordingIds: string[]
}

function normalize(values: number[]): number[] {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return []
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(magnitude) || magnitude <= 1e-12) return []
  return values.map((value) => value / magnitude)
}

function similarity(left: number[], right: number[]): number {
  const a = normalize(left)
  const b = normalize(right)
  if (!a.length || a.length !== b.length) return -1
  return a.reduce((sum, value, index) => sum + value * b[index], 0)
}

function updateWeightedCentroid(
  previous: number[],
  previousWeight: number,
  observation: number[],
  observationWeight: number
): number[] {
  const a = normalize(previous)
  const b = normalize(observation)
  if (!a.length) return b
  if (!b.length || a.length !== b.length) return a
  const oldWeight = Math.max(0, previousWeight)
  const newWeight = Math.max(0.001, observationWeight)
  return normalize(a.map((value, index) =>
    ((value * oldWeight) + (b[index] * newWeight)) / (oldWeight + newWeight)
  ))
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

function recordingIdsForCluster(clusterId: string): Set<string> {
  return new Set(queryAll<{ recording_id: string }>(
    'SELECT DISTINCT recording_id FROM recording_voice_clusters WHERE voice_cluster_id = ?',
    [clusterId]
  ).map((row) => row.recording_id))
}

function setsOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) if (right.has(value)) return true
  return false
}

function rewriteStoredTranscriptSpeakerNoSave(recordingId: string, fromLabel: string, toLabel: string): void {
  if (fromLabel === toLabel) return
  const transcript = queryOne<{ speakers: string | null }>(
    'SELECT speakers FROM transcripts WHERE recording_id = ?',
    [recordingId]
  )
  if (!transcript?.speakers) return
  try {
    const turns = JSON.parse(transcript.speakers) as Array<Record<string, unknown>>
    if (!Array.isArray(turns)) return
    let changed = false
    const rewritten = turns.map((turn) => {
      if (String(turn.speaker) !== fromLabel) return turn
      changed = true
      return { ...turn, speaker: toLabel }
    })
    if (changed) {
      runNoSave('UPDATE transcripts SET speakers = ? WHERE recording_id = ?', [JSON.stringify(rewritten), recordingId])
    }
  } catch {
    // Malformed provider JSON remains inspectable and is not rewritten blindly.
  }
}

function rebuildClusterCentroidNoSave(clusterId: string): void {
  const observations = queryAll<{ embedding_json: string; speech_seconds: number }>(
    'SELECT embedding_json, speech_seconds FROM voice_cluster_observations WHERE voice_cluster_id = ?',
    [clusterId]
  )
  let centroid: number[] = []
  let totalWeight = 0
  let validCount = 0
  for (const observation of observations) {
    try {
      const parsed = JSON.parse(observation.embedding_json)
      const embedding = Array.isArray(parsed) ? parsed.map(Number) : []
      if (!embedding.length) continue
      centroid = updateWeightedCentroid(centroid, totalWeight, embedding, observation.speech_seconds)
      totalWeight += Math.max(0.001, observation.speech_seconds)
      validCount++
    } catch { /* malformed evidence is ignored */ }
  }
  if (!centroid.length) return
  runNoSave(
    `UPDATE voice_clusters SET centroid_json = ?, observation_count = ?, total_speech_seconds = ?,
     updated_at = ? WHERE id = ?`,
    [JSON.stringify(centroid), validCount, totalWeight, new Date().toISOString(), clusterId]
  )
}

/**
 * Propagate an independently confirmed person assignment through conservative
 * historical acoustic duplicates. Candidates anchored to another person,
 * carrying a conflicting per-recording binding, or co-occurring with any
 * accepted cluster are never merged.
 */
export function consolidateVoiceIdentityForSpeaker(
  recordingId: string,
  speakerLabel: string,
  contactId: string
): VoiceIdentityConsolidationResult {
  return runInTransaction(() => {
    const source = queryOne<VoiceClusterRow>(
      `SELECT vc.* FROM voice_clusters vc
       JOIN recording_voice_clusters rvc ON rvc.voice_cluster_id = vc.id
       WHERE rvc.recording_id = ? AND rvc.transcript_speaker_label = ?`,
      [recordingId, speakerLabel]
    )
    if (!source || source.contact_id !== contactId) {
      return { canonicalClusterId: null, mergedClusterIds: [], updatedRecordingIds: [] }
    }

    const compatible = queryAll<VoiceClusterRow>(
      `SELECT * FROM voice_clusters
       WHERE model = ? AND model_version = ? AND embedding_dimension = ?`,
      [source.model, source.model_version, source.embedding_dimension]
    )
    const anchored = compatible
      .filter((cluster) => cluster.contact_id === contactId)
      .sort((left, right) => {
        const methodRank = (method: string | null): number => method === 'manual' ? 0 : 1
        return methodRank(left.contact_link_method) - methodRank(right.contact_link_method) ||
          String(left.created_at).localeCompare(String(right.created_at)) || left.id.localeCompare(right.id)
      })
    const canonical = anchored[0] ?? source
    const canonicalLabel = stableVoiceLabel(canonical.id)
    const canonicalCentroid = parseCentroid(canonical)
    if (!canonicalCentroid.length) {
      return { canonicalClusterId: canonical.id, mergedClusterIds: [], updatedRecordingIds: [] }
    }

    const acceptedRecordings = recordingIdsForCluster(canonical.id)
    const candidates = compatible
      .filter((cluster) => cluster.id !== canonical.id && (!cluster.contact_id || cluster.contact_id === contactId))
      .map((cluster) => ({ cluster, score: similarity(canonicalCentroid, parseCentroid(cluster)) }))
      .filter(({ score }) => score >= ANCHORED_IDENTITY_MERGE_THRESHOLD)
      .sort((left, right) => right.score - left.score)

    const mergedClusterIds: string[] = []
    const updatedRecordingIds = new Set<string>()
    for (const { cluster } of candidates) {
      const candidateRecordings = recordingIdsForCluster(cluster.id)
      if (setsOverlap(candidateRecordings, acceptedRecordings)) continue

      const conflictingBinding = queryOne(
        `SELECT 1 FROM recording_voice_clusters rvc
         JOIN transcript_speakers ts
           ON ts.recording_id = rvc.recording_id
          AND (ts.speaker_label = rvc.transcript_speaker_label OR ts.speaker_label = ?)
         WHERE rvc.voice_cluster_id = ? AND ts.contact_id <> ? LIMIT 1`,
        [canonicalLabel, cluster.id, contactId]
      )
      if (conflictingBinding) continue

      const mappings = queryAll<{ recording_id: string; transcript_speaker_label: string | null }>(
        `SELECT recording_id, transcript_speaker_label FROM recording_voice_clusters
         WHERE voice_cluster_id = ?`,
        [cluster.id]
      )
      runNoSave('UPDATE voice_cluster_observations SET voice_cluster_id = ? WHERE voice_cluster_id = ?', [
        canonical.id, cluster.id
      ])
      runNoSave(
        `UPDATE recording_voice_clusters SET voice_cluster_id = ?, transcript_speaker_label = ?,
         match_status = 'matched' WHERE voice_cluster_id = ?`,
        [canonical.id, canonicalLabel, cluster.id]
      )
      for (const mapping of mappings) {
        const oldLabel = mapping.transcript_speaker_label
        if (oldLabel) rewriteStoredTranscriptSpeakerNoSave(mapping.recording_id, oldLabel, canonicalLabel)
        runNoSave(
          `INSERT OR IGNORE INTO transcript_speakers
           (id, recording_id, speaker_label, contact_id) VALUES (?, ?, ?, ?)`,
          [randomUUID(), mapping.recording_id, canonicalLabel, contactId]
        )
        if (oldLabel && oldLabel !== canonicalLabel) {
          runNoSave(
            'DELETE FROM transcript_speakers WHERE recording_id = ? AND speaker_label = ? AND contact_id = ?',
            [mapping.recording_id, oldLabel, contactId]
          )
        }
        updatedRecordingIds.add(mapping.recording_id)
      }
      runNoSave('DELETE FROM voice_clusters WHERE id = ?', [cluster.id])
      mergedClusterIds.push(cluster.id)
      for (const id of candidateRecordings) acceptedRecordings.add(id)
    }

    if (mergedClusterIds.length) rebuildClusterCentroidNoSave(canonical.id)
    return {
      canonicalClusterId: canonical.id,
      mergedClusterIds,
      updatedRecordingIds: [...updatedRecordingIds]
    }
  })
}
