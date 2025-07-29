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

import base64
import json
import os
import tempfile
import wave
from typing import Any, Dict, Literal, Optional

from ai_service import ai_service
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
    audio_file_path: str, provider: str = "gemini", api_key: str = "", 
    config: Dict[str, Any] = None, language: str = "auto"
) -> Dict[str, str]:
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
    logger.info("TranscriptionModule", "transcribe_audio", f"Starting transcription with {provider}")

    # Configure the AI service provider
    if not ai_service.configure_provider(provider, api_key, config):
        logger.error("TranscriptionModule", "transcribe_audio", f"Failed to configure provider: {provider}")
        return {"transcription": TRANSCRIPTION_FAILED_DEFAULT_MSG}

    # Perform transcription
    result = ai_service.transcribe_audio(provider, audio_file_path, language)
    
    if result.get("success"):
        transcription_text = result.get("transcription", TRANSCRIPTION_FAILED_DEFAULT_MSG)
        logger.info("TranscriptionModule", "transcribe_audio", f"Transcription successful with {provider}")
    else:
        transcription_text = f"Transcription failed: {result.get('error', 'Unknown error')}"
        logger.error("TranscriptionModule", "transcribe_audio", transcription_text)

    # The raw text from Gemini may contain speaker labels like "Speaker A: ..."
    return {"transcription": transcription_text}


async def extract_meeting_insights(
    transcription: str, provider: str = "gemini", api_key: str = "", 
    config: Dict[str, Any] = None
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
    logger.info("TranscriptionModule", "extract_meeting_insights", f"Starting insight extraction with {provider}")

    # Default structure to ensure UI consistency
    insights = {
        "summary": "N/A", 
        "category": "N/A",
        "meeting_details": {
            "location": "N/A", 
            "date": "N/A", 
            "time": "N/A", 
            "duration_minutes": 0
        },
        "overall_sentiment_meeting": "N/A", 
        "action_items": [], 
        "project_context": "N/A",
    }

    # Configure the AI service provider
    if not ai_service.configure_provider(provider, api_key, config):
        logger.error("TranscriptionModule", "extract_meeting_insights", f"Failed to configure provider: {provider}")
        return insights

    # Perform text analysis
    result = ai_service.analyze_text(provider, transcription, "meeting_insights")
    
    if result.get("success"):
        analysis = result.get("analysis", {})
        
        # Map the generic analysis format to our specific insights structure
        insights.update({
            "summary": analysis.get("summary", "N/A"),
            "category": "Meeting" if analysis.get("topics") else "N/A",
            "overall_sentiment_meeting": analysis.get("sentiment", "N/A"),
            "action_items": analysis.get("action_items", []),
            "project_context": ", ".join(analysis.get("topics", [])) if analysis.get("topics") else "N/A"
        })
        
        logger.info("TranscriptionModule", "extract_meeting_insights", f"Insight extraction successful with {provider}")
    else:
        logger.error("TranscriptionModule", "extract_meeting_insights", f"Analysis failed: {result.get('error', 'Unknown error')}")

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
    audio_file_path: str, provider: str = "gemini", api_key: str = "", 
    config: Dict[str, Any] = None, language: str = "auto"
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
    logger.info("TranscriptionModule", "process_audio_file", f"Processing: {audio_file_path} with {provider}")

    if not os.path.exists(audio_file_path):
        logger.error("TranscriptionModule", "process_audio_file", f"File not found: {audio_file_path}")
        return {"error": "Audio file not found."}

    try:
        # Check if it's an HTA file and convert it first
        ext = os.path.splitext(audio_file_path)[1].lower()
        original_file_path = audio_file_path
        temp_wav_file = None
        
        if ext == ".hta":
            # Convert HTA to WAV
            from hta_converter import convert_hta_to_wav
            temp_wav_file = convert_hta_to_wav(audio_file_path)
            if temp_wav_file:
                audio_file_path = temp_wav_file
                ext = ".wav"
                logger.info("TranscriptionModule", "process_audio_file", f"Converted HTA file to {temp_wav_file}")
            else:
                logger.error("TranscriptionModule", "process_audio_file", "Failed to convert HTA file")
                return {"error": "Failed to convert HTA file to WAV format"}

    except Exception as e:
        logger.error("TranscriptionModule", "process_audio_file", f"File preparation error: {e}")
        return {"error": f"Error preparing audio file: {e}"}

    # --- Step 1: Transcribe Audio ---
    transcription_result = await transcribe_audio(audio_file_path, provider, api_key, config, language)
    full_transcription = transcription_result.get("transcription", "")

    # --- Step 2: Extract Insights ---
    if full_transcription and not full_transcription.startswith("Transcription failed"):
        meeting_insights = await extract_meeting_insights(full_transcription, provider, api_key, config)
    else:
        logger.warning("TranscriptionModule", "process_audio_file", "Skipping insights due to transcription failure.")
        meeting_insights = {"summary": "N/A - Transcription failed"} # Provide failure context

    # --- Step 3: Enrich with local data ---
    if meeting_insights.get("meeting_details", {}).get("duration_minutes") == 0:
        if ext == ".wav": # Only calculate duration for WAV for now
            meeting_insights.setdefault("meeting_details", {})["duration_minutes"] = _get_audio_duration(audio_file_path)

    # Clean up temporary WAV file if created
    if temp_wav_file and os.path.exists(temp_wav_file):
        try:
            os.remove(temp_wav_file)
            logger.info("TranscriptionModule", "process_audio_file", f"Cleaned up temporary file: {temp_wav_file}")
        except Exception as e:
            logger.warning("TranscriptionModule", "process_audio_file", f"Could not clean up temporary file: {e}")

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