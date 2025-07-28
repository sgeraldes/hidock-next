# transcription_module.py

import base64
import json
import os
import google.generativeai as genai

from config_and_logger import logger

# --- Constants (Specific to this module, if any) ---
# API_KEY = "YOUR_GEMINI_API_KEY" # API Key should be passed or configured securely
GEMINI_API_URL_TEXT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
# The URL for multimodal input might be the same or vary based on specific model versions.
# For gemini-2.0-flash, generateContent handles multimodal.

# --- Constants for error messages ---
TRANSCRIPTION_FAILED_DEFAULT_MSG = "Transcription failed or no content returned."
TRANSCRIPTION_PARSE_ERROR_MSG_PREFIX = "Error parsing transcription response:"

# --- Helper Functions ---


def _call_gemini_api(payload, api_key=""):
    """
    Helper function to make a call to the Gemini API.
    """
    if not api_key:
        logger.warning("GeminiAPI", "_call_gemini_api", "API key is empty. Using mock response.")
        # Mock response structure based on Gemini API
        mock_response = {
            "candidates": [{
                "content": {
                    "parts": [{"text": "This is a mock API response due to missing API key."}],
                    "role": "model"
                },
                "finishReason": "STOP",
                "index": 0,
                "safetyRatings": [{"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "probability": "NEGLIGIBLE"}]
            }],
        }
        if "generationConfig" in payload and payload["generationConfig"].get("responseMimeType") == "application/json":
            mock_json_output = {
                "summary": "Mock summary from API (missing key).",
                "category": "Mock Category",
                "meeting_details": {
                    "location": "Mock Location", "date": "2025-06-02", "time": "09:00 AM", "duration_minutes": 60
                },
                "overall_sentiment_meeting": "Neutral",
                "action_items": ["Mock action item 1", "Mock action item 2"],
                "project_context": "Mock project context."
            }
            mock_response["candidates"][0]["content"]["parts"][0]["text"] = json.dumps(mock_json_output)
        return mock_response

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-1.5-flash')

        # Extract contents and generationConfig from payload
        contents = payload.get("contents")
        generation_config = payload.get("generationConfig")

        if not contents:
            logger.error("GeminiAPI", "_call_gemini_api", "Payload missing 'contents'.")
            return None

        response = model.generate_content(
            contents,
            generation_config=generation_config
        )
        return response.to_dict()
    except genai.APIError as e:
        logger.error("GeminiAPI", "_call_gemini_api", f"Gemini API error: {e}")
        return None
    except Exception as e:
        logger.error("GeminiAPI", "_call_gemini_api", f"Exception during Gemini API call: {e}")
        return None
    


async def transcribe_audio(audio_data_base64: str, audio_mime_type: str, api_key: str = "") -> dict:
    """
    Transcribes the given audio data using Gemini.
    Attempts basic speaker diarization if possible through prompting.

    Args:
        audio_data_base64: Base64 encoded string of the audio data.
        audio_mime_type: The MIME type of the audio (e.g., "audio/wav", "audio/flac").
        api_key: The Gemini API key.

    Returns:
        A dictionary containing:
            "transcription": The full transcribed text.
            "diarization_text": Text potentially including speaker labels (e.g., "Speaker A: ...").
                                This is a raw output and may need further parsing.
    """
    logger.info("TranscriptionModule", "transcribe_audio", f"Starting transcription for audio type: {audio_mime_type}")

    # TODO: Implement actual HTA to WAV/FLAC conversion if audio_file_path is HTA.
    # For now, this function assumes audio_data_base64 is already in a compatible format.
    # If audio_file_path was given and was HTA, it should be converted before this step.

    prompt = (
        "Please transcribe the following audio. "
        "If there are multiple speakers, try to identify and label them (e.g., Speaker A, Speaker B, Unknown Speaker). "
        "Provide the full transcription."
    )

    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {
                    "inlineData": {
                        "mimeType": audio_mime_type,
                        "data": audio_data_base64
                    }
                }
            ]
        }],
        "generationConfig": {
            "temperature": 0.2,  # Lower temperature for more factual transcription
            # "candidateCount": 1 # Default is 1
        }
        # Safety settings can be added if needed
    }

    api_response = _call_gemini_api(payload, api_key)

    # Initialize with default failure messages
    transcription_text = TRANSCRIPTION_FAILED_DEFAULT_MSG

    if api_response and api_response.get("candidates"):
        try:
            first_candidate = api_response["candidates"][0]
            # Ensure content and parts exist and are not empty
            if (first_candidate.get("content") and
                first_candidate["content"].get("parts") and
                    len(first_candidate["content"]["parts"]) > 0):

                parsed_text = first_candidate["content"]["parts"][0].get("text")
                if parsed_text:  # Check if text is not None or empty
                    transcription_text = parsed_text
                    logger.info("TranscriptionModule", "transcribe_audio", "Transcription successful.")
                # If parsed_text is None or empty, transcription_text remains TRANSCRIPTION_FAILED_DEFAULT_MSG.
            # If content or parts are missing, transcription_text remains TRANSCRIPTION_FAILED_DEFAULT_MSG.
        except (IndexError, KeyError, TypeError) as e:
            logger.error("TranscriptionModule", "transcribe_audio",
                         f"Error parsing API response: {e}. Response: {api_response}")
            transcription_text = f"{TRANSCRIPTION_PARSE_ERROR_MSG_PREFIX} {e}"
    else:
        logger.error("TranscriptionModule", "transcribe_audio", f"Invalid or empty API response: {api_response}")
        # transcription_text already holds TRANSCRIPTION_FAILED_DEFAULT_MSG

    # Diarization text is the same as transcription text based on the current prompting strategy
    # The prompt asks Gemini to include speaker labels in the text itself.
    diarization_text_raw = transcription_text

    return {
        "transcription": transcription_text,
        "diarization_text_raw": diarization_text_raw  # This text might contain "Speaker A: ..."
    }


