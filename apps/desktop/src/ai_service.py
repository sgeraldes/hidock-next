# -*- coding: utf-8 -*-
"""
Unified AI Service Module for HiDock Desktop Application

This module provides a unified interface for multiple AI providers:
- Google Gemini
- OpenAI GPT
- Anthropic Claude
- OpenRouter (multiple providers)
- Amazon Bedrock
- Qwen (Alibaba)
- DeepSeek

Each provider supports audio transcription and text analysis capabilities.
"""

import json
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from config_and_logger import logger
from gemini_models import is_valid_model_name, normalize_model_name, validate_model_for_transcription

# Provider-specific imports with fallbacks
try:
    import google.generativeai as genai

    GEMINI_AVAILABLE = True
except ImportError:
    genai = None
    GEMINI_AVAILABLE = False

try:
    import openai

    OPENAI_AVAILABLE = True
except ImportError:
    openai = None
    OPENAI_AVAILABLE = False

try:
    import anthropic

    ANTHROPIC_AVAILABLE = True
except ImportError:
    anthropic = None
    ANTHROPIC_AVAILABLE = False

# Amazon Bedrock support placeholder
AMAZON_AVAILABLE = False

try:
    import requests

    REQUESTS_AVAILABLE = True
except ImportError:
    requests = None
    REQUESTS_AVAILABLE = False


class AIProvider(ABC):
    """Abstract base class for AI providers"""

    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        self.api_key = api_key
        self.config = config or {}

    @abstractmethod
    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio file to text"""
        raise NotImplementedError

    @abstractmethod
    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text and extract insights"""
        raise NotImplementedError

    @abstractmethod
    def is_available(self) -> bool:
        """Check if the provider is available"""
        raise NotImplementedError

    @abstractmethod
    def validate_api_key(self) -> bool:
        """Validate the API key by making a test request"""
        raise NotImplementedError


class GeminiProvider(AIProvider):
    """Google Gemini AI provider"""

    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        super().__init__(api_key, config)
        if GEMINI_AVAILABLE and api_key and genai is not None:
            genai.configure(api_key=api_key)

    def is_available(self) -> bool:
        return GEMINI_AVAILABLE and bool(self.api_key)

    def validate_api_key(self) -> bool:
        """Validate Gemini API key by making a test request"""
        if not self.is_available():
            return False

        try:
            # Use configured model or default to gemini-2.0-flash-exp
            model_name = self.config.get("model", "gemini-2.0-flash-exp")

            # Normalize legacy model names
            model_name = normalize_model_name(model_name)

            # Validate model name
            if not is_valid_model_name(model_name):
                logger.warning("GeminiProvider", "validate_api_key", f"Unknown model name: {model_name}, using default")
                model_name = "gemini-2.0-flash-exp"

            logger.info("GeminiProvider", "validate_api_key", f"Validating API key with model: {model_name}")

            model = genai.GenerativeModel(model_name)
            response = model.generate_content("Test validation message")
            return bool(response and response.text)
        except Exception as e:
            logger.error("GeminiProvider", "validate_api_key", f"API validation failed: {e}")
            return False

    def transcribe_and_analyze_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe and analyze audio in a single API call (more efficient)"""
        if not self.is_available():
            return self._mock_response("combined")

        try:
            # Get and validate model
            model_name = self.config.get("model", "gemini-2.0-flash-exp")
            model_name = normalize_model_name(model_name)

            # Check if model supports audio transcription
            is_valid, msg = validate_model_for_transcription(model_name)
            if not is_valid:
                logger.error("GeminiProvider", "transcribe_and_analyze", msg)
                return {"success": False, "error": msg, "provider": "gemini"}

            logger.info("GeminiProvider", "transcribe_and_analyze", f"Using model: {model_name}")

            # Upload audio file to Gemini
            logger.info("GeminiProvider", "transcribe_and_analyze", f"Uploading audio file: {audio_file_path}")

            audio_file = genai.upload_file(audio_file_path)

            logger.info("GeminiProvider", "transcribe_and_analyze", f"File uploaded successfully: {audio_file.uri}")

            # Create model
            model = genai.GenerativeModel(model_name)

            # Combined prompt for transcription + analysis
            prompt = """
Transcribe this audio recording AND analyze it for meeting insights. Return your response in two sections:

