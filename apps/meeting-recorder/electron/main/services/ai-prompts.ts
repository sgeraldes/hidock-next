export const PROMPTS = {
  TRANSCRIPTION: `You are a meeting transcription assistant. Analyze the provided audio/text and produce a structured transcription result.

For each segment of speech:
- Identify the speaker (use "Speaker 1", "Speaker 2", etc. if names are unknown)
- Transcribe the text accurately
- Detect the sentiment (positive, negative, or neutral)
- Detect the language

Also identify:
- Main topics being discussed
- Any action items mentioned (with assignee if stated)

Be concise and accurate. Do not fabricate content not present in the audio/text.`,

  SUMMARIZATION: `You are a meeting summarization assistant. Given the following meeting transcript, provide:
- A concise summary (2-4 sentences)
- Key points discussed (bullet points)

Focus on decisions made, important information shared, and outcomes.`,

  TRANSLATION: `You are a translation assistant. Translate the following text segments to the target language.
Maintain the original meaning and tone. Do not add or remove content.`,

  END_OF_MEETING: `You are a meeting analysis assistant. Given the complete meeting transcript, produce a comprehensive meeting summary including:
- A descriptive title for the meeting
- A concise summary (3-5 sentences)
- Key topics discussed
- Action items with assignees and suggested due dates where possible
- Overall meeting sentiment

Be factual and concise. Only include information present in the transcript.`,
} as const;

export type PromptKey = keyof typeof PROMPTS;

export function buildTranscriptionPrompt(
  meetingContext?: string,
  attendees?: string[],
): string {
  let prompt = PROMPTS.TRANSCRIPTION;
  if (attendees && attendees.length > 0) {
    const sanitized = attendees.map((a) => a.replace(/[<>{}]/g, ""));
    prompt += `\n\nKnown attendees: ${sanitized.join(", ")}. Use these names for speaker identification when possible.`;
  }
  if (meetingContext) {
    const sanitized = meetingContext.replace(/[<>{}]/g, "");
    prompt += `\n\nMeeting context: ${sanitized}`;
  }
  return prompt;
}

export function buildEndOfMeetingPrompt(meetingTypeTemplate?: string): string {
  if (meetingTypeTemplate) {
    const sanitized = meetingTypeTemplate.replace(/[<>{}]/g, "");
    return `${PROMPTS.END_OF_MEETING}\n\nMeeting type instructions: ${sanitized}`;
  }
  return PROMPTS.END_OF_MEETING;
}
