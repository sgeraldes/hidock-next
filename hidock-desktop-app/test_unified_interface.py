"""
Test script for the unified device interface abstraction.

This script demonstrates how the unified interface works across both
desktop and web implementations.
"""

import asyncio
import sys
from unittest.mock import Mock, MagicMock

# Import the unified interface components
from device_interface import (
    DeviceManager, DeviceModel, DeviceCapability, 
    detect_device_model, get_model_capabilities
)
from desktop_device_adapter import DesktopDeviceAdapter


class MockUSBBackend:
    """Mock USB backend for testing."""
    pass


class MockHiDockJensen:
    """Mock HiDockJensen for testing."""
    
    def __init__(self, usb_backend):
        self.usb_backend = usb_backend
        self.is_connected_flag = False
        self.device_info = {
            'sn': 'TEST123456',
            'versionCode': '1.2.3'
        }
    
    def connect(self, target_interface_number=0, vid=0x10D6, pid=0xAF0D, auto_retry=True):
        self.is_connected_flag = True
        self.connected_pid = pid  # Store the PID for model detection
        return True, None
    
    def disconnect(self):
        self.is_connected_flag = False
    
    def is_connected(self):
        return self.is_connected_flag
    
    def get_device_info(self):
        return self.device_info
    
    def get_card_info(self):
        return {'capacity': 8000, 'used': 1000}  # MB
    
    def get_file_count(self):
        return {'count': 5}
    
    def list_files(self):
        return {
            'files': [
                {
                    'name': 'test1.wav',
                    'length': 1024000,
                    'duration': 30.0,
                    'time': '2024-01-01 12:00:00',
                    'version': 2,
                    'signature': 'abc123'
                },
                {
                    'name': 'test2.wav',
                    'length': 2048000,
                    'duration': 60.0,
                    'time': '2024-01-01 13:00:00',
                    'version': 2,
                    'signature': 'def456'
                }
            ]
        }
    
    def stream_file(self, filename, file_length, data_callback, progress_callback=None, timeout_s=180):
        # Simulate file download
        test_data = b'test audio data' * 1000
        data_callback(test_data)
        if progress_callback:
            progress_callback(len(test_data), file_length)
        return "OK"
    
    def delete_file(self, filename):
        return {'result': 'success'}
    
    def format_card(self):
        return {'result': 'success'}
    
    def set_device_time(self, dt_object):
        return {'result': 'success'}
    
    def get_connection_stats(self):
        return {
            'is_connected': self.is_connected_flag,
            'retry_count': 0,
            'error_counts': {'usb_timeout': 0, 'protocol_error': 0},
            'operation_stats': {
                'commands_sent': 10,
                'responses_received': 10,
                'bytes_transferred': 50000,
                'connection_time': 1640995200,  # timestamp
                'last_operation_time': 0.1
            }
        }


async def test_device_model_detection():
    """Test device model detection functionality."""
    print("Testing device model detection...")
    
    # Test H1 model
    model = detect_device_model(0x10D6, 0xAF0C)
    assert model == DeviceModel.H1, f"Expected H1, got {model}"
    
    # Test H1E model
    model = detect_device_model(0x10D6, 0xAF0D)
    assert model == DeviceModel.H1E, f"Expected H1E, got {model}"
    
    # Test P1 model
    model = detect_device_model(0x10D6, 0xAF0E)
    assert model == DeviceModel.P1, f"Expected P1, got {model}"
    
    # Test unknown model
    model = detect_device_model(0x10D6, 0x1234)
    assert model == DeviceModel.UNKNOWN, f"Expected UNKNOWN, got {model}"
    
    print("✓ Device model detection tests passed")


async def test_capability_detection():
    """Test capability detection for different models."""
    print("Testing capability detection...")
    
    # Test H1 capabilities
    caps = get_model_capabilities(DeviceModel.H1)
    expected_h1 = [
        DeviceCapability.FILE_LIST,
        DeviceCapability.FILE_DOWNLOAD,
        DeviceCapability.FILE_DELETE,
        DeviceCapability.TIME_SYNC,
        DeviceCapability.FORMAT_STORAGE
    ]
    for cap in expected_h1:
        assert cap in caps, f"H1 missing capability: {cap}"
    
    # Test H1E capabilities (should have more than H1)
    caps_h1e = get_model_capabilities(DeviceModel.H1E)
    assert DeviceCapability.SETTINGS_MANAGEMENT in caps_h1e
    assert DeviceCapability.HEALTH_MONITORING in caps_h1e
    
    # Test P1 capabilities (should have the most)
    caps_p1 = get_model_capabilities(DeviceModel.P1)
    assert DeviceCapability.REAL_TIME_RECORDING in caps_p1
    assert DeviceCapability.AUDIO_PLAYBACK in caps_p1
    
    print("✓ Capability detection tests passed")


