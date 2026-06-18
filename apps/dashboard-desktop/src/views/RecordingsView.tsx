import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, ListChecks, Search, Sparkles } from 'lucide-react'
import { StatusBadge } from '@components/StatusBadge'
import { dashboardApi } from '@data/api'
import { formatDateTime, formatDuration } from '@data/format'
import type { RecordingDetail, RecordingRow } from '../../electron/preload/index.d'

interface RecordingsViewProps {
  recordings: RecordingRow[]
  onDownloadRecording(recordingId: string): Promise<void>
}

export function RecordingsView({ recordings, onDownloadRecording }: RecordingsViewProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | RecordingRow['status']>('all')
  const [selectedId, setSelectedId] = useState(recordings[0]?.id ?? null)
  const [detail, setDetail] = useState<RecordingDetail | null>(null)

  const filteredRecordings = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return recordings.filter((recording) => {
      const matchesQuery = !needle || recording.title.toLowerCase().includes(needle)
      const matchesStatus = status === 'all' || recording.status === status
      return matchesQuery && matchesStatus
    })
  }, [query, recordings, status])

  useEffect(() => {
    if (!selectedId && recordings[0]) setSelectedId(recordings[0].id)
  }, [recordings, selectedId])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }

    dashboardApi.recordings
      .get(selectedId)
      .then(setDetail)
      .catch(() => setDetail(null))
  }, [selectedId])

  return (
    <div className="view-stack">
      <div className="page-heading">
        <div>
          <h1>Recordings</h1>
          <p>Local rows, transcripts, summaries, and recording-linked tasks.</p>
        </div>
        <div className="toolbar">
          <label className="search-box">
            <Search size={16} />
            <input
              aria-label="Search recordings"
              placeholder="Search recordings"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <select
            aria-label="Filter recordings by status"
            className="select-control"
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value as 'all' | RecordingRow['status'])}
          >
            <option value="all">All statuses</option>
            <option value="on-device">On device</option>
            <option value="downloaded">Downloaded</option>
            <option value="transcribed">Transcribed</option>
            <option value="summarized">Summarized</option>
          </select>
        </div>
      </div>

      <div className="recording-layout">
        <section className="panel table-panel">
          <div className="table-header recordings-table">
            <span>Title</span>
            <span>Recorded</span>
            <span>Duration</span>
            <span>Status</span>
            <span>Transcript</span>
            <span></span>
          </div>
          {filteredRecordings.map((recording) => (
            <button
              className={
                selectedId === recording.id
                  ? 'table-row recordings-table table-row--button table-row--selected'
                  : 'table-row recordings-table table-row--button'
              }
              key={recording.id}
              type="button"
              onClick={() => setSelectedId(recording.id)}
            >
              <strong>{recording.title}</strong>
              <span>{formatDateTime(recording.recordedAt)}</span>
              <span>{formatDuration(recording.durationSeconds)}</span>
              <StatusBadge value={recording.status} tone={recording.status === 'on-device' ? 'warning' : 'good'} />
              <StatusBadge
                value={recording.transcriptStatus}
                tone={recording.transcriptStatus === 'complete' ? 'good' : 'neutral'}
              />
              <Download size={16} />
            </button>
          ))}
        </section>

        <aside className="panel detail-panel">
          {detail ? (
            <>
              <header className="panel-header">
                <div>
                  <h2>{detail.recording.title}</h2>
                  <p>
                    {formatDateTime(detail.recording.recordedAt)} · {formatDuration(detail.recording.durationSeconds)}
                  </p>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Download ${detail.recording.title}`}
                  onClick={() => onDownloadRecording(detail.recording.id)}
                >
                  <Download size={16} />
                </button>
              </header>

              <section className="detail-section">
                <h3>
                  <FileText size={15} />
                  Transcript
                </h3>
                <p>{detail.transcript?.text ?? 'No transcript captured yet.'}</p>
              </section>

              <section className="detail-section">
                <h3>
                  <Sparkles size={15} />
                  Summary
                </h3>
                <p>{detail.summary?.text ?? 'No summary captured yet.'}</p>
              </section>

              <section className="detail-section">
                <h3>
                  <ListChecks size={15} />
                  Tasks
                </h3>
                <div className="linked-task-list">
                  {detail.tasks.map((task) => (
                    <div className="linked-task" key={task.id}>
                      <strong>{task.title}</strong>
                      <StatusBadge value={task.lane} tone={task.lane === 'done' ? 'good' : 'neutral'} />
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <p>No recording selected.</p>
          )}
        </aside>
      </div>
    </div>
  )
}
