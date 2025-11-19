#!/usr/bin/env python3
"""
Gemini Model Management

Provides utilities for validating and listing available Gemini models.
Can fetch models dynamically from Google API or use cached list.
"""

from typing import Any, Dict, List, Optional

from config_and_logger import logger

# Cached list of known Gemini models (as of January 2025)
# Updated from https://ai.google.dev/gemini-api/docs/models
KNOWN_GEMINI_MODELS = {
    # Stable 2.5 Models
    "gemini-2.5-pro": {
        "version": "2.5",
        "family": "pro",
        "status": "stable",
        "description": "Most capable model for complex reasoning tasks",
        "supports_audio": True,
    },
    "gemini-2.5-flash": {
        "version": "2.5",
        "family": "flash",
        "status": "stable",
        "description": "Fast and versatile for diverse tasks",
        "supports_audio": True,
    },
    "gemini-2.5-flash-lite": {
        "version": "2.5",
        "family": "flash-lite",
        "status": "stable",
        "description": "Most cost-efficient and fastest 2.5 model",
        "supports_audio": False,
    },
    # Stable 2.0 Models
    "gemini-2.0-flash": {
        "version": "2.0",
        "family": "flash",
        "status": "stable",
        "description": "Fast and versatile 2.0 model",
        "supports_audio": True,
    },
    "gemini-2.0-flash-exp": {
        "version": "2.0",
        "family": "flash",
        "status": "experimental",
        "description": "Experimental 2.0 Flash model",
        "supports_audio": True,
    },
    "gemini-2.0-flash-lite": {
        "version": "2.0",
        "family": "flash-lite",
        "status": "stable",
        "description": "Cost-efficient 2.0 model",
        "supports_audio": False,
    },
    # Preview Models
    "gemini-2.5-flash-preview-09-2025": {
        "version": "2.5",
        "family": "flash",
        "status": "preview",
        "description": "Latest preview Flash model",
        "supports_audio": True,
    },
    "gemini-2.5-flash-lite-preview-09-2025": {
        "version": "2.5",
        "family": "flash-lite",
        "status": "preview",
        "description": "Latest preview Flash-Lite model",
        "supports_audio": False,
    },
    # Specialized Models
    "gemini-2.5-flash-image": {
        "version": "2.5",
        "family": "flash",
        "status": "stable",
        "description": "Image generation and editing model",
        "supports_audio": False,
    },
    # Aliases
    "gemini-flash-latest": {
        "version": "latest",
        "family": "flash",
        "status": "alias",
        "description": "Always points to latest Flash model",
        "supports_audio": True,
    },
}

# Models with "models/" prefix also work
KNOWN_GEMINI_MODELS_WITH_PREFIX = {f"models/{name}": info for name, info in KNOWN_GEMINI_MODELS.items()}


def is_valid_model_name(model_name: str) -> bool:
    """
    Check if a model name is valid (known to exist).

    Args:
        model_name: The model identifier to check

    Returns:
        True if the model is known to exist
    """
    if not model_name:
        return False

    # Check with and without "models/" prefix
    return (
        model_name in KNOWN_GEMINI_MODELS
        or model_name in KNOWN_GEMINI_MODELS_WITH_PREFIX
        or model_name.startswith("gemini-")  # Allow any gemini- prefixed model
    )


def get_model_info(model_name: str) -> Optional[Dict[str, Any]]:
    """
    Get information about a specific model.

    Args:
        model_name: The model identifier

    Returns:
        Dictionary with model info, or None if not found
    """
    info = KNOWN_GEMINI_MODELS.get(model_name)
    if info:
        return {**info, "name": model_name}

    info = KNOWN_GEMINI_MODELS_WITH_PREFIX.get(model_name)
    if info:
        return {**info, "name": model_name}

    return None


