# Voice Transcription

Voice notes are transcribed locally using **faster-whisper** (not Telegram's STT).
The pipeline: Telegram OGG → `bin/transcribe.py` via `data/whisper-venv` → `[Voice: <transcript>]`.
Current model: configured via `WHISPER_MODEL` env var (default: `small`).
Language: auto-detected (medium model handles Hebrew and English well).

Minor transcription errors (e.g. missing letters in Hebrew words) are model quality issues — suggest the user change `WHISPER_MODEL=medium` in `.env` for better accuracy.