async def extract_meeting_insights(transcription: str, api_key: str = "") -> dict:
    """
    Extracts detailed insights from a meeting transcription using Gemini
    and a structured JSON output.

    Args:
        transcription: The text transcription of the meeting.
        api_key: The Gemini API key.

    Returns:
        A dictionary containing the extracted insights.
    """
    logger.info("TranscriptionModule", "extract_meeting_insights", "Starting insight extraction from transcription.")

    json_schema = {
        "type": "OBJECT",
        "properties": {
            "summary": {"type": "STRING", "description": "A concise summary of the meeting."},
            "category": {"type": "STRING", "description": "A category for the meeting (e.g., Team Sync, Client Call, Brainstorming, Personal Note)."},
            "meeting_details": {
                "type": "OBJECT",
                "description": "Details about the meeting event.",
                "properties": {
                    "location": {"type": "STRING", "description": "Location of the meeting, if mentioned (e.g., 'Conference Room B', 'Zoom Call', 'N/A')."},
                    "date": {"type": "STRING", "description": "Date of the meeting in YYYY-MM-DD format, if mentioned or inferable (e.g., '2025-06-02', 'N/A')."},
                    "time": {"type": "STRING", "description": "Start time of the meeting, if mentioned (e.g., '10:00 AM', 'N/A')."},
                    "duration_minutes": {"type": "NUMBER", "description": "Duration of the meeting in minutes, if mentioned or inferable (e.g., 60, 0 if N/A)."}
                }
            },
            "overall_sentiment_meeting": {
                "type": "STRING",
                "description": "Overall sentiment of the meeting discussion (e.g., Positive, Neutral, Negative, Mixed)."
            },
            "action_items": {
                "type": "ARRAY",
                "description": "A list of action items or tasks identified during the meeting.",
                "items": {"type": "STRING"}
            },
            "project_context": {
                "type": "STRING",
                "description": "Name of the project or primary topic the meeting is about, if discernible (e.g., 'Project Alpha Q3 Planning', 'Website Redesign Feedback', 'N/A')."
            }
        },
        "required": ["summary", "category", "meeting_details", "overall_sentiment_meeting", "action_items", "project_context"]
    }

    prompt = (
        "Analyze the following meeting transcription. Based *only* on the provided text, extract the requested information. "
        "Format your entire response as a single JSON object matching the provided schema. "
        "If a specific piece of information is not mentioned or cannot be reliably inferred from the text, use 'N/A' for string fields, an empty array [] for action_items if none, or 0 for numerical fields like duration_minutes if not found.\n\n"
        "Transcription:\n"
        f"{transcription}"
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": json_schema,
            "temperature": 0.3,  # Slightly higher for more nuanced interpretation but still factual
        }
    }

    api_response = _call_gemini_api(payload, api_key)

    insights = {  # Default structure
        "summary": "N/A", "category": "N/A",
        "meeting_details": {"location": "N/A", "date": "N/A", "time": "N/A", "duration_minutes": 0},
        "overall_sentiment_meeting": "N/A", "action_items": [], "project_context": "N/A"
    }

    if api_response and api_response.get("candidates"):
        try:
            first_candidate = api_response["candidates"][0]
            if first_candidate.get("content") and first_candidate["content"].get("parts"):
                json_string = first_candidate["content"]["parts"][0].get("text")
                if json_string:
                    logger.debug("TranscriptionModule", "extract_meeting_insights", f"Raw JSON string from Gemini: {json_string[:500]}...")
                    parsed_json = json.loads(json_string)
                    # Validate and fill insights, ensuring all keys from schema are present
                    insights["summary"] = parsed_json.get("summary", "N/A")
                    insights["category"] = parsed_json.get("category", "N/A")

                    md = parsed_json.get("meeting_details", {})
                    insights["meeting_details"]["location"] = md.get("location", "N/A")
                    insights["meeting_details"]["date"] = md.get("date", "N/A")
                    insights["meeting_details"]["time"] = md.get("time", "N/A")
                    insights["meeting_details"]["duration_minutes"] = md.get("duration_minutes", 0)

                    insights["overall_sentiment_meeting"] = parsed_json.get("overall_sentiment_meeting", "N/A")
                    insights["action_items"] = parsed_json.get("action_items", [])
                    insights["project_context"] = parsed_json.get("project_context", "N/A")

                    logger.info("TranscriptionModule", "extract_meeting_insights", "Insight extraction successful.")
                else:
                    logger.warning("TranscriptionModule", "extract_meeting_insights", "API returned empty JSON string.")
            else:
                logger.warning("TranscriptionModule", "extract_meeting_insights", "No content parts in API response.")
        except json.JSONDecodeError as e:
            logger.error("TranscriptionModule", "extract_meeting_insights",
                         f"Error decoding JSON response: {e}. Response text: {json_string[:500]}")
        except (IndexError, KeyError, TypeError) as e:
            logger.error("TranscriptionModule", "extract_meeting_insights",
                         f"Error parsing API response structure: {e}. Response: {api_response}")
    else:
        logger.error("TranscriptionModule", "extract_meeting_insights",
                     f"Invalid or empty API response for insights: {api_response}")

    return insights


