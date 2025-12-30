import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Clock, MapPin, Users, Mic, FileText, Play, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime, formatDuration } from '@/lib/utils'
import { parseAttendees, parseJsonArray } from '@/types'
import { AudioPlayer } from '@/components/AudioPlayer'
import { useAudioControls } from '@/components/OperationController'
import { useUIStore } from '@/store/useUIStore'
import type { MeetingDetails } from '@/types'

export function MeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [details, setDetails] = useState<MeetingDetails | null>(null)
  const [loading, setLoading] = useState(true)

  // Global playback state
  const currentlyPlayingId = useUIStore((state) => state.currentlyPlayingId)
  const audioControls = useAudioControls()

  useEffect(() => {
    if (id) {
      loadMeetingDetails(id)
    }
  }, [id])

  const loadMeetingDetails = async (meetingId: string) => {
    setLoading(true)
    try {
      const data = await window.electronAPI.meetings.getDetails(meetingId)
      setDetails(data)
    } catch (error) {
      console.error('Failed to load meeting details:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading meeting details...</p>
      </div>
    )
  }

  if (!details) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Meeting not found</p>
        <Button variant="outline" onClick={() => navigate('/calendar')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Calendar
        </Button>
      </div>
    )
  }

  const { meeting, recordings } = details
  const attendees = parseAttendees(meeting.attendees)
  const startDate = new Date(meeting.start_time)
  const endDate = new Date(meeting.end_time)
  const durationMins = Math.round((endDate.getTime() - startDate.getTime()) / 60000)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-4 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/calendar')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{meeting.subject}</h1>
          <p className="text-sm text-muted-foreground">{formatDateTime(meeting.start_time)}</p>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Meeting Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Meeting Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">
                    {startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} -{' '}
                    {endDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p className="text-sm text-muted-foreground">{durationMins} minutes</p>
                </div>
              </div>

              {meeting.location && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <p>{meeting.location}</p>
                </div>
              )}

              {meeting.organizer_name && (
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Organizer: {meeting.organizer_name}</p>
                    {meeting.organizer_email && (
                      <p className="text-sm text-muted-foreground">{meeting.organizer_email}</p>
                    )}
                  </div>
                </div>
              )}

              {attendees.length > 0 && (
                <div>
                  <p className="font-medium mb-2">Attendees ({attendees.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {attendees.map((attendee, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 bg-secondary text-secondary-foreground rounded-full text-xs"
                      >
                        {attendee.name || attendee.email}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {meeting.meeting_url && (
                <div>
                  <a
                    href={meeting.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline text-sm"
                  >
                    Join Meeting Link
                  </a>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recordings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Mic className="h-5 w-5" />
                Recordings ({recordings.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recordings.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No recordings linked to this meeting
                </p>
              ) : (
                <div className="space-y-4">
                  {recordings.map((recording) => (
                    <div key={recording.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Mic className="h-4 w-4 text-green-600" />
                          <span className="font-medium">{recording.filename}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-1 rounded-full bg-secondary">
                            {recording.status}
                          </span>
                          {currentlyPlayingId === recording.id ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => audioControls.stop()}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => recording.file_path && audioControls.play(recording.id, recording.file_path)}
                              disabled={!recording.file_path}
                              title={recording.file_path ? 'Play recording' : 'Recording not available locally'}
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Audio Player */}
                      {currentlyPlayingId === recording.id && recording.file_path && (
                        <div className="my-3">
                          <AudioPlayer
                            filename={recording.filename}
                            onClose={() => audioControls.stop()}
                          />
                        </div>
                      )}

                      {recording.duration_seconds && (
                        <p className="text-sm text-muted-foreground">
                          Duration: {formatDuration(recording.duration_seconds)}
                        </p>
                      )}

                      {/* Transcript */}
                      {recording.transcript && (
                        <div className="mt-4 pt-4 border-t">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText className="h-4 w-4" />
                            <span className="font-medium text-sm">Transcript</span>
                          </div>

                          {recording.transcript.summary && (
                            <div className="mb-3 p-3 bg-muted rounded-lg">
                              <p className="text-xs font-medium text-muted-foreground mb-1">Summary</p>
                              <p className="text-sm">{recording.transcript.summary}</p>
                            </div>
                          )}

                          {recording.transcript.action_items && (
                            <div className="mb-3">
                              <p className="text-xs font-medium text-muted-foreground mb-1">
                                Action Items
                              </p>
                              <ul className="list-disc list-inside text-sm space-y-1">
                                {parseJsonArray<string>(recording.transcript.action_items).map(
                                  (item, i) => (
                                    <li key={i}>{item}</li>
                                  )
                                )}
                              </ul>
                            </div>
                          )}

                          <details className="mt-2">
                            <summary className="text-sm text-primary cursor-pointer hover:underline">
                              View full transcript
                            </summary>
                            <p className="mt-2 text-sm whitespace-pre-wrap bg-muted p-3 rounded-lg max-h-64 overflow-auto">
                              {recording.transcript.full_text}
                            </p>
                          </details>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
