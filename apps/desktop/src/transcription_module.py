# -*- coding: utf-8 -*-
"""
Handles audio transcription and insight extraction using multiple AI providers.

This module provides functionalities to:
- Transcribe audio files into text using various AI services
- Extract structured insights (summary, action items, etc.) from transcriptions
- Process local audio files to produce a complete analysis
- Support for Google Gemini, OpenAI, Anthropic, OpenRouter, Amazon, Qwen, and DeepSeek

It is designed to be used asynchronously and supports multiple AI providers
through a unified interface. Returns mock responses for development without API keys.
"""

import concurrent.futures
import json
import os
import tempfile
import wave
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from ai_service import ai_service
from config_and_logger import logger

# import base64  # Future: base64 encoding for audio data
# import tempfile  # Future: temporary file operations
# from typing import Literal, Optional  # Future: enhanced type annotations


try:
    import google.generativeai as genai
except ImportError:
    genai = None

# --- Constants ---
TRANSCRIPTION_FAILED_DEFAULT_MSG = "Transcription failed or no content returned."
TRANSCRIPTION_PARSE_ERROR_MSG_PREFIX = "Error parsing transcription response:"

# Adaptive chunk sizing hint across runs
_CHUNK_MS_HINT: Optional[int] = None


def _call_gemini_api(payload: Dict[str, Any], api_key: str = "") -> Optional[Dict[str, Any]]:
    """
    Helper function to make a synchronous call to the Gemini API.

    Args:
        payload: The request payload for the Gemini API.
        api_key: The Google Gemini API key. If empty, a mock response is returned.

    Returns:
        A dictionary containing the API response, or None if an error occurs.
        Returns a mock response if the API key is not provided.
    """
    if not api_key:
        logger.warning("GeminiAPI", "_call_gemini_api", "API key is empty. Using mock response.")
        # This mock response simulates the real API structure for offline testing.
        mock_response = {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": "This is a mock API response due to a missing API key."}],
                        "role": "model",
                    },
                    "finishReason": "STOP",
                }
            ],
        }
        # Simulate JSON output if requested by the payload
        if payload.get("generationConfig", {}).get("responseMimeType") == "application/json":
            mock_json_output = {
                "summary": "Mock summary from API (missing key).",
                "category": "Mock Category",
                "meeting_details": {
                    "location": "Mock Location",
                    "date": "2025-07-28",
                    "time": "10:00 AM",
                    "duration_minutes": 30,
                },
                "overall_sentiment_meeting": "Neutral",
                "action_items": ["Mock action item 1", "Mock action item 2"],
                "project_context": "Mock project context.",
            }
            mock_response["candidates"][0]["content"]["parts"][0]["text"] = json.dumps(mock_json_output)
        return mock_response

    if genai is None:
        logger.error(
            "GeminiAPI",
            "_call_gemini_api",
            "google.generativeai not available. Install with: pip install google-generativeai",
        )
        return None
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(payload.get("contents"), generation_config=payload.get("generationConfig"))
        return response.to_dict()
    except Exception as e:
        logger.error("GeminiAPI", "_call_gemini_api", f"Exception during Gemini API call: {e}")
        return None


async def transcribe_audio(
    audio_file_path: str,
    provider: str = "gemini",
    api_key: str = "",
    config: Optional[Dict[str, Any]] = None,
    language: str = "auto",
) -> Dict[str, Any]:
    """
    Transcribes audio file using the specified AI provider.

    Args:
        audio_file_path: Path to the audio file to transcribe.
        provider: AI provider to use ("gemini", "openai", "anthropic", etc.).
        api_key: The API key for the selected provider.
        config: Provider configuration (model, temperature, etc.).
        language: Language code for transcription ("auto" for auto-detection).

    Returns:
        A dictionary containing the transcription results.
    """
    logger.info(
        "TranscriptionModule",
        "transcribe_audio",
        f"Starting transcription with {provider}",
    )

    # Configure the AI service provider
    if not ai_service.configure_provider(provider, api_key, config):
        logger.error(
            "TranscriptionModule",
            "transcribe_audio",
            f"Failed to configure provider: {provider}",
        )
        return {"transcription": TRANSCRIPTION_FAILED_DEFAULT_MSG}

    # Perform transcription
    result = ai_service.transcribe_audio(provider, audio_file_path, language)

    if result.get("success"):
        logger.info(
            "TranscriptionModule",
            "transcribe_audio",
            f"Transcription successful with {provider}",
        )
    else:
        logger.error(
            "TranscriptionModule",
            "transcribe_audio",
            f"Transcription failed: {result.get('error', 'Unknown error')}",
        )

    return result


