# -*- coding: utf-8 -*-
"""
Handles audio transcription and insight extraction using the Google Gemini API.

This module provides functionalities to:
- Transcribe audio files into text.
- Extract structured insights (summary, action items, etc.) from transcriptions.
- Process local audio files to produce a complete analysis.

It is designed to be used asynchronously and requires a Google Gemini API key
for its core operations. For development without a key, it returns mock responses.
"""

import base64
import json
import os
import wave
from typing import Any, Dict, Literal

try:
    import google.generativeai as genai
    TRANSCRIPTION_AVAILABLE = True
except ImportError:
    genai = None
    TRANSCRIPTION_AVAILABLE = False
from config_and_logger import logger

# --- Constants ---
TRANSCRIPTION_FAILED_DEFAULT_MSG = "Transcription failed or no content returned."
TRANSCRIPTION_PARSE_ERROR_MSG_PREFIX = "Error parsing transcription response:"


def _call_gemini_api(payload: Dict[str, Any], api_key: str = "") -> Dict[str, Any] | None:
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
                        "parts": [{"text": "This is a mock API response due to a missing API key."}]
                    ,
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

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(
            payload.get("contents"), generation_config=payload.get("generationConfig")
        )
        return response.to_dict()
    except Exception as e:
        logger.error("GeminiAPI", "_call_gemini_api", f"Exception during Gemini API call: {e}")
        return None


async def transcribe_audio(
    audio_data_base64: str, audio_mime_type: str, api_key: str = ""
) -> Dict[str, str]:
    """
    Transcribes audio data using the Gemini API with speaker diarization prompting.

    Args:
        audio_data_base64: Base64 encoded string of the audio data.
        audio_mime_type: The MIME type of the audio (e.g., "audio/wav").
        api_key: The Google Gemini API key.

    Returns:
        A dictionary containing the full transcription text.
        The key 'transcription' holds the result.
    """
    logger.info("TranscriptionModule", "transcribe_audio", f"Starting transcription for {audio_mime_type}")

    prompt = (
        "Please transcribe the following audio. If there are multiple speakers, "
        "try to identify and label them (e.g., Speaker A, Speaker B, Unknown Speaker). "
        "Provide the full transcription as a single block of text."
    )

    payload = {
        "contents": [
            {"parts": [{"text": prompt}, {"inlineData": {"mimeType": audio_mime_type, "data": audio_data_base64}}]}
        ],
        "generationConfig": {"temperature": 0.2},  # Lower temperature for factual transcription
    }

    api_response = _call_gemini_api(payload, api_key)

    transcription_text = TRANSCRIPTION_FAILED_DEFAULT_MSG
    if api_response and api_response.get("candidates"):
        try:
            # Extract text from the first candidate's content parts
            parsed_text = api_response["candidates"][0]["content"]["parts"][0].get("text")
            if parsed_text:
                transcription_text = parsed_text
                logger.info("TranscriptionModule", "transcribe_audio", "Transcription successful.")
        except (IndexError, KeyError, TypeError) as e:
            logger.error("TranscriptionModule", "transcribe_audio", f"Error parsing API response: {e}")
            transcription_text = f"{TRANSCRIPTION_PARSE_ERROR_MSG_PREFIX} {e}"

    # The raw text from Gemini may contain speaker labels like "Speaker A: ..."
    return {"transcription": transcription_text}


