# Local speaker-linking runtime

The Electron pipeline invokes `worker.py` before ASR. It performs acoustic
diarization and returns one embedding centroid per local speaker using
`pyannote/speaker-diarization-community-1`. Until that gated model's terms are
accepted, the worker automatically uses `pyannote/speaker-diarization-3.1` and
reports the actual fallback model/version in processing provenance.

This is persistent acoustic speaker linking, not authentication. No dedicated
enrollment recording is required. The app learns anonymous voice clusters from
ordinary recordings and links a cluster to a contact only after manual or
high-confidence self-identification evidence.

Use Python 3.11 with a CUDA-enabled PyTorch build, then install
`requirements.txt`. Configure the interpreter through
`transcription.speakerLinkingPythonPath`. The Hugging Face account/token must
have accepted the community-1 model conditions once; cached models can run
offline afterward. The worker decodes app-supported audio through Electron's
bundled FFmpeg into an in-memory 16 kHz mono waveform, avoiding torchcodec DLL
compatibility problems on Windows.
