import { queryAll } from './database'

export interface RecurringTopicRow {
  recording_id: string
  topics: string | null
}

export interface RecurringTopic {
  topic: string
  recordingCount: number
}

interface TopicFrequency {
  topic: string
  recordingIds: Set<string>
}

const DEFAULT_LOOKBACK_DAYS = 90
const DEFAULT_TOPIC_LIMIT = 8

export function aggregateRecurringTopics(
  rows: RecurringTopicRow[],
  limit = DEFAULT_TOPIC_LIMIT
): RecurringTopic[] {
  const frequencies = new Map<string, TopicFrequency>()

  for (const row of rows) {
    if (!row.recording_id || !row.topics?.trim()) continue

    let topics: unknown
    try {
      topics = JSON.parse(row.topics)
    } catch {
      continue
    }

    if (!Array.isArray(topics)) continue

    for (const value of topics) {
      if (typeof value !== 'string') continue

      const topic = value.trim()
      if (!topic) continue

      const normalizedTopic = topic.toLowerCase()
      const frequency = frequencies.get(normalizedTopic)
      if (frequency) {
        frequency.recordingIds.add(row.recording_id)
      } else {
        frequencies.set(normalizedTopic, {
          topic,
          recordingIds: new Set([row.recording_id])
        })
      }
    }
  }

  return Array.from(frequencies.entries())
    .map(([normalizedTopic, frequency]) => ({
      normalizedTopic,
      topic: frequency.topic,
      recordingCount: frequency.recordingIds.size
    }))
    .sort(
      (a, b) =>
        b.recordingCount - a.recordingCount ||
        a.normalizedTopic.localeCompare(b.normalizedTopic)
    )
    .slice(0, Math.max(0, limit))
    .map(({ topic, recordingCount }) => ({ topic, recordingCount }))
}

export function getRecurringTopics(
  limit = DEFAULT_TOPIC_LIMIT,
  lookbackDays = DEFAULT_LOOKBACK_DAYS
): RecurringTopic[] {
  const rows = queryAll<RecurringTopicRow>(
    `SELECT t.recording_id, t.topics
       FROM transcripts t
       JOIN recordings r ON r.id = t.recording_id
      WHERE t.topics IS NOT NULL
        AND TRIM(t.topics) NOT IN ('', '[]')
        AND datetime(r.date_recorded) >= datetime('now', ?)
        AND COALESCE(r.transcription_status, '') NOT IN ('error', 'failed')
        AND r.deleted_at IS NULL
        AND COALESCE(r.personal, 0) = 0
      ORDER BY datetime(r.date_recorded) DESC`,
    [`-${lookbackDays} days`]
  )

  return aggregateRecurringTopics(rows, limit)
}