# TRANSCRIPTION SECTION
Follow these guidelines:
1. **Speaker Identification - CRITICAL**:
   - LISTEN CAREFULLY for names mentioned in the conversation (e.g., when someone says "Hi, this is John" or "Thanks Maria" or people address each other by name)
   - If you detect actual names, USE THEM as speaker labels (e.g., "John:", "Maria:", "Sebastián:", "Ceci:")
   - Only use "Speaker 1:", "Speaker 2:" if NO names are mentioned in the entire recording
   - Keep speaker labels consistent throughout the entire transcription
   - If you learn a speaker's name later in the conversation, go back mentally and use that name for all their dialogue

2. **Multiple Conversation Detection - CRITICAL**:
   - Detect if this recording contains MULTIPLE SEPARATE CONVERSATIONS (e.g., different meetings merged into one file)
   - Signs of conversation boundaries: long silences (>10s), topic shifts, participant changes, greetings/farewells
   - If you detect multiple conversations, add a clear separator: "\n\n--- NEW CONVERSATION DETECTED [timestamp] ---\n\n"
   - Reset participant introductions for each new conversation

3. **Timestamps**: Include timestamps every 30 seconds in [MM:SS] format

4. **Clarity**: Use proper punctuation and paragraph breaks

5. **Filler Words**: Omit excessive filler words (um, uh, like) unless significant

6. **Formatting**:
   - Start each speaker's turn on a new line
   - Use proper capitalization and punctuation
   - Mark [inaudible] or [unclear] for uncertain parts

Format:
[00:00] Sebastián: [transcription if name detected]
[00:30] Ceci: [transcription if name detected]
OR
[00:00] Speaker 1: [transcription if no names detected]
[00:30] Speaker 2: [transcription if no names detected]

# ANALYSIS SECTION
Provide structured meeting insights in strict JSON format:
{
    "summary": "DETAILED multi-paragraph summary (at least 5-10 sentences) covering: main purpose, key discussions, decisions made, outcomes, and next steps. Be comprehensive and specific.",
    "key_points": ["Specific decision or discussion point with full context and details", "Include who said what and why it matters", "Be thorough - include at least 5-10 key points for substantial conversations", ...],
    "action_items": ["Task: detailed description with context (assigned to: [actual name] or Speaker X)", ...],
    "topics": ["topic1", "topic2", "topic3", "topic4", "topic5"],
    "sentiment": "professional/positive/concerned/negative/neutral",
    "participants": ["Sebastián", "Ceci", ...] (use actual names if detected, otherwise ["Speaker 1", "Speaker 2", ...]),
    "conversation_segments": [
        {
            "segment_number": 1,
            "start_time": "00:00",
            "end_time": "45:30",
            "participants": ["Sebastián", "Carolina"],
            "topic": "Nova Sonic bot demo and discussion",
            "summary": "Brief summary of this conversation segment"
        },
        {
            "segment_number": 2,
            "start_time": "45:30",
            "end_time": "66:00",
            "participants": ["Ceci", "Jahaira"],
            "topic": "Technical interview",
            "summary": "Brief summary of this conversation segment"
        }
    ]
}