async def test_desktop_adapter():
    """Test the desktop device adapter."""
    print("Testing desktop device adapter...")
    
    # Create mock backend and patch HiDockJensen
    mock_backend = MockUSBBackend()
    
    # Create adapter with mocked Jensen device
    adapter = DesktopDeviceAdapter(mock_backend)
    adapter.jensen_device = MockHiDockJensen(mock_backend)
    
    # Test connection with H1E PID
    device_info = await adapter.connect(device_id="10d6:af0d")  # H1E PID
    print(f"Device info: {device_info}")
    print(f"Connected: {device_info.connected}")
    print(f"Serial: {device_info.serial_number}")
    print(f"Model: {device_info.model}")
    assert device_info.connected == True
    assert device_info.model == DeviceModel.H1E
    assert device_info.serial_number == "TEST123456"
    
    # Test device info
    info = await adapter.get_device_info()
    assert info.firmware_version == "1.2.3"
    
    # Test storage info
    storage = await adapter.get_storage_info()
    assert storage.total_capacity == 8000 * 1024 * 1024  # 8GB in bytes
    assert storage.file_count == 5
    
    # Test recordings list
    recordings = await adapter.get_recordings()
    assert len(recordings) == 2
    assert recordings[0].filename == "test1.wav"
    assert recordings[0].duration == 30.0
    
    # Test capabilities
    capabilities = adapter.get_capabilities()
    assert DeviceCapability.FILE_LIST in capabilities
    assert DeviceCapability.SETTINGS_MANAGEMENT in capabilities
    
    # Test connection stats
    stats = adapter.get_connection_stats()
    assert stats.successful_connections == 1
    assert stats.total_operations == 10
    
    # Test health monitoring
    health = await adapter.get_device_health()
    assert health.overall_status == "healthy"
    assert health.connection_quality == 1.0
    
    # Test connection test
    is_healthy = await adapter.test_connection()
    assert is_healthy == True
    
    # Test disconnect
    await adapter.disconnect()
    assert not adapter.is_connected()
    
    print("✓ Desktop adapter tests passed")


async def test_device_manager():
    """Test the device manager functionality."""
    print("Testing device manager...")
    
    # Create mock adapter
    mock_adapter = Mock()
    
    # Create a mock device info object
    mock_device_info = Mock()
    mock_device_info.model = DeviceModel.H1E
    mock_device_info.connected = True
    
    # Make connect return a coroutine
    async def mock_connect(*args, **kwargs):
        return mock_device_info
    
    async def mock_disconnect():
        pass
    
    mock_adapter.connect = mock_connect
    mock_adapter.get_capabilities = Mock(return_value=[
        DeviceCapability.FILE_LIST,
        DeviceCapability.HEALTH_MONITORING
    ])
    mock_adapter.disconnect = mock_disconnect
    
    # Create device manager
    manager = DeviceManager(mock_adapter)
    
    # Test connection
    device_info = await manager.connect_to_device()
    assert device_info.connected == True
    
    # Test capabilities
    capabilities = manager.get_device_capabilities()
    assert DeviceCapability.FILE_LIST in capabilities
    assert DeviceCapability.HEALTH_MONITORING in capabilities
    
    # Test capability checking
    assert manager.has_capability(DeviceCapability.FILE_LIST) == True
    assert manager.has_capability(DeviceCapability.AUDIO_PLAYBACK) == False
    
    # Test model info
    model_info = await manager.get_device_model_info()
    assert 'capabilities' in model_info
    assert 'specifications' in model_info
    
    # Test disconnect
    await manager.disconnect_device()
    assert manager.get_current_device() is None
    
    print("✓ Device manager tests passed")


async def main():
    """Run all tests."""
    print("Running unified device interface tests...\n")
    
    try:
        await test_device_model_detection()
        await test_capability_detection()
        await test_desktop_adapter()
        await test_device_manager()
        
        print("\n🎉 All tests passed! The unified device interface is working correctly.")
        
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n💥 Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())