def list_available_models(filter_audio_support: bool = False, filter_status: Optional[str] = None) -> List[str]:
    """
    List all available Gemini models.

    Args:
        filter_audio_support: Only return models that support audio transcription
        filter_status: Filter by status ("stable", "preview", "experimental", "alias")

    Returns:
        List of model names
    """
    models = []

    for name, info in KNOWN_GEMINI_MODELS.items():
        # Apply filters
        if filter_audio_support and not info.get("supports_audio", False):
            continue
        if filter_status and info.get("status") != filter_status:
            continue

        models.append(name)

    return sorted(models)


def fetch_models_from_api(api_key: str) -> Optional[List[Dict[str, Any]]]:
    """
    Fetch available models dynamically from Google Gemini API.

    Args:
        api_key: Gemini API key

    Returns:
        List of model info dictionaries, or None if fetch fails
    """
    try:
        import google.generativeai as genai

        # Configure API
        genai.configure(api_key=api_key)

        # List models
        models = []
        for model in genai.list_models():
            model_info = {
                "name": model.name,
                "display_name": model.display_name,
                "description": getattr(model, "description", ""),
                "supported_methods": getattr(model, "supported_generation_methods", []),
            }
            models.append(model_info)

        logger.info("GeminiModels", "fetch_models_from_api", f"Fetched {len(models)} models from API")
        return models

    except ImportError:
        logger.error("GeminiModels", "fetch_models_from_api", "google-generativeai not installed")
        return None
    except Exception as e:
        logger.error("GeminiModels", "fetch_models_from_api", f"Error fetching models: {e}")
        return None


def get_recommended_models() -> Dict[str, str]:
    """
    Get recommended models for different use cases.

    Returns:
        Dictionary mapping use case to model name
    """
    return {
        "transcription": "gemini-2.5-flash",  # Fast and supports audio
        "analysis": "gemini-2.5-pro",  # Most capable for complex reasoning
        "cost_efficient": "gemini-2.5-flash-lite",  # Most cost-efficient
        "experimental": "gemini-2.0-flash-exp",  # Latest experimental features
        "latest": "gemini-flash-latest",  # Always latest
    }


def validate_model_for_transcription(model_name: str) -> tuple[bool, str]:
    """
    Validate if a model is suitable for audio transcription.

    Args:
        model_name: The model identifier to check

    Returns:
        Tuple of (is_valid, message)
    """
    if not is_valid_model_name(model_name):
        return False, f"Unknown model: {model_name}"

    info = get_model_info(model_name)
    if info and not info.get("supports_audio", True):
        return False, f"{model_name} does not support audio transcription"

    return True, f"{model_name} is valid for audio transcription"


# For backwards compatibility with old hardcoded names
LEGACY_MODEL_MAPPING = {
    "gemini-1.5-flash": "gemini-2.0-flash-exp",  # Map old to new
    "gemini-1.5-pro": "gemini-2.5-pro",
}


def normalize_model_name(model_name: str) -> str:
    """
    Normalize legacy model names to current equivalents.

    Args:
        model_name: Model name (possibly legacy)

    Returns:
        Normalized model name
    """
    return LEGACY_MODEL_MAPPING.get(model_name, model_name)


if __name__ == "__main__":
    # Test the module
    print("=== Gemini Models Module Test ===\n")

    print("All available models:")
    for model in list_available_models():
        info = get_model_info(model)
        print(f"  - {model}: {info['description']}")

    print("\nModels supporting audio transcription:")
    for model in list_available_models(filter_audio_support=True):
        print(f"  - {model}")

    print("\nStable models only:")
    for model in list_available_models(filter_status="stable"):
        print(f"  - {model}")

    print("\nRecommended models:")
    for use_case, model in get_recommended_models().items():
        print(f"  - {use_case}: {model}")

    print("\nValidation tests:")
    test_models = ["gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-invalid"]
    for model in test_models:
        is_valid, msg = validate_model_for_transcription(model)
        print(f"  - {model}: {msg}")
