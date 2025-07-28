"""
Pytest configuration and fixtures for HiDock Next testing.
"""
import pytest
import tempfile
import os
from unittest.mock import Mock, MagicMock
from pathlib import Path


@pytest.fixture
def temp_dir():
    """Create a temporary directory for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def mock_usb_device():
    """Mock USB device for testing device communication."""
    device = Mock()
    device.idVendor = 0x1234
    device.idProduct = 0x5678
    device.serial_number = "TEST123456"
    device.manufacturer = "HiDock"
    device.product = "H1"
    return device


@pytest.fixture
def mock_hidock_device():
    """Mock HiDock device instance for testing."""
    from hidock_device import HiDockJensen
    
    device = Mock(spec=HiDockJensen)
    device.is_connected = True
    device.device_info = {
        'model': 'H1',
        'serial': 'TEST123456',
        'firmware': '1.0.0'
    }
    device.storage_info = {
        'total': 1000000,
        'used': 500000,
        'free': 500000
    }
    return device


@pytest.fixture
def sample_audio_file(temp_dir):
    """Create a sample audio file for testing."""
    audio_file = temp_dir / "test_audio.wav"
    # Create a minimal WAV file header
    with open(audio_file, "wb") as f:
        # WAV header (44 bytes)
        f.write(b'RIFF')
        f.write((36).to_bytes(4, 'little'))  # File size - 8
        f.write(b'WAVE')
        f.write(b'fmt ')
        f.write((16).to_bytes(4, 'little'))  # Subchunk1Size
        f.write((1).to_bytes(2, 'little'))   # AudioFormat (PCM)
        f.write((1).to_bytes(2, 'little'))   # NumChannels
        f.write((44100).to_bytes(4, 'little'))  # SampleRate
        f.write((88200).to_bytes(4, 'little'))  # ByteRate
        f.write((2).to_bytes(2, 'little'))   # BlockAlign
        f.write((16).to_bytes(2, 'little'))  # BitsPerSample
        f.write(b'data')
        f.write((0).to_bytes(4, 'little'))   # Subchunk2Size
    
    return audio_file


@pytest.fixture
def mock_config():
    """Mock configuration for testing."""
    return {
        'download_directory': '/tmp/downloads',
        'theme': 'blue',
        'appearance_mode': 'dark',
        'auto_connect': True,
        'log_level': 'INFO',
        'device_vid': 0x1234,
        'device_pid': 0x5678,
        'target_interface': 0
    }


@pytest.fixture(autouse=True)
def setup_test_environment(monkeypatch):
    """Set up test environment variables."""
    monkeypatch.setenv('TESTING', '1')
    monkeypatch.setenv('LOG_LEVEL', 'DEBUG')


@pytest.fixture
def mock_gemini_service():
    """Mock Gemini AI service for testing."""
    service = Mock()
    service.transcribe_audio.return_value = {
        'text': 'This is a test transcription.',
        'confidence': 0.95
    }
    service.extract_insights.return_value = {
        'summary': 'Test summary',
        'key_points': ['Point 1', 'Point 2'],
        'sentiment': 'Positive'
    }
    return service