async def extract_meeting_insights(
    transcription: str,
    provider: str = "gemini",
    api_key: str = "",
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Extracts structured insights from a transcription using the specified AI provider.

    Args:
        transcription: The text transcription to analyze.
        provider: AI provider to use ("gemini", "openai", "anthropic", etc.).
        api_key: The API key for the selected provider.
        config: Provider configuration (model, temperature, etc.).

    Returns:
        A dictionary containing the extracted insights, conforming to a default structure.
    """
    logger.info(
        "TranscriptionModule",
        "extract_meeting_insights",
        f"Starting insight extraction with {provider}",
    )

    # Default structure to ensure UI consistency
    insights = {
        "summary": "N/A",
        "category": "N/A",
        "meeting_details": {
            "location": "N/A",
            "date": "N/A",
            "time": "N/A",
            "duration_minutes": 0,
        },
        "overall_sentiment_meeting": "N/A",
        "action_items": [],
        "project_context": "N/A",
    }

    # Configure the AI service provider
    if not ai_service.configure_provider(provider, api_key, config):
        logger.error(
            "TranscriptionModule",
            "extract_meeting_insights",
            f"Failed to configure provider: {provider}",
        )
        return insights

    # Perform text analysis
    result = ai_service.analyze_text(provider, transcription, "meeting_insights")

    if result.get("success"):
        analysis = result.get("analysis", {})

        # Map the generic analysis format to our specific insights structure
        insights.update(
            {
                "summary": analysis.get("summary", "N/A"),
                "category": "Meeting" if analysis.get("topics") else "N/A",
                "overall_sentiment_meeting": analysis.get("sentiment", "N/A"),
                "action_items": analysis.get("action_items", []),
                "project_context": ", ".join(analysis.get("topics", [])) if analysis.get("topics") else "N/A",
            }
        )

        logger.info(
            "TranscriptionModule",
            "extract_meeting_insights",
            f"Insight extraction successful with {provider}",
        )
    else:
        logger.error(
            "TranscriptionModule",
            "extract_meeting_insights",
            f"Analysis failed: {result.get('error', 'Unknown error')}",
        )

    return insights


def _get_audio_duration(audio_path: str) -> int:
    """Calculates the duration of an audio file in minutes."""
    try:
        ext = os.path.splitext(audio_path)[1].lower()
        
        if ext == ".wav":
            # Use wave module for WAV files
            with wave.open(audio_path, "rb") as wf:
                frames = wf.getnframes()
                rate = wf.getframerate()
                duration_seconds = frames / float(rate) if rate else 0
                return round(duration_seconds / 60)
        else:
            # Use pydub for other formats (MP3, etc.)
            try:
                from pydub import AudioSegment
                
                audio = AudioSegment.from_file(audio_path)
                duration_seconds = len(audio) / 1000.0  # pydub returns duration in milliseconds
                return round(duration_seconds / 60)
            except ImportError:
                logger.warning(
                    "TranscriptionModule", 
                    "_get_audio_duration", 
                    f"pydub not available, cannot get duration for {ext} files"
                )
                return 0
            except Exception as e:
                logger.warning(
                    "TranscriptionModule", 
                    "_get_audio_duration", 
                    f"Could not get duration with pydub: {e}"
                )
                return 0
                
    except Exception as e:
        logger.warning("TranscriptionModule", "_get_audio_duration", f"Could not get duration: {e}")
        return 0


def _split_audio_into_chunks(
    audio_file_path: str,
    max_bytes: int,
    overlap_ms: int = 1000,
    progress_callback: Optional[Callable[[str, Optional[float]], None]] = None,
    cancel_callback: Optional[Callable[[], bool]] = None,
) -> Optional[List[Dict[str, Any]]]:
    """
    Split audio into chunks that remain under the provider upload limit.
    """
    global _CHUNK_MS_HINT

    def _progress(message: str, fraction: Optional[float] = None) -> None:
        if progress_callback:
            progress_callback(message, fraction)

    try:
        from pydub import AudioSegment
    except ImportError as exc:  # pragma: no cover
        logger.error("TranscriptionModule", "_split_audio_into_chunks", f"pydub not available: {exc}")
        return None

    try:
        audio = AudioSegment.from_file(audio_file_path)
    except Exception as exc:
        logger.error("TranscriptionModule", "_split_audio_into_chunks", f"Failed to load audio: {exc}")
        return None

    duration_ms = len(audio)
    size_bytes = os.path.getsize(audio_file_path)

    if size_bytes <= max_bytes:
        return [
            {
                "path": audio_file_path,
                "cleanup": False,
                "start_ms": 0,
                "duration_ms": duration_ms,
            }
        ]

    _progress("Analyzing audio for chunking…", 0.05)

    effective_limit = int(max_bytes * 0.8)
    if effective_limit <= 0:
        effective_limit = max_bytes

    bytes_per_ms = size_bytes / max(duration_ms, 1)

    if _CHUNK_MS_HINT:
        chunk_ms = int(_CHUNK_MS_HINT)
    else:
        chunk_ms = int(effective_limit / max(bytes_per_ms, 1))

    chunk_ms = max(chunk_ms, overlap_ms + 1000)  # ensure forward progress

    fmt = os.path.splitext(audio_file_path)[1].lstrip(".").lower() or "mp3"

    duration_sec = max(duration_ms / 1000.0, 1.0)
    estimated_kbps = int((size_bytes * 8) / duration_sec / 1000)
    bitrate_kbps = max(64, min(192, estimated_kbps))
    bitrate_param = f"{bitrate_kbps}k"

    segments: List[Tuple[int, int, int]] = []  # (index, start_ms, end_ms)
    start_ms = 0
    idx = 0

    while start_ms < duration_ms:
        if cancel_callback and cancel_callback():
            return None

        end_ms = min(duration_ms, start_ms + chunk_ms)
        if end_ms <= start_ms:
            end_ms = min(duration_ms, start_ms + overlap_ms + 1000)

        segments.append((idx, start_ms, end_ms))
        if end_ms >= duration_ms:
            break

        start_ms = max(0, end_ms - overlap_ms)
        idx += 1

    total_segments = len(segments)
    if total_segments == 0:
        return None

    if total_segments == 1:
        _CHUNK_MS_HINT = segments[0][2] - segments[0][1]
        return [
            {
                "path": audio_file_path,
                "cleanup": False,
                "start_ms": segments[0][1],
                "duration_ms": segments[0][2] - segments[0][1],
            }
        ]

    _progress(f"Encoding {total_segments} chunks…", 0.1)

    segment_payloads: List[Tuple[int, Any, int, int]] = []
    for index, start_ms, end_ms in segments:
        if cancel_callback and cancel_callback():
            return None
        segment_payloads.append((index, audio[start_ms:end_ms], start_ms, end_ms - start_ms))

    chunks: List[Optional[Dict[str, Any]]] = [None] * total_segments

    def _export(idx: int, segment, start_ms: int, duration_ms: int) -> Dict[str, Any]:
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=f"_chunk{idx:03d}.{fmt}")
        temp_path = temp_file.name
        temp_file.close()

        export_kwargs = {"format": fmt}
        parameters: List[str] = []
        if fmt in {"mp3", "ogg", "m4a", "aac", "wma"}:
            export_kwargs["bitrate"] = bitrate_param
            parameters = ["-ar", str(segment.frame_rate), "-ac", str(segment.channels)]

        try:
            segment.export(temp_path, **export_kwargs, parameters=parameters)  # type: ignore[arg-type]
        except TypeError:
            segment.export(temp_path, **export_kwargs)

        chunk_size = os.path.getsize(temp_path)
        if chunk_size > max_bytes:
            os.unlink(temp_path)
            raise ValueError(
                f"Chunk {idx} exceeded size limit ({chunk_size} bytes > {max_bytes} bytes)."
            )

        return {
            "path": temp_path,
            "cleanup": True,
            "start_ms": start_ms,
            "duration_ms": duration_ms,
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, total_segments)) as executor:
        future_map = {
            executor.submit(_export, idx, segment, start_ms, duration_ms): idx
            for idx, segment, start_ms, duration_ms in segment_payloads
        }

        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            idx = future_map[future]
            if cancel_callback and cancel_callback():
                for pending in future_map:
                    pending.cancel()
                _cleanup_chunk_files([chunk for chunk in chunks if isinstance(chunk, dict)])
                return None

            try:
                chunk_info = future.result()
            except Exception as exc:
                logger.error(
                    "TranscriptionModule",
                    "_split_audio_into_chunks",
                    f"Chunk export failed: {exc}",
                )
                _cleanup_chunk_files([chunk for chunk in chunks if isinstance(chunk, dict)])
                return None

            chunks[idx] = chunk_info
            completed += 1
            _progress(f"Chunk {completed}/{total_segments} ready", completed / total_segments)

    ordered_chunks = [chunk for chunk in chunks if chunk is not None]
    if not ordered_chunks:
        return None

    _CHUNK_MS_HINT = max(chunk["duration_ms"] for chunk in ordered_chunks)

    return ordered_chunks


def _cleanup_chunk_files(chunks: List[Dict[str, Any]]) -> None:
    if not chunks:
        return
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        if chunk.get("cleanup") and chunk.get("path"):
            try:
                if os.path.exists(chunk["path"]):
                    os.remove(chunk["path"])
            except Exception as exc:  # pragma: no cover - best effort cleanup
                logger.debug(
                    "TranscriptionModule",
                    "_cleanup_chunk_files",
                    f"Failed to remove chunk {chunk['path']}: {exc}",
                )


async def process_audio_file_for_insights(
    audio_file_path: str,
    provider: str = "gemini",
    api_key: str = "",
    config: Optional[Dict[str, Any]] = None,
    language: str = "auto",
    progress_callback: Optional[Callable[[str, Optional[float]], None]] = None,
    cancel_callback: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
    """
    Orchestrates the full audio processing pipeline: read, transcribe, and extract insights.

    IMPORTANT: This function handles HTA file conversion automatically.

    Args:
        audio_file_path: The absolute path to the audio file.
        provider: AI provider to use ("gemini", "openai", "anthropic", etc.).
        api_key: The API key for the selected provider.
        config: Provider configuration (model, temperature, etc.).
        language: Language code for transcription ("auto" for auto-detection).

    Returns:
        A dictionary containing the transcription, insights, and any errors.
    """
    def _report(message: str, fraction: float = None) -> None:
        if progress_callback is None:
            return

        try:
            if fraction is None:
                fraction_value = None
            else:
                fraction_value = max(0.0, min(1.0, fraction))
            progress_callback(message, fraction_value)
        except Exception as callback_error:  # pylint: disable=broad-except
            logger.debug(
                "TranscriptionModule",
                "process_audio_file",
                f"Progress callback failed ({callback_error})",
            )

    temp_audio_file = None
    temp_audio_cleanup = False
    chunk_infos: List[Dict[str, Any]] = []

    logger.info(
        "TranscriptionModule",
        "process_audio_file",
        f"Processing: {audio_file_path} with {provider}",
    )
    _report("Preparing audio for transcription…", 0.02)

    def _should_cancel() -> bool:
        return bool(cancel_callback and cancel_callback())

    try:
        if not os.path.exists(audio_file_path):
            _report("Audio file not found", 1.0)
            return {"error": "Audio file not found."}
    except Exception as e:
        logger.error("TranscriptionModule", "process_audio_file", f"File preparation error: {e}")
        _report("Error preparing audio file", 1.0)
        return {"error": f"Error preparing audio file: {e}"}

    try:
        # Check if it's an HTA/HDA file and convert it first
        ext = os.path.splitext(audio_file_path)[1].lower()
        temp_audio_file = None
        temp_audio_cleanup = False

        if ext in [".hta", ".hda"]:
            mp3_candidate = None
            try:
                hda_path = Path(audio_file_path)
                mp3_candidate = hda_path.parent.parent / "mp3" / (hda_path.stem + ".mp3")
            except Exception:  # pragma: no cover - path assumptions may fail
                mp3_candidate = None

            if mp3_candidate and mp3_candidate.exists():
                audio_file_path = str(mp3_candidate)
                ext = ".mp3"
                logger.info(
                    "TranscriptionModule",
                    "process_audio_file",
                    f"Using pre-converted MP3 asset: {audio_file_path}",
                )
            else:
                # Convert HTA/HDA to transcription-optimized format (MP3)
                from hta_converter import convert_hta_for_transcription, get_hta_converter

                converter = get_hta_converter()
                temp_audio_file = convert_hta_for_transcription(audio_file_path)
                if temp_audio_file:
                    audio_file_path = temp_audio_file
                    ext = os.path.splitext(temp_audio_file)[1].lower()
                    logger.info(
                        "TranscriptionModule",
                        "process_audio_file",
                        f"Converted HDA/HTA file to transcription format: {temp_audio_file}",
                    )

                    temp_path = Path(temp_audio_file)
                    try:
                        temp_path.relative_to(converter.cache_dir)
                        temp_audio_cleanup = False
                    except Exception:  # ValueError on non-relative
                        temp_audio_cleanup = True
                else:
                    _report("Failed to convert HiDock audio", 1.0)
                    return {"error": "Failed to convert HDA/HTA file to transcription format"}

    except Exception as e:
        logger.error("TranscriptionModule", "process_audio_file", f"File preparation error: {e}")
        _report("Error preparing audio file", 1.0)
        return {"error": f"Error preparing audio file: {e}"}

    chunk_infos: List[Dict[str, Any]] = []
    transcripts_meta: List[Dict[str, Any]] = []
    full_transcription = ""
    meeting_insights: Dict[str, Any] = {}

    try:
        max_upload_bytes = 25 * 1024 * 1024
        def chunk_progress(message: str, relative: Optional[float]) -> None:
            if relative is None:
                _report(message)
            else:
                _report(message, 0.12 + relative * 0.08)

        chunk_infos = _split_audio_into_chunks(
            audio_file_path,
            max_upload_bytes,
            overlap_ms=1500,
            progress_callback=chunk_progress,
            cancel_callback=_should_cancel,
        )
        if chunk_infos is None:
            if _should_cancel():
                _report("Transcription cancelled", 1.0)
                return {"error": "Transcription cancelled by user."}
            _report("Failed to prepare audio for transcription.", 1.0)
            return {"error": "Failed to prepare audio for transcription."}

        total_chunks = len(chunk_infos)
        if total_chunks > 1:
            _report(f"Splitting audio into {total_chunks} chunks…", 0.12)
        else:
            _report("Audio fits within upload limits.", 0.12)

        transcribe_start = 0.2
        transcribe_end = 0.8

        for idx, chunk in enumerate(chunk_infos):
            if _should_cancel():
                _report("Transcription cancelled", 1.0)
                return {"error": "Transcription cancelled by user."}

            progress = transcribe_start + (idx / total_chunks) * (transcribe_end - transcribe_start)
            message = (
                f"Transcribing chunk {idx + 1}/{total_chunks}…"
                if total_chunks > 1
                else "Transcribing audio…"
            )
            _report(message, progress)

            transcription_result = await transcribe_audio(chunk["path"], provider, api_key, config, language)

            if _should_cancel():
                _report("Transcription cancelled", 1.0)
                return {"error": "Transcription cancelled by user."}

            if not transcription_result.get("success"):
                error_msg = transcription_result.get("error", "Unknown transcription error.")
                logger.error(
                    "TranscriptionModule",
                    "process_audio_file",
                    f"Chunk {idx + 1} failed: {error_msg}",
                )
                _report(f"Chunk {idx + 1} failed: {error_msg}", 1.0)
                return {"error": error_msg}

            chunk_text = transcription_result.get("transcription", "")
            transcripts_meta.append(
                {
                    "text": chunk_text,
                    "start_ms": chunk.get("start_ms", idx * 1000),
                }
            )

            completed_fraction = transcribe_start + ((idx + 1) / total_chunks) * (transcribe_end - transcribe_start)
            _report(f"Chunk {idx + 1}/{total_chunks} complete", completed_fraction)

        if transcripts_meta:
            if total_chunks > 1:
                sections = []
                for idx, entry in enumerate(transcripts_meta):
                    timestamp = entry["start_ms"] / 1000.0
                    sections.append(f"[Segment {idx + 1} @ {timestamp:.1f}s]\n{entry['text']}".rstrip())
                full_transcription = "\n\n".join(sections)
            else:
                full_transcription = transcripts_meta[0]["text"]

        _report("Combining transcript…", 0.82)

        if not full_transcription:
            logger.warning(
                "TranscriptionModule",
                "process_audio_file",
                "Transcription produced no content.",
            )
            _report("Transcription produced no text", 1.0)
            return {"error": "Transcription produced no text."}

        if _should_cancel():
            _report("Transcription cancelled", 1.0)
            return {"error": "Transcription cancelled by user."}

        if not full_transcription.startswith("Transcription failed"):
            _report("Transcription complete. Extracting insights…", 0.85)
            meeting_insights = await extract_meeting_insights(full_transcription, provider, api_key, config)
        else:
            logger.warning(
                "TranscriptionModule",
                "process_audio_file",
                "Skipping insights due to transcription failure.",
            )
            _report("Transcription failed", 1.0)
            meeting_insights = {"summary": "N/A - Transcription failed"}
    except Exception as e:
        logger.error("TranscriptionModule", "process_audio_file", f"Error during processing: {e}")
        _report("Transcription error", 1.0)
        return {"error": f"Error preparing audio file: {e}"}
    finally:
        _cleanup_chunk_files(chunk_infos)

    # --- Step 3: Enrich with local data ---
    if meeting_insights.get("meeting_details", {}).get("duration_minutes") == 0:
        if ext in [".wav", ".mp3"]:  # Calculate duration for supported formats
            meeting_insights.setdefault("meeting_details", {})["duration_minutes"] = _get_audio_duration(
                audio_file_path
            )

    # Clean up temporary converted file if created
    if temp_audio_file and temp_audio_cleanup and os.path.exists(temp_audio_file):
        try:
            os.remove(temp_audio_file)
            logger.info(
                "TranscriptionModule",
                "process_audio_file",
                f"Cleaned up temporary file: {temp_audio_file}",
            )
        except Exception as e:
            logger.warning(
                "TranscriptionModule",
                "process_audio_file",
                f"Could not clean up temporary file: {e}",
            )

    _report("Finalizing transcription results", 0.95)

    result_payload = {
        "transcription": full_transcription,
        "insights": meeting_insights,
    }

    _report("Transcription finished", 1.0)
    return result_payload


async def main_test() -> None:
    """
    Example usage for testing the module from the command line.
    Requires a valid audio file path and a GEMINI_API_KEY environment variable.
    """
    logger.info("TranscriptionModuleTest", "main_test", "Starting module test.")
    # --- CONFIGURATION ---
    # IMPORTANT: Replace with your actual audio file path for testing.
    # The audio file must be in a compatible format (e.g., WAV, FLAC).
    test_audio_file = "path_to_your_test_audio.wav"
    api_key = os.environ.get("GEMINI_API_KEY", "")
    # ---------------------

    if not os.path.exists(test_audio_file):
        msg = f"Test audio file not found: {test_audio_file}. Please update the path."
        logger.error("TranscriptionModuleTest", "main_test", msg)
        print(msg)
        return

    if not api_key:
        msg = "GEMINI_API_KEY env var not set. Using mock API responses."
        logger.warning("TranscriptionModuleTest", "main_test", msg)
        print(msg)

    results = await process_audio_file_for_insights(test_audio_file, api_key)

    print("\n--- Transcription and Insights Results ---")
    print(json.dumps(results, indent=2))
    print("--- End of Test ---")


if __name__ == "__main__":
    # This allows the module to be tested directly.
    # To run:
    # 1. Set the `test_audio_file` variable in `main_test`.
    # 2. Set the `GEMINI_API_KEY` environment variable.
    # 3. Run `python -m asyncio hidock-desktop-app/transcription_module.py`
    import asyncio

    print("Running transcription module test...")
    asyncio.run(main_test())
