# Future Upgrade: Pluggable Transcript Analysis Providers

Local ASR should remain responsible for speech-to-text only. The follow-on meeting intelligence work
should split transcript analysis into a provider interface so summaries, title suggestions, actionables,
question suggestions, and meeting-content matching can be handled by different agents.

Candidate analysis providers:
- Gemini, when configured
- Codex SDK / external Codex agent
- Claude Code SDK / external Claude agent
- Local Pi or other local agent runtime

Acceptance criteria:
- A transcript can be produced locally without any cloud analysis key.
- Analysis provider failures do not fail or roll back a completed transcript.
- Provider metadata is stored with generated analysis fields so users can audit what created them.
- Settings make the ASR provider and analysis provider separate choices.
