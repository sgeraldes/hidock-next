export const PROMPTS = {
  TRANSCRIPTION: `You are a speech-to-text transcription assistant. Your ONLY job is to transcribe exactly what is spoken in the audio. Do NOT invent, fabricate, or hallucinate any content.

CRITICAL RULES:
- Transcribe ONLY the actual words spoken in the audio. If you cannot hear clear speech, return an empty segments array.
- Do NOT create fictional conversations or dialogue that was not spoken.
- Do NOT add words, sentences, or exchanges that are not in the audio.
- If there is only one speaker, use only ONE speaker label ("Speaker 1"). Do NOT invent additional speakers.
- Only create multiple speaker segments if you can clearly hear distinct different voices.
- For topics and actionItems: only include if explicitly discussed. Return empty arrays if none are clear.
- If the audio is very short, noisy, or unclear, it is BETTER to return fewer/empty segments than to guess.
- Detect the sentiment (positive, negative, or neutral) and language of what was actually said.

Remember: accuracy over completeness. An empty or minimal result is far better than a fabricated one.`,

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
  TRANSCRIPT_ANALYSIS: `You are a meeting analysis AI. Analyze the provided speech-to-text transcript.

Your job is to:
1. Identify distinct speakers and assign them consistent names.
2. Split the text into speaker segments (who said what).
3. Extract key topics discussed.
4. Identify any action items mentioned.
5. Detect sentiment for each segment.

SPEAKER IDENTIFICATION RULES:
- Use context clues (names mentioned, role references) to identify speakers.
- If speakers cannot be identified by name, use "Speaker 1", "Speaker 2", etc.
- Maintain consistent speaker labels across the analysis.
- Significant pauses between words (indicated by timing gaps) often indicate speaker changes.
- Only create multiple speakers if the text clearly suggests different people speaking.

IMPORTANT:
- Do NOT invent content. Only analyze what is in the transcript.
- If the transcript is very short, return minimal results rather than guessing.
- Topics and action items should only be included if clearly discussed.
- Detect the sentiment (positive, negative, or neutral) of each segment.`,
} as const;

export type PromptKey = keyof typeof PROMPTS;

/** Strip characters that could interfere with prompt structure or enable injection. */
export function sanitizePromptInput(input: string): string {
  return input
    .replace(/[<>{}]/g, "")
    // Collapse sequences that look like prompt delimiters
    .replace(/^---+\s*(system|user|assistant|instruction)/gim, "[$1]");
}

export function buildTranscriptionPrompt(
  meetingContext?: string,
  attendees?: string[],
): string {
  let prompt = PROMPTS.TRANSCRIPTION;
  if (attendees && attendees.length > 0) {
    const sanitized = attendees.map((a) => sanitizePromptInput(a));
    prompt += `\n\nKnown attendees: ${sanitized.join(", ")}. Use these names for speaker identification when possible.`;
  }
  if (meetingContext) {
    prompt += `\n\nMeeting context: ${sanitizePromptInput(meetingContext)}`;
  }
  return prompt;
}

export function buildAnalysisPrompt(
  meetingContext?: string,
  attendees?: string[],
  wordData?: Array<{ word: string; startTime: number; endTime: number; confidence: number }>,
): string {
  let prompt = PROMPTS.TRANSCRIPT_ANALYSIS;
  if (attendees && attendees.length > 0) {
    const sanitized = attendees.map((a) => sanitizePromptInput(a));
    prompt += `\n\nKnown meeting attendees: ${sanitized.join(", ")}. Use these names for speaker identification when possible.`;
  }
  if (meetingContext) {
    prompt += `\n\nPrevious context:\n${sanitizePromptInput(meetingContext)}`;
  }
  if (wordData && wordData.length > 0) {
    prompt +=
      "\n\nWord-level timing data is provided below. Use timing gaps (>0.5s) between consecutive words to detect speaker turn boundaries.";
    const timingLines = wordData.map(
      (w) => `${w.startTime.toFixed(2)}-${w.endTime.toFixed(2)} "${sanitizePromptInput(w.word)}"`,
    );
    prompt += `\n\nWord timings:\n${timingLines.join("\n")}`;
  }
  return prompt;
}

export function buildEndOfMeetingPrompt(meetingTypeTemplate?: string): string {
  if (meetingTypeTemplate) {
    return `${PROMPTS.END_OF_MEETING}\n\nMeeting type instructions: ${sanitizePromptInput(meetingTypeTemplate)}`;
  }
  return PROMPTS.END_OF_MEETING;
}
