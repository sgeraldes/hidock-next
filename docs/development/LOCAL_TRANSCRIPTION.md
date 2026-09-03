# Local transcription and meeting analysis

HiDock Next can run the complete recording pipeline locally on macOS:

```text
HiDock audio -> whisper.cpp -> transcript -> Ollama -> summary/actions/search/graph
```

Recordings and transcripts are not uploaded when **Local Whisper** is selected and
Ollama is the selected AI brain. Local inference has no per-request API charge.

## macOS setup

Install the Apple-Silicon-accelerated Whisper CLI:

```bash
brew install whisper-cpp
```

Download a multilingual model. The default configuration expects:

```text
~/HiDock/models/whisper/ggml-large-v3-turbo-q5_0.bin
```

The model is published by the whisper.cpp project at:

```text
https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
```

Install and start Ollama, then pull the analysis and embedding models:

```bash
ollama pull gemma3:12b
ollama pull nomic-embed-text
```

## HiDock Next settings

1. Open **Settings -> AI Brains**.
2. Enable **Ollama (local)** and make it the default brain.
3. Set the embedding provider to **Ollama (local)**.
4. Under **Transcription**, select **Local Whisper** and save.
5. Confirm these paths:
   - CLI: `/opt/homebrew/bin/whisper-cli`
   - Model: `~/HiDock/models/whisper/ggml-large-v3-turbo-q5_0.bin`

For transcript analysis, set `chat.ollamaModel` (or the Ollama brain model
override) to `gemma3:12b`. `nomic-embed-text` remains the recommended embedding
model.

## Privacy and failure behaviour

The existing recording/capture eligibility checks still run before transcription,
before AI analysis and before persistence. If eligibility cannot be established,
processing stops. Missing Whisper binaries/models also fail closed with an
actionable error rather than falling back to a cloud transcription provider.

Basic whisper.cpp does not identify individual speakers. HiDock Next preserves
timestamps and runs its separate local speaker-linking stage when that optional
model is configured; otherwise the transcript is stored with neutral speaker
labels.

## Verification

Before bulk processing, transcribe one short recording and check:

- the processing metadata reports `local-asr` / `whisper-cpp`;
- the summary run reports `ollama`;
- the transcript language and timestamps look correct;
- actions, decisions and Context Graph ingestion complete.
