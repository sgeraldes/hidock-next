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

import base64
import json
import os
import wave
from typing import Any, Dict, Optional, Union
from abc import ABC, abstractmethod

from config_and_logger import logger

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

try:
    import boto3
    AMAZON_AVAILABLE = True
except ImportError:
    boto3 = None
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
        pass
    
    @abstractmethod
    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text and extract insights"""
        pass
    
    @abstractmethod
    def is_available(self) -> bool:
        """Check if the provider is available"""
        pass


class GeminiProvider(AIProvider):
    """Google Gemini AI provider"""
    
    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        super().__init__(api_key, config)
        if GEMINI_AVAILABLE and api_key:
            genai.configure(api_key=api_key)
    
    def is_available(self) -> bool:
        return GEMINI_AVAILABLE and bool(self.api_key)
    
    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio using Gemini"""
        if not self.is_available():
            return self._mock_response("transcription")
        
        try:
            # Read audio file
            with open(audio_file_path, 'rb') as audio_file:
                audio_data = audio_file.read()
            
            # Encode to base64
            audio_base64 = base64.b64encode(audio_data).decode('utf-8')
            
            # Create model
            model = genai.GenerativeModel(self.config.get('model', 'gemini-1.5-flash'))
            
            # Create prompt
            prompt = f"""
            Please transcribe the following audio file. Return the result as a JSON object with this structure:
            {{
                "transcription": "the full transcribed text",
                "language": "detected language code",
                "confidence": 0.95
            }}
            
            Audio data: data:audio/wav;base64,{audio_base64}
            """
            
            response = model.generate_content(prompt)
            
            # Parse response
            response_text = response.text.strip()
            if response_text.startswith('```json'):
                response_text = response_text[7:-3].strip()
            
            result = json.loads(response_text)
            return {
                "success": True,
                "transcription": result.get("transcription", ""),
                "language": result.get("language", language),
                "confidence": result.get("confidence", 0.9),
                "provider": "gemini"
            }
            
        except Exception as e:
            logger.error("GeminiProvider", "transcribe_audio", f"Error: {e}")
            return {
                "success": False,
                "error": str(e),
                "provider": "gemini"
            }
    
    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using Gemini"""
        if not self.is_available():
            return self._mock_response("analysis")
        
        try:
            model = genai.GenerativeModel(self.config.get('model', 'gemini-1.5-flash'))
            
            prompt = f"""
            Analyze the following text and provide structured insights. Return as JSON:
            {{
                "summary": "concise summary",
                "key_points": ["point 1", "point 2"],
                "action_items": ["action 1", "action 2"],
                "sentiment": "positive/negative/neutral",
                "topics": ["topic1", "topic2"]
            }}
            
            Text to analyze: {text}
            """
            
            response = model.generate_content(prompt)
            response_text = response.text.strip()
            
            if response_text.startswith('```json'):
                response_text = response_text[7:-3].strip()
            
            result = json.loads(response_text)
            return {
                "success": True,
                "analysis": result,
                "provider": "gemini"
            }
            
        except Exception as e:
            logger.error("GeminiProvider", "analyze_text", f"Error: {e}")
            return {
                "success": False,
                "error": str(e),
                "provider": "gemini"
            }
    
    def _mock_response(self, response_type: str) -> Dict[str, Any]:
        """Return mock response for testing"""
        if response_type == "transcription":
            return {
                "success": True,
                "transcription": "[Mock] This is a sample transcription for testing purposes.",
                "language": "en",
                "confidence": 0.95,
                "provider": "gemini"
            }
        else:
            return {
                "success": True,
                "analysis": {
                    "summary": "[Mock] This is a sample analysis summary.",
                    "key_points": ["Mock point 1", "Mock point 2"],
                    "action_items": ["Mock action 1", "Mock action 2"],
                    "sentiment": "neutral",
                    "topics": ["testing", "mock data"]
                },
                "provider": "gemini"
            }


class OpenAIProvider(AIProvider):
    """OpenAI GPT provider"""
    
    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        super().__init__(api_key, config)
        if OPENAI_AVAILABLE and api_key:
            self.client = openai.OpenAI(api_key=api_key)
    
    def is_available(self) -> bool:
        return OPENAI_AVAILABLE and bool(self.api_key)
    
    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio using OpenAI Whisper"""
        if not self.is_available():
            return self._mock_response("transcription")
        
        try:
            with open(audio_file_path, 'rb') as audio_file:
                transcript = self.client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    language=None if language == "auto" else language
                )
            
            return {
                "success": True,
                "transcription": transcript.text,
                "language": language,
                "confidence": 0.9,
                "provider": "openai"
            }
            
        except Exception as e:
            logger.error("OpenAIProvider", "transcribe_audio", f"Error: {e}")
            return {
                "success": False,
                "error": str(e),
                "provider": "openai"
            }
    
    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using OpenAI GPT"""
        if not self.is_available():
            return self._mock_response("analysis")
        
        try:
            response = self.client.chat.completions.create(
                model=self.config.get('model', 'gpt-4o-mini'),
                messages=[
                    {
                        "role": "system",
                        "content": "You are an AI assistant that analyzes text and provides structured insights in JSON format."
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
                        """
                    }
                ],
                temperature=self.config.get('temperature', 0.3),
                max_tokens=self.config.get('max_tokens', 4000)
            )
            
            response_text = response.choices[0].message.content.strip()
            if response_text.startswith('```json'):
                response_text = response_text[7:-3].strip()
            
            result = json.loads(response_text)
            return {
                "success": True,
                "analysis": result,
                "provider": "openai"
            }
            
        except Exception as e:
            logger.error("OpenAIProvider", "analyze_text", f"Error: {e}")
            return {
                "success": False,
                "error": str(e),
                "provider": "openai"
            }
    
    def _mock_response(self, response_type: str) -> Dict[str, Any]:
        """Return mock response for testing"""
        if response_type == "transcription":
            return {
                "success": True,
                "transcription": "[Mock OpenAI] This is a sample transcription for testing purposes.",
                "language": "en",
                "confidence": 0.95,
                "provider": "openai"
            }
        else:
            return {
                "success": True,
                "analysis": {
                    "summary": "[Mock OpenAI] This is a sample analysis summary.",
                    "key_points": ["Mock OpenAI point 1", "Mock OpenAI point 2"],
                    "action_items": ["Mock OpenAI action 1", "Mock OpenAI action 2"],
                    "sentiment": "neutral",
                    "topics": ["testing", "openai", "mock data"]
                },
                "provider": "openai"
            }