async def process_audio_file_for_insights(audio_file_path: str, api_key: str = "") -> dict:
    """
    Processes an audio file: transcribes it and then extracts detailed insights.

    Args:
        audio_file_path: Path to the audio file (assumed to be in a compatible format like WAV, FLAC).
                         IMPORTANT: HTA files must be converted to a compatible format BEFORE calling this function.
        api_key: The Gemini API key.

    Returns:
        A dictionary containing transcription and extracted insights.
    """
    logger.info("TranscriptionModule", "process_audio_file_for_insights", f"Processing audio file: {audio_file_path}")

    # --- Step 1: Read and Encode Audio File ---
    # This step assumes the audio_file_path points to a file in a format
    # that Gemini can understand (e.g., WAV, FLAC, MP3).
    # HTA conversion is a prerequisite and not handled here.
    try:
        with open(audio_file_path, "rb") as f_audio:
            audio_bytes = f_audio.read()
        audio_data_base64 = base64.b64encode(audio_bytes).decode('utf-8')

        # Determine MIME type based on file extension (basic)
        # This should be robust or provided if known.
        file_ext = os.path.splitext(audio_file_path)[1].lower()
        if file_ext == ".wav":
            audio_mime_type = "audio/wav"
        elif file_ext == ".flac":
            audio_mime_type = "audio/flac"
        elif file_ext == ".mp3":
            audio_mime_type = "audio/mpeg"  # Common for mp3
        elif file_ext == ".ogg":  # Opus in Ogg
            audio_mime_type = "audio/ogg; codecs=opus"
        else:
            # Fallback or raise error if type is unknown/unsupported by Gemini
            logger.warning("TranscriptionModule", "process_audio_file_for_insights",
                           f"Unknown audio file extension '{file_ext}'. Assuming 'audio/wav'. Gemini might reject this.")
            audio_mime_type = "audio/wav"  # Defaulting, but this might be problematic

    except FileNotFoundError:
        logger.error("TranscriptionModule", "process_audio_file_for_insights",
                     f"Audio file not found: {audio_file_path}")
        return {"error": "Audio file not found."}
    except Exception as e:
        logger.error("TranscriptionModule", "process_audio_file_for_insights",
                     f"Error reading/encoding audio file {audio_file_path}: {e}")
        return {"error": f"Error processing audio file: {e}"}

    # --- Step 2: Transcribe Audio ---
    transcription_results = await transcribe_audio(audio_data_base64, audio_mime_type, api_key)
    if "error" in transcription_results:  # Check if transcription itself failed
        return {
            "error": f"Transcription phase failed: {transcription_results['error']}",
            **transcription_results  # Include any partial results or error details
        }

    full_transcription = transcription_results.get("transcription", "N/A")
    diarization_text_raw = transcription_results.get("diarization_text_raw", full_transcription)

    # --- Step 3: Extract Insights from Transcription ---
    if (full_transcription == "N/A" or  # Could happen if transcription_results.get("transcription", "N/A") defaults
            full_transcription == TRANSCRIPTION_FAILED_DEFAULT_MSG or
            full_transcription.startswith(TRANSCRIPTION_PARSE_ERROR_MSG_PREFIX)):
        logger.warning("TranscriptionModule", "process_audio_file_for_insights",
                       f"Skipping insight extraction due to transcription issue: {full_transcription[:100]}")
        meeting_insights = {  # Default structure if insights cannot be extracted
            "summary": "N/A - Transcription failed", "category": "N/A",
            "meeting_details": {"location": "N/A", "date": "N/A", "time": "N/A", "duration_minutes": 0},
            "overall_sentiment_meeting": "N/A", "action_items": [], "project_context": "N/A"
        }
    else:
        meeting_insights = await extract_meeting_insights(full_transcription, api_key)

    # --- Step 4: Combine and Return Results ---
    # Basic diarization parsing from diarization_text_raw (simple split by "Speaker X:")
    # This is a very naive approach and might need significant improvement.
    diarized_segments = []
    # A more robust regex might be: r"(Speaker [A-Z0-9]+|Unknown Speaker):\s*"
    # For now, just using a simple split for demonstration if labels are present.
    # This part is highly dependent on how Gemini formats the output with speaker labels.
    if "Speaker A:" in diarization_text_raw or "Speaker B:" in diarization_text_raw:  # Basic check
        # This is a placeholder for actual diarization parsing.
        # True diarization would involve timestamps and more structured output.
        # For now, we'll just indicate that the raw text might contain labels.
        diarized_segments.append({
            "speaker_label": "Info",
            "text": "Diarization labels might be present in the 'diarization_text_raw'. Further parsing needed.",
            "start_time": "N/A", "end_time": "N/A"
        })

    # Attempt to get duration from the audio file itself if not found by Gemini
    # This requires a library that can read audio metadata (e.g., wave, soundfile, pydub)
    # For now, this is a placeholder.
    if meeting_insights["meeting_details"]["duration_minutes"] == 0:
        try:
            # Example using 'wave' module for WAV files
            if audio_mime_type == "audio/wav":
                import wave
                with wave.open(audio_file_path, 'rb') as wf:
                    frames = wf.getnframes()
                    rate = wf.getframerate()
                    duration_seconds = frames / float(rate)
                    meeting_insights["meeting_details"]["duration_minutes"] = round(duration_seconds / 60)
                    logger.info("TranscriptionModule", "process_audio_file_for_insights",
                                f"Calculated audio duration: {duration_seconds:.2f}s")
            # Add support for other formats if needed (e.g. mutagen for mp3/flac metadata)
        except Exception as e:
            logger.warning("TranscriptionModule", "process_audio_file_for_insights",
                           f"Could not determine audio duration from file: {e}")

    return {
        "transcription": full_transcription,
        "diarization_text_raw": diarization_text_raw,  # Raw text which might contain speaker labels
        "diarized_segments_info": "Placeholder for future structured diarization. Check 'diarization_text_raw'.",
        "insights": meeting_insights
    }