**CRITICAL REQUIREMENTS**:
1. USE ACTUAL SPEAKER NAMES whenever they are mentioned in the audio - this is MANDATORY
2. DETECT and MARK multiple conversations if present in the recording
3. Make summary MUCH MORE DETAILED (5-10+ sentences minimum, not just 2-3 sentences)
4. Include conversation_segments array to show conversation boundaries
5. Use the SAME speaker labels (actual names or Speaker X) in both transcription and analysis
6. Return transcription as plain text, then JSON analysis
7. No markdown code blocks around the JSON
            """

            # Generate content with the uploaded audio file
            response = model.generate_content([prompt, audio_file])

            # Get response text
            response_text = response.text.strip()

            # Clean up: delete the uploaded file
            genai.delete_file(audio_file.name)
            logger.info("GeminiProvider", "transcribe_and_analyze", "Uploaded file deleted")

            # Parse response: split into transcription and analysis
            # Look for JSON in the response
            json_start = response_text.find("{")
            json_end = response_text.rfind("}") + 1

            if json_start == -1 or json_end == 0:
                logger.error("GeminiProvider", "transcribe_and_analyze", "Could not find JSON analysis in response")
                return {"success": False, "error": "No JSON analysis found in response", "provider": "gemini"}

            transcription_text = response_text[:json_start].strip()
            analysis_json = response_text[json_start:json_end].strip()

            # Parse analysis JSON
            try:
                analysis = json.loads(analysis_json)
            except json.JSONDecodeError as e:
                logger.error("GeminiProvider", "transcribe_and_analyze", f"JSON parse error: {e}")
                # Return transcription only if analysis parsing fails
                return {
                    "success": True,
                    "transcription": transcription_text,
                    "language": language,
                    "confidence": 0.9,
                    "provider": "gemini",
                    "analysis": None,
                }

            return {
                "success": True,
                "transcription": transcription_text,
                "language": language,
                "confidence": 0.9,
                "provider": "gemini",
                "analysis": {
                    "summary": analysis.get("summary", ""),
                    "key_points": analysis.get("key_points", []),
                    "action_items": analysis.get("action_items", []),
                    "topics": analysis.get("topics", []),
                    "sentiment": analysis.get("sentiment", "neutral"),
                    "participants": analysis.get("participants", []),
                },
            }

        except Exception as e:
            logger.error("GeminiProvider", "transcribe_and_analyze", f"Error: {e}")
            return {"success": False, "error": str(e), "provider": "gemini"}

    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio using Gemini"""
        if not self.is_available():
            return self._mock_response("transcription")

        try:
            # Get and validate model
            model_name = self.config.get("model", "gemini-2.0-flash-exp")
            model_name = normalize_model_name(model_name)

            # Check if model supports audio transcription
            is_valid, msg = validate_model_for_transcription(model_name)
            if not is_valid:
                logger.error("GeminiProvider", "transcribe_audio", msg)
                return {"success": False, "error": msg, "provider": "gemini"}

            logger.info("GeminiProvider", "transcribe_audio", f"Using model: {model_name}")

            # Upload audio file to Gemini
            logger.info("GeminiProvider", "transcribe_audio", f"Uploading audio file: {audio_file_path}")

            audio_file = genai.upload_file(audio_file_path)

            logger.info("GeminiProvider", "transcribe_audio", f"File uploaded successfully: {audio_file.uri}")

            # Create model
            model = genai.GenerativeModel(model_name)

            # Create prompt with uploaded file reference
            prompt = """
Transcribe this audio recording with high accuracy. Follow these guidelines:

1. **Speaker Identification**: If multiple speakers are detected, label them as "Speaker 1:", "Speaker 2:", etc.
2. **Timestamps**: Include timestamps every 30 seconds in [MM:SS] format
3. **Clarity**: Use proper punctuation and paragraph breaks for readability
4. **Filler Words**: Omit excessive filler words (um, uh, like) unless they're significant to meaning
5. **Formatting**:
   - Start each speaker's turn on a new line
   - Use proper capitalization and punctuation
   - Indicate [inaudible] or [unclear] for parts you cannot transcribe confidently

Return ONLY the transcribed text in this format:
[00:00] Speaker 1: [transcription]
[00:30] Speaker 2: [transcription]

Do NOT include any JSON formatting or explanatory text.
            """

            # Generate content with the uploaded audio file
            response = model.generate_content([prompt, audio_file])

            # Get transcription text
            transcription_text = response.text.strip()

            # Clean up: delete the uploaded file
            genai.delete_file(audio_file.name)
            logger.info("GeminiProvider", "transcribe_audio", "Uploaded file deleted")

            return {
                "success": True,
                "transcription": transcription_text,
                "language": language,
                "confidence": 0.9,
                "provider": "gemini",
            }

        except Exception as e:
            logger.error("GeminiProvider", "transcribe_audio", f"Error: {e}")
            return {"success": False, "error": str(e), "provider": "gemini"}

    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using Gemini"""
        if not self.is_available():
            return self._mock_response("analysis")

        try:
            # Get and normalize model
            model_name = self.config.get("model", "gemini-2.0-flash-exp")
            model_name = normalize_model_name(model_name)

            logger.info("GeminiProvider", "analyze_text", f"Using model: {model_name}")

            # Create model
            model = genai.GenerativeModel(model_name)

            prompt = f"""
Analyze this meeting transcription and extract actionable insights.

**Instructions:**
1. **Summary**: Write a 2-3 sentence executive summary highlighting the meeting's purpose and outcome
2. **Key Points**: Extract 3-5 most important discussion points or decisions made
3. **Action Items**: List specific tasks, assignments, or follow-ups mentioned (include who if specified)
4. **Topics**: Identify main discussion topics or themes (3-5 keywords)
5. **Sentiment**: Overall tone (professional/positive/concerned/negative/neutral)