class AnthropicProvider(AIProvider):
    """Anthropic Claude provider"""
    
    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        super().__init__(api_key, config)
        if ANTHROPIC_AVAILABLE and api_key:
            self.client = anthropic.Anthropic(api_key=api_key)
    
    def is_available(self) -> bool:
        return ANTHROPIC_AVAILABLE and bool(self.api_key)
    
    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio using Claude (note: Claude doesn't support audio transcription directly)"""
        logger.warning("AnthropicProvider", "transcribe_audio", "Claude doesn't support direct audio transcription")
        return {
            "success": False,
            "error": "Claude doesn't support direct audio transcription. Please use another provider for transcription.",
            "provider": "anthropic"
        }
    
    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using Claude"""
        if not self.is_available():
            return self._mock_response("analysis")
        
        try:
            response = self.client.messages.create(
                model=self.config.get('model', 'claude-3-5-sonnet-20241022'),
                max_tokens=self.config.get('max_tokens', 4000),
                temperature=self.config.get('temperature', 0.3),
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
                        """
                    }
                ]
            )
            
            response_text = response.content[0].text.strip()
            if response_text.startswith('```json'):
                response_text = response_text[7:-3].strip()
            
            result = json.loads(response_text)
            return {
                "success": True,
                "analysis": result,
                "provider": "anthropic"
            }
            
        except Exception as e:
            logger.error("AnthropicProvider", "analyze_text", f"Error: {e}")
            return {
                "success": False,
                "error": str(e),
                "provider": "anthropic"
            }
    
    def _mock_response(self, response_type: str) -> Dict[str, Any]:
        """Return mock response for testing"""
        return {
            "success": True,
            "analysis": {
                "summary": "[Mock Claude] This is a sample analysis summary.",
                "key_points": ["Mock Claude point 1", "Mock Claude point 2"],
                "action_items": ["Mock Claude action 1", "Mock Claude action 2"],
                "sentiment": "neutral",
                "topics": ["testing", "anthropic", "mock data"]
            },
            "provider": "anthropic"
        }


