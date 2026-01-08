# Task: Add Actionable Detection to Transcription Service

## Track: C (Actionables Auto-Population)
## Priority: HIGH
## Dependencies: None

## Current State
The `transcription.ts` service generates transcripts, summaries, action items, and topics, but does NOT detect "actionables" (intent to create outputs/artifacts).

The `actionables` table exists but is never populated:
```sql
CREATE TABLE actionables (
  id, type, title, description, 
  source_knowledge_id, suggested_template, 
  suggested_recipients, status, ...
)
```

## What's Missing
AI-powered detection logic to identify when a transcript indicates intent to:
- Share meeting minutes
- Send interview feedback
- Create status reports
- Document decisions
- Follow up with specific people

## Implementation Notes
After transcription completes (in `transcribeRecording()`), add an additional AI analysis step:

**Prompt to Gemini:**
```
Based on this transcript, detect if there's intent to create any of these outputs:
1. Meeting Minutes - mentions "send minutes", "share notes", "document this meeting"
2. Interview Feedback - interview context, mentions "send feedback", "share thoughts"
3. Status Report - mentions "weekly update", "status report", "progress summary"
4. Decision Log - mentions "document decision", "record this", "write up"
5. Action Item List - mentions "send action items", "share tasks"

For each detected intent, return JSON:
{
  "actionables": [
    {
      "type": "meeting_minutes",
      "title": "Suggested title",
      "description": "Why this actionable was detected",
      "suggested_template": "meeting_minutes",
      "suggested_recipients": ["person1@example.com", ...],
      "confidence": 0.85
    }
  ]
}

Only include actionables with confidence >= 0.7
```

## Acceptance Criteria
- [ ] Add actionable detection prompt after transcription
- [ ] Parse AI response to extract actionables
- [ ] For each detected actionable (confidence >= 0.7):
  - [ ] Insert into `actionables` table
  - [ ] Link to knowledge_capture via `source_knowledge_id`
  - [ ] Set status to 'pending'
  - [ ] Store suggested template and recipients
- [ ] Handle parsing errors gracefully
- [ ] Log detection results for debugging

## Files to Modify
- `apps/electron/electron/main/services/transcription.ts` (add detection after line ~300)
- `apps/electron/electron/main/services/database.ts` (add `insertActionable()` helper if needed)

## Related Specs
- Plan: Wave 1 - Track C
- Database schema: `actionables` table

## Security Considerations
- Validate AI response before inserting into database
- Sanitize suggested_recipients (validate email format)
- Prevent SQL injection in dynamic queries
- Validate suggested_template against known templates