**Output Format (strict JSON):**
{{
    "summary": "2-3 sentence executive summary",
    "key_points": ["Specific point with context", "Another key point", ...],
    "action_items": ["Task: description (assigned to: person if known)", ...],
    "topics": ["topic1", "topic2", "topic3"],
    "sentiment": "one word: professional/positive/concerned/negative/neutral"
}}

**Text to analyze:**
{text}

Return ONLY valid JSON, no markdown formatting or explanatory text.
            """

            response = model.generate_content(prompt)
            response_text = response.text.strip()

            if response_text.startswith("```json"):
                response_text = response_text[7:-3].strip()

            result = json.loads(response_text)
            return {"success": True, "analysis": result, "provider": "gemini"}

        except Exception as e:
            logger.error("GeminiProvider", "analyze_text", f"Error: {e}")
            return {"success": False, "error": str(e), "provider": "gemini"}

    def _mock_response(self, response_type: str) -> Dict[str, Any]:
        """Return mock response for testing"""
        if response_type == "transcription":
            return {
                "success": True,
                "transcription": "[Mock] This is a sample transcription for testing purposes.",
                "language": "en",
                "confidence": 0.95,
                "provider": "gemini",
            }
        elif response_type == "combined":
            return {
                "success": True,
                "transcription": "[00:00] Speaker 1: This is a mock transcription.\n[00:30] Speaker 2: This demonstrates the combined approach.",
                "language": "en",
                "confidence": 0.95,
                "provider": "gemini",
                "analysis": {
                    "summary": "[Mock] Sample meeting discussion between two speakers.",
                    "key_points": ["Mock point 1", "Mock point 2"],
                    "action_items": ["Task: Mock action 1 (assigned to: Speaker 1)", "Task: Mock action 2"],
                    "sentiment": "professional",
                    "topics": ["testing", "mock data", "combined approach"],
                    "participants": ["Speaker 1", "Speaker 2"],
                },
            }
        else:
            return {
                "success": True,
                "analysis": {
                    "summary": "[Mock] This is a sample analysis summary.",
                    "key_points": ["Mock point 1", "Mock point 2"],
                    "action_items": ["Mock action 1", "Mock action 2"],
                    "sentiment": "neutral",
                    "topics": ["testing", "mock data"],
                },
                "provider": "gemini",
            }


class OpenAIProvider(AIProvider):
    """OpenAI GPT provider"""

    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        super().__init__(api_key, config)
        if OPENAI_AVAILABLE and api_key:
            self.client = openai.OpenAI(api_key=api_key)

    def is_available(self) -> bool:
        return OPENAI_AVAILABLE and bool(self.api_key)

    def validate_api_key(self) -> bool:
        """Validate OpenAI API key by making a test request"""
        if not self.is_available():
            return False

        try:
            # Make a simple completion request to test the API key
            response = self.client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": "Test"}],
                max_tokens=5,
            )
            return bool(response and response.choices)
        except Exception as e:
            logger.error("OpenAIProvider", "validate_api_key", f"API validation failed: {e}")
            return False

    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio using OpenAI Whisper"""
        if not self.is_available():
            return self._mock_response("transcription")

        try:
            with open(audio_file_path, "rb") as audio_file:
                transcript = self.client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    language=None if language == "auto" else language,
                )

            return {
                "success": True,
                "transcription": transcript.text,
                "language": language,
                "confidence": 0.9,
                "provider": "openai",
            }

        except Exception as e:
            logger.error("OpenAIProvider", "transcribe_audio", f"Error: {e}")
            return {"success": False, "error": str(e), "provider": "openai"}

    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using OpenAI GPT"""
        if not self.is_available():
            return self._mock_response("analysis")

        try:
            response = self.client.chat.completions.create(
                model=self.config.get("model", "gpt-4o-mini"),
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an AI assistant that analyzes text and provides "
                            "structured insights in JSON format."
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"""
                        Analyze this text and return JSON with this structure:
                        {{
                            "summary": "concise summary",
                            "key_points": ["point 1", "point 2"],
                            "action_items": ["action 1", "action 2"],
                            "sentiment": "positive/negative/neutral",
                            "topics": ["topic1", "topic2"]
                        }}

                        Text: {text}
                        """,
                    },
                ],
                temperature=self.config.get("temperature", 0.3),
                max_tokens=self.config.get("max_tokens", 4000),
            )

            response_text = response.choices[0].message.content.strip()
            if response_text.startswith("```json"):
                response_text = response_text[7:-3].strip()

            result = json.loads(response_text)
            return {"success": True, "analysis": result, "provider": "openai"}

        except Exception as e:
            logger.error("OpenAIProvider", "analyze_text", f"Error: {e}")
            return {"success": False, "error": str(e), "provider": "openai"}

    def _mock_response(self, response_type: str) -> Dict[str, Any]:
        """Return mock response for testing"""
        if response_type == "transcription":
            return {
                "success": True,
                "transcription": "[Mock OpenAI] This is a sample transcription for testing purposes.",
                "language": "en",
                "confidence": 0.95,
                "provider": "openai",
            }
        else:
            return {
                "success": True,
                "analysis": {
                    "summary": "[Mock OpenAI] This is a sample analysis summary.",
                    "key_points": ["Mock OpenAI point 1", "Mock OpenAI point 2"],
                    "action_items": ["Mock OpenAI action 1", "Mock OpenAI action 2"],
                    "sentiment": "neutral",
                    "topics": ["testing", "openai", "mock data"],
                },
                "provider": "openai",
            }


class AnthropicProvider(AIProvider):
    """Anthropic Claude provider"""

    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        super().__init__(api_key, config)
        if ANTHROPIC_AVAILABLE and api_key:
            self.client = anthropic.Anthropic(api_key=api_key)

    def is_available(self) -> bool:
        return ANTHROPIC_AVAILABLE and bool(self.api_key)

    def validate_api_key(self) -> bool:
        """Validate Anthropic API key by making a test request"""
        if not self.is_available():
            return False

        try:
            # Make a simple message request to test the API key
            response = self.client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=5,
                messages=[{"role": "user", "content": "Test"}],
            )
            return bool(response and response.content)
        except Exception as e:
            logger.error("AnthropicProvider", "validate_api_key", f"API validation failed: {e}")
            return False

    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio using Claude (note: Claude doesn't support audio transcription directly)"""
        logger.warning(
            "AnthropicProvider",
            "transcribe_audio",
            "Claude doesn't support direct audio transcription",
        )
        return {
            "success": False,
            "error": (
                "Claude doesn't support direct audio transcription. " "Please use another provider for transcription."
            ),
            "provider": "anthropic",
        }

    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using Claude"""
        if not self.is_available():
            return self._mock_response("analysis")

        try:
            response = self.client.messages.create(
                model=self.config.get("model", "claude-3-5-sonnet-20241022"),
                max_tokens=self.config.get("max_tokens", 4000),
                temperature=self.config.get("temperature", 0.3),
                messages=[
                    {
                        "role": "user",
                        "content": f"""
                        Analyze this text and return JSON with this structure:
                        {{
                            "summary": "concise summary",
                            "key_points": ["point 1", "point 2"],
                            "action_items": ["action 1", "action 2"],
                            "sentiment": "positive/negative/neutral",
                            "topics": ["topic1", "topic2"]
                        }}

                        Text: {text}
                        """,
                    }
                ],
            )

            response_text = response.content[0].text.strip()
            if response_text.startswith("```json"):
                response_text = response_text[7:-3].strip()

            result = json.loads(response_text)
            return {"success": True, "analysis": result, "provider": "anthropic"}

        except Exception as e:
            logger.error("AnthropicProvider", "analyze_text", f"Error: {e}")
            return {"success": False, "error": str(e), "provider": "anthropic"}

    def _mock_response(self, response_type: str) -> Dict[str, Any]:
        """Return mock response for testing"""
        return {
            "success": True,
            "analysis": {
                "summary": "[Mock Claude] This is a sample analysis summary.",
                "key_points": ["Mock Claude point 1", "Mock Claude point 2"],
                "action_items": ["Mock Claude action 1", "Mock Claude action 2"],
                "sentiment": "neutral",
                "topics": ["testing", "anthropic", "mock data"],
            },
            "provider": "anthropic",
        }


class OpenRouterProvider(AIProvider):
    """OpenRouter universal API provider"""

    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        super().__init__(api_key, config)
        self.base_url = (
            config.get("base_url", "https://openrouter.ai/api/v1") if config else "https://openrouter.ai/api/v1"
        )

    def is_available(self) -> bool:
        return REQUESTS_AVAILABLE and bool(self.api_key)

    def validate_api_key(self) -> bool:
        """Validate OpenRouter API key by making a test request"""
        if not self.is_available():
            return False

        try:
            import requests

            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }
            response = requests.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json={
                    "model": "openai/gpt-3.5-turbo",
                    "messages": [{"role": "user", "content": "Test"}],
                    "max_tokens": 5,
                },
                timeout=10,
            )
            return response.status_code == 200
        except Exception as e:
            logger.error("OpenRouterProvider", "validate_api_key", f"API validation failed: {e}")
            return False

    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio through OpenRouter (limited audio support)"""
        logger.warning(
            "OpenRouterProvider",
            "transcribe_audio",
            "OpenRouter has limited audio transcription support",
        )
        return {
            "success": False,
            "error": (
                "OpenRouter has limited audio transcription support. " "Please use OpenAI or Gemini for transcription."
            ),
            "provider": "openrouter",
        }

    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using OpenRouter"""
        if not self.is_available():
            return self._mock_response("analysis")

        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "X-Title": "HiDock Desktop Application",
            }

            data = {
                "model": self.config.get("model", "anthropic/claude-3.5-sonnet"),
                "messages": [
                    {
                        "role": "user",
                        "content": f"""
                        Analyze this text and return JSON with this structure:
                        {{
                            "summary": "concise summary",
                            "key_points": ["point 1", "point 2"],
                            "action_items": ["action 1", "action 2"],
                            "sentiment": "positive/negative/neutral",
                            "topics": ["topic1", "topic2"]
                        }}

                        Text: {text}
                        """,
                    }
                ],
                "temperature": self.config.get("temperature", 0.3),
                "max_tokens": self.config.get("max_tokens", 4000),
            }

            response = requests.post(f"{self.base_url}/chat/completions", headers=headers, json=data)
            response.raise_for_status()

            result = response.json()
            response_text = result["choices"][0]["message"]["content"].strip()

            if response_text.startswith("```json"):
                response_text = response_text[7:-3].strip()

            analysis = json.loads(response_text)
            return {"success": True, "analysis": analysis, "provider": "openrouter"}

        except Exception as e:
            logger.error("OpenRouterProvider", "analyze_text", f"Error: {e}")
            return {"success": False, "error": str(e), "provider": "openrouter"}

    def _mock_response(self, response_type: str) -> Dict[str, Any]:
        """Return mock response for testing"""
        return {
            "success": True,
            "analysis": {
                "summary": "[Mock OpenRouter] This is a sample analysis summary.",
                "key_points": ["Mock OpenRouter point 1", "Mock OpenRouter point 2"],
                "action_items": [
                    "Mock OpenRouter action 1",
                    "Mock OpenRouter action 2",
                ],
                "sentiment": "neutral",
                "topics": ["testing", "openrouter", "mock data"],
            },
            "provider": "openrouter",
        }


class OllamaProvider(AIProvider):
    """Ollama local model provider"""

    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        super().__init__(api_key, config)
        self.base_url = config.get("base_url", "http://localhost:11434") if config else "http://localhost:11434"

    def is_available(self) -> bool:
        return REQUESTS_AVAILABLE

    def validate_api_key(self) -> bool:
        """Validate Ollama connection by checking if service is running"""
        if not self.is_available():
            return False

        try:
            import requests

            # Check if Ollama service is running
            response = requests.get(f"{self.base_url}/api/tags", timeout=5)
            return response.status_code == 200
        except Exception as e:
            logger.error(
                "OllamaProvider",
                "validate_api_key",
                f"Connection validation failed: {e}",
            )
            return False

    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio using Ollama (limited audio support)"""
        logger.warning(
            "OllamaProvider",
            "transcribe_audio",
            "Ollama has limited audio transcription support",
        )
        return {
            "success": False,
            "error": (
                "Ollama doesn't support direct audio transcription. "
                "Please use OpenAI Whisper or Gemini for transcription."
            ),
            "provider": "ollama",
        }

    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using Ollama"""
        if not self.is_available():
            return self._mock_response("analysis")

        try:
            headers = {"Content-Type": "application/json"}

            # Ollama uses a different API format
            data = {
                "model": self.config.get("model", "llama3.2:latest"),
                "prompt": f"""
                Analyze this text and return JSON with this structure:
                {{
                    "summary": "concise summary",
                    "key_points": ["point 1", "point 2"],
                    "action_items": ["action 1", "action 2"],
                    "sentiment": "positive/negative/neutral",
                    "topics": ["topic1", "topic2"]
                }}

                Text: {text}
                """,
                "stream": False,
                "options": {
                    "temperature": self.config.get("temperature", 0.3),
                    "num_predict": self.config.get("max_tokens", 4000),
                },
            }

            response = requests.post(f"{self.base_url}/api/generate", headers=headers, json=data, timeout=30)
            response.raise_for_status()

            result = response.json()
            response_text = result.get("response", "").strip()

            if response_text.startswith("```json"):
                response_text = response_text[7:-3].strip()

            analysis = json.loads(response_text)
            return {"success": True, "analysis": analysis, "provider": "ollama"}

        except Exception as e:
            logger.error("OllamaProvider", "analyze_text", f"Error: {e}")
            return self._mock_response("analysis")

    def _mock_response(self, response_type: str) -> Dict[str, Any]:
        """Return mock response for testing"""
        return {
            "success": True,
            "analysis": {
                "summary": "[Mock Ollama] This is a sample analysis summary using local models.",
                "key_points": ["Mock Ollama point 1", "Mock Ollama point 2"],
                "action_items": ["Mock Ollama action 1", "Mock Ollama action 2"],
                "sentiment": "neutral",
                "topics": ["testing", "ollama", "local models"],
            },
            "provider": "ollama",
        }


class LMStudioProvider(AIProvider):
    """LM Studio local model provider"""

    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        super().__init__(api_key, config)
        self.base_url = config.get("base_url", "http://localhost:1234/v1") if config else "http://localhost:1234/v1"

    def is_available(self) -> bool:
        return REQUESTS_AVAILABLE

    def validate_api_key(self) -> bool:
        """Validate LM Studio connection by checking if service is running"""
        if not self.is_available():
            return False

        try:
            import requests

            # Check if LM Studio service is running
            response = requests.get(f"{self.base_url}/models", timeout=5)
            return response.status_code == 200
        except Exception as e:
            logger.error(
                "LMStudioProvider",
                "validate_api_key",
                f"Connection validation failed: {e}",
            )
            return False

    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio using LM Studio (limited audio support)"""
        logger.warning(
            "LMStudioProvider",
            "transcribe_audio",
            "LM Studio has limited audio transcription support",
        )
        return {
            "success": False,
            "error": (
                "LM Studio doesn't support direct audio transcription. "
                "Please use OpenAI Whisper or Gemini for transcription."
            ),
            "provider": "lmstudio",
        }

    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using LM Studio"""
        if not self.is_available():
            return self._mock_response("analysis")

        try:
            headers = {"Content-Type": "application/json"}

            # LM Studio uses OpenAI-compatible API
            data = {
                "model": self.config.get("model", "custom-model"),
                "messages": [
                    {
                        "role": "user",
                        "content": f"""
                        Analyze this text and return JSON with this structure:
                        {{
                            "summary": "concise summary",
                            "key_points": ["point 1", "point 2"],
                            "action_items": ["action 1", "action 2"],
                            "sentiment": "positive/negative/neutral",
                            "topics": ["topic1", "topic2"]
                        }}

                        Text: {text}
                        """,
                    }
                ],
                "temperature": self.config.get("temperature", 0.3),
                "max_tokens": self.config.get("max_tokens", 4000),
            }

            response = requests.post(f"{self.base_url}/chat/completions", headers=headers, json=data)
            response.raise_for_status()

            result = response.json()
            response_text = result["choices"][0]["message"]["content"].strip()

            if response_text.startswith("```json"):
                response_text = response_text[7:-3].strip()

            analysis = json.loads(response_text)
            return {"success": True, "analysis": analysis, "provider": "lmstudio"}

        except Exception as e:
            logger.error("LMStudioProvider", "analyze_text", f"Error: {e}")
            return self._mock_response("analysis")

    def _mock_response(self, response_type: str) -> Dict[str, Any]:
        """Return mock response for testing"""
        return {
            "success": True,
            "analysis": {
                "summary": "[Mock LM Studio] This is a sample analysis summary using local models.",
                "key_points": ["Mock LM Studio point 1", "Mock LM Studio point 2"],
                "action_items": ["Mock LM Studio action 1", "Mock LM Studio action 2"],
                "sentiment": "neutral",
                "topics": ["testing", "lmstudio", "local models"],
            },
            "provider": "lmstudio",
        }


class AIServiceManager:
    """Unified AI service manager for handling multiple AI providers.

    This class manages configuration and interaction with various AI providers
    including Gemini, OpenAI, Anthropic, OpenRouter, Ollama, and LM Studio.
    """

    def __init__(self):
        self.providers = {}

    def configure_provider(self, provider_name: str, api_key: str, config: Dict[str, Any] = None) -> bool:
        """Configure an AI provider"""
        try:
            if provider_name == "gemini":
                self.providers[provider_name] = GeminiProvider(api_key, config)
            elif provider_name == "openai":
                self.providers[provider_name] = OpenAIProvider(api_key, config)
            elif provider_name == "anthropic":
                self.providers[provider_name] = AnthropicProvider(api_key, config)
            elif provider_name == "openrouter":
                self.providers[provider_name] = OpenRouterProvider(api_key, config)
            elif provider_name == "ollama":
                self.providers[provider_name] = OllamaProvider(api_key, config)
            elif provider_name == "lmstudio":
                self.providers[provider_name] = LMStudioProvider(api_key, config)
            elif provider_name in ["amazon", "qwen", "deepseek"]:
                # For now, these providers use mock responses
                logger.info(
                    "AIServiceManager",
                    "configure_provider",
                    f"{provider_name} provider configured with mock responses",
                )
                self.providers[provider_name] = self._create_mock_provider(provider_name, api_key, config)
            else:
                logger.error(
                    "AIServiceManager",
                    "configure_provider",
                    f"Unknown provider: {provider_name}",
                )
                return False

            return True

        except Exception as e:
            logger.error(
                "AIServiceManager",
                "configure_provider",
                f"Error configuring {provider_name}: {e}",
            )
            return False

    def get_provider(self, provider_name: str) -> Optional[AIProvider]:
        """Get configured provider"""
        return self.providers.get(provider_name)

    def validate_provider(self, provider_name: str, api_key: str, config: Dict[str, Any] = None) -> bool:
        """Validate API key for a specific provider"""
        try:
            # Create temporary provider instance for validation
            temp_provider = None

            if provider_name == "gemini":
                temp_provider = GeminiProvider(api_key, config)
            elif provider_name == "openai":
                temp_provider = OpenAIProvider(api_key, config)
            elif provider_name == "anthropic":
                temp_provider = AnthropicProvider(api_key, config)
            elif provider_name == "openrouter":
                temp_provider = OpenRouterProvider(api_key, config)
            elif provider_name == "ollama":
                temp_provider = OllamaProvider(api_key, config)
            elif provider_name == "lmstudio":
                temp_provider = LMStudioProvider(api_key, config)
            else:
                # For unknown providers, assume API key is valid if provided
                logger.warning(
                    "AIServiceManager",
                    "validate_provider",
                    f"Unknown provider {provider_name}, skipping validation",
                )
                return bool(api_key)

            if temp_provider:
                return temp_provider.validate_api_key()

            return False

        except Exception as e:
            logger.error(
                "AIServiceManager",
                "validate_provider",
                f"Error validating {provider_name}: {e}",
            )
            return False

    def transcribe_audio(self, provider_name: str, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio using specified provider"""
        provider = self.get_provider(provider_name)
        if not provider:
            return {
                "success": False,
                "error": f"Provider {provider_name} not configured",
                "provider": provider_name,
            }

        return provider.transcribe_audio(audio_file_path, language)

    def analyze_text(self, provider_name: str, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using specified provider"""
        provider = self.get_provider(provider_name)
        if not provider:
            return {
                "success": False,
                "error": f"Provider {provider_name} not configured",
                "provider": provider_name,
            }

        return provider.analyze_text(text, analysis_type)

    def _create_mock_provider(self, provider_name: str, api_key: str, config: Dict[str, Any] = None) -> AIProvider:
        """Create a mock provider for providers not yet fully implemented"""

        class MockProvider(AIProvider):
            def __init__(self, name, api_key, config):
                super().__init__(api_key, config)
                self.name = name

            def is_available(self) -> bool:
                return True

            def validate_api_key(self) -> bool:
                """Mock providers always validate successfully"""
                return True

            def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
                return {
                    "success": True,
                    "transcription": f"[Mock {self.name.title()}] This is a sample transcription for testing purposes.",
                    "language": "en",
                    "confidence": 0.95,
                    "provider": self.name,
                }

            def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
                return {
                    "success": True,
                    "analysis": {
                        "summary": f"[Mock {self.name.title()}] This is a sample analysis summary.",
                        "key_points": [
                            f"Mock {self.name} point 1",
                            f"Mock {self.name} point 2",
                        ],
                        "action_items": [
                            f"Mock {self.name} action 1",
                            f"Mock {self.name} action 2",
                        ],
                        "sentiment": "neutral",
                        "topics": ["testing", self.name, "mock data"],
                    },
                    "provider": self.name,
                }

        return MockProvider(provider_name, api_key, config)


# Global service manager instance
ai_service = AIServiceManager()