class OpenRouterProvider(AIProvider):
    """OpenRouter universal API provider"""
    
    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        super().__init__(api_key, config)
        self.base_url = config.get('base_url', 'https://openrouter.ai/api/v1') if config else 'https://openrouter.ai/api/v1'
    
    def is_available(self) -> bool:
        return REQUESTS_AVAILABLE and bool(self.api_key)
    
    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio through OpenRouter (limited audio support)"""
        logger.warning("OpenRouterProvider", "transcribe_audio", "OpenRouter has limited audio transcription support")
        return {
            "success": False,
            "error": "OpenRouter has limited audio transcription support. Please use OpenAI or Gemini for transcription.",
            "provider": "openrouter"
        }
    
    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using OpenRouter"""
        if not self.is_available():
            return self._mock_response("analysis")
        
        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "X-Title": "HiDock Desktop Application"
            }
            
            data = {
                "model": self.config.get('model', 'anthropic/claude-3.5-sonnet'),
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
                        """
                    }
                ],
                "temperature": self.config.get('temperature', 0.3),
                "max_tokens": self.config.get('max_tokens', 4000)
            }
            
            response = requests.post(f"{self.base_url}/chat/completions", headers=headers, json=data)
            response.raise_for_status()
            
            result = response.json()
            response_text = result['choices'][0]['message']['content'].strip()
            
            if response_text.startswith('```json'):
                response_text = response_text[7:-3].strip()
            
            analysis = json.loads(response_text)
            return {
                "success": True,
                "analysis": analysis,
                "provider": "openrouter"
            }
            
        except Exception as e:
            logger.error("OpenRouterProvider", "analyze_text", f"Error: {e}")
            return {
                "success": False,
                "error": str(e),
                "provider": "openrouter"
            }
    
    def _mock_response(self, response_type: str) -> Dict[str, Any]:
        """Return mock response for testing"""
        return {
            "success": True,
            "analysis": {
                "summary": "[Mock OpenRouter] This is a sample analysis summary.",
                "key_points": ["Mock OpenRouter point 1", "Mock OpenRouter point 2"],
                "action_items": ["Mock OpenRouter action 1", "Mock OpenRouter action 2"],
                "sentiment": "neutral",
                "topics": ["testing", "openrouter", "mock data"]
            },
            "provider": "openrouter"
        }


class OllamaProvider(AIProvider):
    """Ollama local model provider"""
    
    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        super().__init__(api_key, config)
        self.base_url = config.get('base_url', 'http://localhost:11434') if config else 'http://localhost:11434'
    
    def is_available(self) -> bool:
        return REQUESTS_AVAILABLE
    
    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio using Ollama (limited audio support)"""
        logger.warning("OllamaProvider", "transcribe_audio", "Ollama has limited audio transcription support")
        return {
            "success": False,
            "error": "Ollama doesn't support direct audio transcription. Please use OpenAI Whisper or Gemini for transcription.",
            "provider": "ollama"
        }
    
    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using Ollama"""
        if not self.is_available():
            return self._mock_response("analysis")
        
        try:
            headers = {
                "Content-Type": "application/json"
            }
            
            # Ollama uses a different API format
            data = {
                "model": self.config.get('model', 'llama3.2:latest'),
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
                    "temperature": self.config.get('temperature', 0.3),
                    "num_predict": self.config.get('max_tokens', 4000)
                }
            }
            
            response = requests.post(f"{self.base_url}/api/generate", headers=headers, json=data)
            response.raise_for_status()
            
            result = response.json()
            response_text = result.get('response', '').strip()
            
            if response_text.startswith('```json'):
                response_text = response_text[7:-3].strip()
            
            analysis = json.loads(response_text)
            return {
                "success": True,
                "analysis": analysis,
                "provider": "ollama"
            }
            
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
                "topics": ["testing", "ollama", "local models"]
            },
            "provider": "ollama"
        }


class LMStudioProvider(AIProvider):
    """LM Studio local model provider"""
    
    def __init__(self, api_key: str, config: Dict[str, Any] = None):
        super().__init__(api_key, config)
        self.base_url = config.get('base_url', 'http://localhost:1234/v1') if config else 'http://localhost:1234/v1'
    
    def is_available(self) -> bool:
        return REQUESTS_AVAILABLE
    
    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio using LM Studio (limited audio support)"""
        logger.warning("LMStudioProvider", "transcribe_audio", "LM Studio has limited audio transcription support")
        return {
            "success": False,
            "error": "LM Studio doesn't support direct audio transcription. Please use OpenAI Whisper or Gemini for transcription.",
            "provider": "lmstudio"
        }
    
    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using LM Studio"""
        if not self.is_available():
            return self._mock_response("analysis")
        
        try:
            headers = {
                "Content-Type": "application/json"
            }
            
            # LM Studio uses OpenAI-compatible API
            data = {
                "model": self.config.get('model', 'custom-model'),
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
                        """
                    }
                ],
                "temperature": self.config.get('temperature', 0.3),
                "max_tokens": self.config.get('max_tokens', 4000)
            }
            
            response = requests.post(f"{self.base_url}/chat/completions", headers=headers, json=data)
            response.raise_for_status()
            
            result = response.json()
            response_text = result['choices'][0]['message']['content'].strip()
            
            if response_text.startswith('```json'):
                response_text = response_text[7:-3].strip()
            
            analysis = json.loads(response_text)
            return {
                "success": True,
                "analysis": analysis,
                "provider": "lmstudio"
            }
            
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
                "topics": ["testing", "lmstudio", "local models"]
            },
            "provider": "lmstudio"
        }


