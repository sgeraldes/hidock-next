import { getDisplayTitle } from './getDisplayTitle'
import { parseAttendees } from '@/types'
import type { UnifiedRecording } from '@/types/unified-recording'
import type { Meeting, Transcript } from '@/types'

const MONTH_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
const MONTH_FULL  = ['january','february','march','april','may','june','july','august','september','october','november','december']

export function buildDateAliases(date: Date): string {
  if (!date || isNaN(date.getTime())) return ''
  const month = date.getMonth()
  const day   = date.getDate()
  const year  = date.getFullYear()
  const short = MONTH_SHORT[month]
  const full  = MONTH_FULL[month]
  const mm    = String(month + 1).padStart(2, '0')
  const dd    = String(day).padStart(2, '0')
  return [
    `${short}${dd}`,        // sep25
    `${short} ${day}`,      // sep 25
    `${short} ${dd}`,       // sep 25 (zero-padded)
    `${full} ${day}`,       // september 25
    `${full} ${dd}`,        // september 25 (zero-padded)
    `${short} ${year}`,     // sep 2025
    `${full} ${year}`,      // september 2025
    `${mm}/${dd}`,          // 09/25
    `${month + 1}/${day}`,  // 9/25
    `${year}-${mm}-${dd}`,  // 2025-09-25
  ].join(' ')
}

export function buildSearchCorpus(
  recording: UnifiedRecording,
  meeting?: Meeting,
  transcript?: Transcript
): string {
  const parts: string[] = []
  parts.push(getDisplayTitle(recording, meeting, transcript).primaryText)
  parts.push(recording.filename)
  if (meeting?.subject)    parts.push(meeting.subject)
  if (recording.summary)   parts.push(recording.summary)
  if (recording.category)  parts.push(recording.category)
  for (const att of parseAttendees(meeting?.attendees)) {
    if (att.name)  parts.push(att.name)
    if (att.email) parts.push(att.email)
  }
  if (recording.dateRecorded) parts.push(buildDateAliases(recording.dateRecorded))
  return parts.join(' ').toLowerCase()
}