# --- Example Usage (for testing this module independently) ---
async def main_test():
    """
    An example of how to use the process_audio_file_for_insights function.
    This requires a valid audio file path and API key.
    """
    logger.info("TranscriptionModuleTest", "main_test", "Starting transcription module test.")

    # IMPORTANT: Replace with your actual audio file path and API key for testing.
    # The audio file should be in a format like WAV or FLAC.
    # If your original files are HTA, they need to be converted first.
    test_audio_file = "path_to_your_test_audio.wav"  # e.g., "test_meeting.wav"
    test_api_key = os.environ.get("GEMINI_API_KEY", "")  # Or hardcode for local testing only

    if not os.path.exists(test_audio_file):
        logger.error("TranscriptionModuleTest", "main_test",
                     f"Test audio file not found: {test_audio_file}. Skipping test.")
        print(f"Test audio file not found: {test_audio_file}. Please update path for testing.")
        return

    if not test_api_key:
        logger.warning("TranscriptionModuleTest", "main_test",
                       "GEMINI_API_KEY environment variable not set. API calls will use mock responses.")
        print("GEMINI_API_KEY not set. Using mock API responses.")
        # test_api_key = "YOUR_API_KEY_HERE_FOR_TESTING" # Or set it here

    results = process_audio_file_for_insights(test_audio_file, test_api_key)

    print("\n--- Transcription and Insights Results ---")
    print(json.dumps(results, indent=2))

    if "error" in results:
        logger.error("TranscriptionModuleTest", "main_test", f"Processing failed: {results['error']}")
    else:
        logger.info("TranscriptionModuleTest", "main_test", "Processing completed.")

if __name__ == '__main__':
    # To run this test, you'd typically use asyncio.run()
    # import asyncio
    # asyncio.run(main_test())
    print("Transcription module loaded. To test, uncomment and run the asyncio main_test() call.")
    print("Ensure you have a compatible audio file and set your GEMINI_API_KEY environment variable or in the script.")