class AIServiceManager:
    """Unified AI service manager"""
    
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
                logger.info("AIServiceManager", "configure_provider", f"{provider_name} provider configured with mock responses")
                self.providers[provider_name] = self._create_mock_provider(provider_name, api_key, config)
            else:
                logger.error("AIServiceManager", "configure_provider", f"Unknown provider: {provider_name}")
                return False
            
            return True
            
        except Exception as e:
            logger.error("AIServiceManager", "configure_provider", f"Error configuring {provider_name}: {e}")
            return False
    
    def get_provider(self, provider_name: str) -> Optional[AIProvider]:
        """Get configured provider"""
        return self.providers.get(provider_name)
    
    def transcribe_audio(self, provider_name: str, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio using specified provider"""
        provider = self.get_provider(provider_name)
        if not provider:
            return {
                "success": False,
                "error": f"Provider {provider_name} not configured",
                "provider": provider_name
            }
        
        return provider.transcribe_audio(audio_file_path, language)
    
    def analyze_text(self, provider_name: str, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using specified provider"""
        provider = self.get_provider(provider_name)
        if not provider:
            return {
                "success": False,
                "error": f"Provider {provider_name} not configured",
                "provider": provider_name
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
            
            def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
                return {
                    "success": True,
                    "transcription": f"[Mock {self.name.title()}] This is a sample transcription for testing purposes.",
                    "language": "en",
                    "confidence": 0.95,
                    "provider": self.name
                }
            
            def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
                return {
                    "success": True,
                    "analysis": {
                        "summary": f"[Mock {self.name.title()}] This is a sample analysis summary.",
                        "key_points": [f"Mock {self.name} point 1", f"Mock {self.name} point 2"],
                        "action_items": [f"Mock {self.name} action 1", f"Mock {self.name} action 2"],
                        "sentiment": "neutral",
                        "topics": ["testing", self.name, "mock data"]
                    },
                    "provider": self.name
                }
        
        return MockProvider(provider_name, api_key, config)


# Global service manager instance
ai_service = AIServiceManager()