async def extract_meeting_insights(transcription: str, api_key: str = "") -> Dict[str, Any]:
    """
    Extracts structured insights from a transcription using Gemini's JSON mode.

    Args:
        transcription: The text transcription of the meeting.
        api_key: The Google Gemini API key.

    Returns:
        A dictionary containing the extracted insights, conforming to a default structure
        even in case of failure.
    """
    logger.info("TranscriptionModule", "extract_meeting_insights", "Starting insight extraction.")

    # Defines the expected JSON structure for the Gemini API response.
    json_schema = {
        "type": "OBJECT",
        "properties": {
            "summary": {"type": "STRING"},
            "category": {"type": "STRING"},
            "meeting_details": {
                "type": "OBJECT",
                "properties": {
                    "location": {"type": "STRING"},
                    "date": {"type": "STRING"},
                    "time": {"type": "STRING"},
                    "duration_minutes": {"type": "NUMBER"},
                },
            },
            "overall_sentiment_meeting": {"type": "STRING"},
            "action_items": {"type": "ARRAY", "items": {"type": "STRING"}},
            "project_context": {"type": "STRING"},
        },
    }

    prompt = (
        "Analyze the following meeting transcription. Based *only* on the provided text, "
        "extract the requested information. Format your response as a single JSON object. "
        "If information is not available, use 'N/A' for strings, [] for arrays, or 0 for numbers.\n\n"
        f"Transcription:\n{transcription}"
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": json_schema,
            "temperature": 0.3,
        },
    }

    # Default structure to ensure UI consistency
    insights = {
        "summary": "N/A", "category": "N/A",
        "meeting_details": {"location": "N/A", "date": "N/A", "time": "N/A", "duration_minutes": 0},
        "overall_sentiment_meeting": "N/A", "action_items": [], "project_context": "N/A",
    }

    api_response = _call_gemini_api(payload, api_key)
    if not (api_response and api_response.get("candidates")):
        logger.error("TranscriptionModule", "extract_meeting_insights", "Invalid or empty API response.")
        return insights

    try:
        json_string = api_response["candidates"][0]["content"]["parts"][0].get("text")
        if not json_string:
            logger.warning("TranscriptionModule", "extract_meeting_insights", "API returned empty content.")
            return insights

        parsed_json = json.loads(json_string)
        # Safely update the default insights dictionary with parsed data
        insights.update({k: v for k, v in parsed_json.items() if k in insights})
        if 'meeting_details' in parsed_json:
            insights['meeting_details'].update(parsed_json['meeting_details'])

        logger.info("TranscriptionModule", "extract_meeting_insights", "Insight extraction successful.")

    except (json.JSONDecodeError, IndexError, KeyError, TypeError) as e:
        logger.error("TranscriptionModule", "extract_meeting_insights", f"Failed to parse insights: {e}")

    return insights

def _get_audio_duration(audio_path: str) -> int:
    """Calculates the duration of a WAV audio file in minutes."""
    try:
        with wave.open(audio_path, "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            duration_seconds = frames / float(rate) if rate else 0
            return round(duration_seconds / 60)
    except Exception as e:
        logger.warning("TranscriptionModule", "_get_audio_duration", f"Could not get duration: {e}")
        return 0


async def process_audio_file_for_insights(
    audio_file_path: str, api_key: str = ""
) -> Dict[str, Any]:
    """
    Orchestrates the full audio processing pipeline: read, transcribe, and extract insights.

    IMPORTANT: This function assumes the input file is a standard audio format
    (e.g., WAV, FLAC). HTA files must be converted to WAV before being passed here.

    Args:
        audio_file_path: The absolute path to the audio file.
        api_key: The Google Gemini API key.

    Returns:
        A dictionary containing the transcription, insights, and any errors.
    """
    logger.info("TranscriptionModule", "process_audio_file", f"Processing: {audio_file_path}")

    if not os.path.exists(audio_file_path):
        logger.error("TranscriptionModule", "process_audio_file", f"File not found: {audio_file_path}")
        return {"error": "Audio file not found."}

    try:
        with open(audio_file_path, "rb") as f_audio:
            audio_data_base64 = base64.b64encode(f_audio.read()).decode("utf-8")

        # Basic MIME type detection. Can be expanded if more formats are supported.
        ext = os.path.splitext(audio_file_path)[1].lower()
        mime_map = {".wav": "audio/wav", ".flac": "audio/flac", ".mp3": "audio/mpeg"}
        audio_mime_type = mime_map.get(ext, "audio/wav") # Default to WAV

    except Exception as e:
        logger.error("TranscriptionModule", "process_audio_file", f"File read error: {e}")
        return {"error": f"Error reading audio file: {e}"}

    # --- Step 1: Transcribe Audio ---
    transcription_result = await transcribe_audio(audio_data_base64, audio_mime_type, api_key)
    full_transcription = transcription_result.get("transcription", "")

    # --- Step 2: Extract Insights ---
    if full_transcription and not full_transcription.startswith("Transcription failed"):
        meeting_insights = await extract_meeting_insights(full_transcription, api_key)
    else:
        logger.warning("TranscriptionModule", "process_audio_file", "Skipping insights due to transcription failure.")
        meeting_insights = {"summary": "N/A - Transcription failed"} # Provide failure context

    # --- Step 3: Enrich with local data ---
    if meeting_insights.get("meeting_details", {}).get("duration_minutes") == 0:
        if ext == ".wav": # Only calculate duration for WAV for now
            meeting_insights.setdefault("meeting_details", {})["duration_minutes"] = _get_audio_duration(audio_file_path)

    return {
        "transcription": full_transcription,
        "insights": meeting_insights,
    }


async def main_test():
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