"""
Tests for device communication functionality.
"""
import pytest
import time
import threading
import struct
from unittest.mock import Mock, patch, MagicMock, call
import usb.core
import usb.util
from hidock_device import HiDockJensen
from constants import (
    DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID, EP_OUT_ADDR, EP_IN_ADDR,
    CMD_GET_DEVICE_INFO, CMD_GET_FILE_LIST, CMD_TRANSFER_FILE, CMD_DELETE_FILE
)


class TestHiDockJensenEnhanced:
    """Test cases for enhanced HiDockJensen device communication."""
    
    @pytest.fixture
    def mock_usb_backend(self):
        """Create a mock USB backend."""
        return Mock()
    
    @pytest.fixture
    def mock_usb_device_full(self):
        """Create a comprehensive mock USB device."""
        device = Mock()
        device.idVendor = DEFAULT_VENDOR_ID
        device.idProduct = DEFAULT_PRODUCT_ID
        device.serial_number = "TEST123456"
        device.manufacturer = "HiDock"
        device.product = "H1"
        device.is_kernel_driver_active.return_value = False
        device.set_configuration = Mock()
        device.get_active_configuration = Mock()
        device.read = Mock()
        device.clear_halt = Mock()
        
        # Mock configuration and interface
        config = Mock()
        interface = Mock()
        interface.bInterfaceNumber = 0
        interface.bAlternateSetting = 0
        
        # Mock endpoints
        ep_out = Mock()
        ep_out.bEndpointAddress = EP_OUT_ADDR
        ep_out.wMaxPacketSize = 64
        ep_out.write = Mock(return_value=64)
        
        ep_in = Mock()
        ep_in.bEndpointAddress = EP_IN_ADDR
        ep_in.wMaxPacketSize = 64
        
        device.get_active_configuration.return_value = config
        
        with patch('usb.util.find_descriptor') as mock_find_desc:
            mock_find_desc.side_effect = [interface, ep_out, ep_in]
            yield device
    
    @pytest.fixture
    def jensen_device(self, mock_usb_backend):
        """Create a HiDockJensen instance with mock backend."""
        return HiDockJensen(mock_usb_backend)
    
    def test_initialization_enhanced(self, jensen_device):
        """Test enhanced device initialization with new attributes."""
        assert jensen_device.usb_backend is not None
        assert jensen_device._connection_retry_count == 0
        assert jensen_device._max_retry_attempts == 3
        assert jensen_device._retry_delay == 1.0
        assert jensen_device._last_error is None
        assert isinstance(jensen_device._error_counts, dict)
        assert isinstance(jensen_device._operation_stats, dict)
        assert jensen_device._operation_stats['commands_sent'] == 0
        assert jensen_device._operation_stats['responses_received'] == 0
    
    def test_get_connection_stats(self, jensen_device):
        """Test getting connection statistics."""
        stats = jensen_device.get_connection_stats()
        
        assert 'is_connected' in stats
        assert 'model' in stats
        assert 'retry_count' in stats
        assert 'error_counts' in stats
        assert 'operation_stats' in stats
        assert 'last_error' in stats
        assert 'device_info' in stats
        
        assert stats['is_connected'] is False
        assert stats['model'] == "unknown"
        assert stats['retry_count'] == 0
    
    def test_reset_error_counts(self, jensen_device):
        """Test resetting error counters."""
        # Simulate some errors
        jensen_device._increment_error_count('usb_timeout')
        jensen_device._increment_error_count('usb_pipe_error')
        
        assert jensen_device._error_counts['usb_timeout'] == 1
        assert jensen_device._error_counts['usb_pipe_error'] == 1
        
        # Reset counters
        jensen_device.reset_error_counts()
        
        assert jensen_device._error_counts['usb_timeout'] == 0
        assert jensen_device._error_counts['usb_pipe_error'] == 0
    
    def test_increment_error_count(self, jensen_device):
        """Test incrementing error counts."""
        jensen_device._increment_error_count('usb_timeout')
        jensen_device._increment_error_count('usb_timeout')
        jensen_device._increment_error_count('protocol_error')
        
        assert jensen_device._error_counts['usb_timeout'] == 2
        assert jensen_device._error_counts['protocol_error'] == 1
        assert jensen_device._error_counts['usb_pipe_error'] == 0
    
    def test_should_retry_connection(self, jensen_device):
        """Test connection retry logic."""
        # Should retry initially
        assert jensen_device._should_retry_connection() is True
        
        # Should not retry after max attempts
        jensen_device._connection_retry_count = jensen_device._max_retry_attempts
        assert jensen_device._should_retry_connection() is False
        
        # Should not retry after too many connection lost errors
        jensen_device._connection_retry_count = 0
        jensen_device._error_counts['connection_lost'] = jensen_device._max_error_threshold
        assert jensen_device._should_retry_connection() is False
    
    @patch('hidock_device.time.time')
    def test_perform_health_check_skip_recent(self, mock_time, jensen_device):
        """Test health check skipping when too recent."""
        mock_time.return_value = 100.0
        jensen_device._last_health_check = 95.0  # 5 seconds ago
        
        result = jensen_device._perform_health_check()
        assert result is True  # Should skip check
    
    @patch('hidock_device.time.time')
    def test_perform_health_check_not_connected(self, mock_time, jensen_device):
        """Test health check when not connected."""
        mock_time.return_value = 100.0
        jensen_device._last_health_check = 0  # Force check
        
        result = jensen_device._perform_health_check()
        assert result is False
    
    def test_build_packet(self, jensen_device):
        """Test packet building functionality."""
        command_id = CMD_GET_DEVICE_INFO
        body_bytes = b"test_body"
        
        packet = jensen_device._build_packet(command_id, body_bytes)
        
        # Check packet structure
        assert packet[:2] == b'\x12\x34'  # Sync bytes
        assert len(packet) == 12 + len(body_bytes)  # Header + body
        
        # Verify command ID
        cmd_id_from_packet = struct.unpack(">H", packet[2:4])[0]
        assert cmd_id_from_packet == command_id
        
        # Verify sequence ID incremented
        assert jensen_device.sequence_id > 0
        
        # Verify body length
        body_len_from_packet = struct.unpack(">I", packet[8:12])[0]
        assert body_len_from_packet == len(body_bytes)
        
        # Verify body content
        assert packet[12:] == body_bytes
    
    @patch('hidock_device.usb.core.find')
    @patch('hidock_device.usb.util.claim_interface')
    @patch('hidock_device.usb.util.find_descriptor')
    def test_connect_success_with_retry(self, mock_find_desc, mock_claim, mock_find, jensen_device):
        """Test successful connection with retry mechanism."""
        # Setup mocks
        mock_device = Mock()
        mock_device.idVendor = DEFAULT_VENDOR_ID
        mock_device.idProduct = 0xAF0C  # H1 model
        mock_device.is_kernel_driver_active.return_value = False
        mock_device.set_configuration = Mock()
        mock_device.get_active_configuration = Mock()
        
        mock_find.return_value = mock_device
        
        # Mock configuration and interface
        config = Mock()
        interface = Mock()
        interface.bInterfaceNumber = 0
        interface.bAlternateSetting = 0
        
        # Mock endpoints
        ep_out = Mock()
        ep_out.bEndpointAddress = EP_OUT_ADDR
        ep_in = Mock()
        ep_in.bEndpointAddress = EP_IN_ADDR
        
        mock_device.get_active_configuration.return_value = config
        mock_find_desc.side_effect = [interface, ep_out, ep_in]
        
        # Test connection
        success, error = jensen_device.connect(auto_retry=True)
        
        assert success is True
        assert error is None
        assert jensen_device.is_connected() is True
        assert jensen_device.model == "hidock-h1"
        assert jensen_device._connection_retry_count == 0
    
    @patch('hidock_device.usb.core.find')
    def test_connect_failure_with_retry(self, mock_find, jensen_device):
        """Test connection failure with retry mechanism."""
        mock_find.return_value = None  # Device not found
        
        with patch('hidock_device.time.sleep') as mock_sleep:
            success, error = jensen_device.connect(auto_retry=True)
        
        assert success is False
        assert "not found" in error
        assert jensen_device._connection_retry_count == jensen_device._max_retry_attempts
        assert mock_sleep.call_count == jensen_device._max_retry_attempts - 1
    
    def test_send_command_not_connected(self, jensen_device):
        """Test sending command when not connected."""
        with pytest.raises(ConnectionError, match="Device not connected"):
            jensen_device._send_command(CMD_GET_DEVICE_INFO)
    
    @patch('hidock_device.usb.core.find')
    @patch('hidock_device.usb.util.claim_interface')
    @patch('hidock_device.usb.util.find_descriptor')
    def test_send_command_success(self, mock_find_desc, mock_claim, mock_find, jensen_device):
        """Test successful command sending with performance tracking."""
        # Setup connected device
        self._setup_connected_device(mock_find, mock_find_desc, jensen_device)
        
        # Test command sending
        seq_id = jensen_device._send_command(CMD_GET_DEVICE_INFO, b"test")
        
        assert seq_id > 0
        assert jensen_device._operation_stats['commands_sent'] == 1
        assert jensen_device._operation_stats['bytes_transferred'] > 0
        time.sleep(0.1)
        assert jensen_device._operation_stats['last_operation_time'] >= 0
    
    @patch('hidock_device.usb.core.find')
    @patch('hidock_device.usb.util.claim_interface')
    @patch('hidock_device.usb.util.find_descriptor')
    def test_send_command_usb_timeout(self, mock_find_desc, mock_claim, mock_find, jensen_device):
        """Test USB timeout error handling in send command."""
        # Setup connected device
        mock_device = self._setup_connected_device(mock_find, mock_find_desc, jensen_device)
        
        # Make write raise timeout error
        jensen_device.ep_out.write.side_effect = usb.core.USBTimeoutError("Timeout")
        
        with pytest.raises(usb.core.USBTimeoutError):
            jensen_device._send_command(CMD_GET_DEVICE_INFO)
        
        assert jensen_device._error_counts['usb_timeout'] == 1
    
    @patch('hidock_device.usb.core.find')
    @patch('hidock_device.usb.util.claim_interface')
    @patch('hidock_device.usb.util.find_descriptor')
    def test_send_command_pipe_error(self, mock_find_desc, mock_claim, mock_find, jensen_device):
        """Test USB pipe error handling in send command."""
        # Setup connected device
        mock_device = self._setup_connected_device(mock_find, mock_find_desc, jensen_device)
        
        # Make write raise pipe error
        pipe_error = usb.core.USBError("Pipe error")
        pipe_error.errno = 32  # LIBUSB_ERROR_PIPE
        jensen_device.ep_out.write.side_effect = pipe_error
        
        with pytest.raises(usb.core.USBError):
            jensen_device._send_command(CMD_GET_DEVICE_INFO)
        
        assert jensen_device._error_counts['usb_pipe_error'] == 1
        mock_device.clear_halt.assert_called_once()
    
    def test_receive_response_not_connected(self, jensen_device):
        """Test receiving response when not connected."""
        with pytest.raises(ConnectionError, match="Device not connected"):
            jensen_device._receive_response(1)
    
    @patch('hidock_device.usb.core.find')
    @patch('hidock_device.usb.util.claim_interface')
    @patch('hidock_device.usb.util.find_descriptor')
    def test_receive_response_success(self, mock_find_desc, mock_claim, mock_find, jensen_device):
        """Test successful response receiving with performance tracking."""
        # Setup connected device
        mock_device = self._setup_connected_device(mock_find, mock_find_desc, jensen_device)
        
        # Create a valid response packet
        response_data = self._create_response_packet(CMD_GET_DEVICE_INFO, 1, b"response_body")
        mock_device.read.return_value = response_data
        
        response = jensen_device._receive_response(1)
        
        assert response is not None
        assert response['id'] == CMD_GET_DEVICE_INFO
        assert response['sequence'] == 1
        assert response['body'] == b"response_body"
        assert jensen_device._operation_stats['responses_received'] == 1
    
    @patch('hidock_device.usb.core.find')
    @patch('hidock_device.usb.util.claim_interface')
    @patch('hidock_device.usb.util.find_descriptor')
    def test_receive_response_timeout(self, mock_find_desc, mock_claim, mock_find, jensen_device):
        """Test response timeout handling."""
        # Setup connected device
        mock_device = self._setup_connected_device(mock_find, mock_find_desc, jensen_device)
        
        # Make read always timeout
        mock_device.read.side_effect = usb.core.USBTimeoutError("Timeout")
        
        response = jensen_device._receive_response(1, timeout_ms=100)
        
        assert response is None
        assert jensen_device._error_counts['usb_timeout'] > 0
    
    def test_send_and_receive_atomic(self, jensen_device):
        """Test that send and receive operations are atomic."""
        with patch.object(jensen_device, '_send_command') as mock_send:
            with patch.object(jensen_device, '_receive_response') as mock_receive:
                mock_send.return_value = 123
                mock_receive.return_value = {'id': CMD_GET_DEVICE_INFO, 'sequence': 123, 'body': b'test'}
                
                result = jensen_device._send_and_receive(CMD_GET_DEVICE_INFO, b'test_body')
                
                mock_send.assert_called_once_with(CMD_GET_DEVICE_INFO, b'test_body', 5000)
                mock_receive.assert_called_once_with(123, 5000, streaming_cmd_id=None)
                assert result['id'] == CMD_GET_DEVICE_INFO
    
    def _setup_connected_device(self, mock_find, mock_find_desc, jensen_device):
        """Helper method to setup a connected device for testing."""
        mock_device = Mock()
        mock_device.idVendor = DEFAULT_VENDOR_ID
        mock_device.idProduct = 0xAF0C  # H1 model
        mock_device.is_kernel_driver_active.return_value = False
        mock_device.set_configuration = Mock()
        mock_device.get_active_configuration = Mock()
        mock_device.read = Mock()
        mock_device.clear_halt = Mock()
        
        mock_find.return_value = mock_device
        
        # Mock configuration and interface
        config = Mock()
        interface = Mock()
        interface.bInterfaceNumber = 0
        interface.bAlternateSetting = 0
        
        # Mock endpoints
        ep_out = Mock()
        ep_out.bEndpointAddress = EP_OUT_ADDR
        ep_out.wMaxPacketSize = 64
        ep_out.write = Mock(return_value=12)  # Return correct packet size
        
        ep_in = Mock()
        ep_in.bEndpointAddress = EP_IN_ADDR
        ep_in.wMaxPacketSize = 64
        
        mock_device.get_active_configuration.return_value = config
        mock_find_desc.side_effect = [interface, ep_out, ep_in]
        
        # Connect the device
        jensen_device.connect(auto_retry=False)
        
        # Disable health checks for testing
        jensen_device._last_health_check = time.time()
        
        return mock_device
    
    def _create_response_packet(self, command_id, sequence_id, body):
        """Helper method to create a valid response packet."""
        header = bytearray([0x12, 0x34])  # Sync bytes
        header.extend(struct.pack(">H", command_id))  # Command ID
        header.extend(struct.pack(">I", sequence_id))  # Sequence ID
        header.extend(struct.pack(">I", len(body)))  # Body length
        return bytes(header) + body


class TestProtocolHandlingEnhanced:
    """Enhanced test cases for Jensen protocol handling."""
    
    @pytest.fixture
    def jensen_device(self):
        """Create a HiDockJensen instance for protocol testing."""
        return HiDockJensen(Mock())
    
    def test_packet_building_structure(self, jensen_device):
        """Test packet building with correct structure."""
        command_id = 0x1234
        body = b"test_body_content"
        
        packet = jensen_device._build_packet(command_id, body)
        
        # Test sync bytes
        assert packet[0:2] == b'\x12\x34'
        
        # Test command ID
        cmd_from_packet = struct.unpack(">H", packet[2:4])[0]
        assert cmd_from_packet == command_id
        
        # Test sequence ID (should be incremented)
        seq_from_packet = struct.unpack(">I", packet[4:8])[0]
        assert seq_from_packet == jensen_device.sequence_id
        
        # Test body length
        body_len_from_packet = struct.unpack(">I", packet[8:12])[0]
        assert body_len_from_packet == len(body)
        
        # Test body content
        assert packet[12:] == body
    
    def test_sequence_id_management(self, jensen_device):
        """Test sequence ID incrementation and wrapping."""
        initial_seq = jensen_device.sequence_id
        
        # Build multiple packets
        jensen_device._build_packet(1, b"test1")
        seq1 = jensen_device.sequence_id
        
        jensen_device._build_packet(2, b"test2")
        seq2 = jensen_device.sequence_id
        
        # Sequence IDs should increment
        assert seq1 > initial_seq
        assert seq2 > seq1
        
        # Test wrapping at max value
        jensen_device.sequence_id = 0xFFFFFFFF
        jensen_device._build_packet(3, b"test3")
        assert jensen_device.sequence_id == 0
    
    def test_packet_building_empty_body(self, jensen_device):
        """Test packet building with empty body."""
        packet = jensen_device._build_packet(CMD_GET_DEVICE_INFO, b"")
        
        assert len(packet) == 12  # Header only
        body_len = struct.unpack(">I", packet[8:12])[0]
        assert body_len == 0
    
    def test_packet_building_large_body(self, jensen_device):
        """Test packet building with large body."""
        large_body = b"x" * 1024
        packet = jensen_device._build_packet(CMD_TRANSFER_FILE, large_body)
        
        assert len(packet) == 12 + 1024
        body_len = struct.unpack(">I", packet[8:12])[0]
        assert body_len == 1024
        assert packet[12:] == large_body


class TestErrorHandlingEnhanced:
    """Enhanced test cases for error handling."""
    
    @pytest.fixture
    def jensen_device(self):
        """Create a HiDockJensen instance for error testing."""
        return HiDockJensen(Mock())
    
    def test_error_count_tracking(self, jensen_device):
        """Test comprehensive error count tracking."""
        # Test all error types
        error_types = ['usb_timeout', 'usb_pipe_error', 'connection_lost', 'protocol_error']
        
        for error_type in error_types:
            jensen_device._increment_error_count(error_type)
            assert jensen_device._error_counts[error_type] == 1
        
        # Test multiple increments
        jensen_device._increment_error_count('usb_timeout')
        assert jensen_device._error_counts['usb_timeout'] == 2
    
    def test_error_threshold_checking(self, jensen_device):
        """Test error threshold checking for connection retry."""
        # Should retry initially
        assert jensen_device._should_retry_connection() is True
        
        # Simulate many connection lost errors
        for _ in range(jensen_device._max_error_threshold):
            jensen_device._increment_error_count('connection_lost')
        
        # Should not retry after threshold
        assert jensen_device._should_retry_connection() is False
    
    def test_connection_retry_limit(self, jensen_device):
        """Test connection retry attempt limit."""
        # Should retry initially
        assert jensen_device._should_retry_connection() is True
        
        # Simulate max retry attempts
        jensen_device._connection_retry_count = jensen_device._max_retry_attempts
        
        # Should not retry after max attempts
        assert jensen_device._should_retry_connection() is False
    
    def test_last_error_tracking(self, jensen_device):
        """Test last error message tracking."""
        assert jensen_device._last_error is None
        
        # Simulate setting last error
        jensen_device._last_error = "Test error message"
        
        stats = jensen_device.get_connection_stats()
        assert stats['last_error'] == "Test error message"


class TestPerformanceMonitoring:
    """Test cases for performance monitoring features."""
    
    @pytest.fixture
    def jensen_device(self):
        """Create a HiDockJensen instance for performance testing."""
        return HiDockJensen(Mock())
    
    def test_operation_stats_initialization(self, jensen_device):
        """Test operation statistics initialization."""
        stats = jensen_device._operation_stats
        
        assert stats['commands_sent'] == 0
        assert stats['responses_received'] == 0
        assert stats['bytes_transferred'] == 0
        assert stats['connection_time'] == 0
        assert stats['last_operation_time'] == 0
    
    def test_operation_stats_in_connection_stats(self, jensen_device):
        """Test operation statistics in connection stats."""
        connection_stats = jensen_device.get_connection_stats()
        
        assert 'operation_stats' in connection_stats
        assert connection_stats['operation_stats']['commands_sent'] == 0
        assert connection_stats['operation_stats']['responses_received'] == 0


@pytest.mark.integration
class TestDeviceIntegrationEnhanced:
    """Enhanced integration tests requiring actual device connection."""
    
    @pytest.mark.device
    def test_real_device_connection_with_retry(self):
        """Test connection to real device with retry mechanism (requires hardware)."""
        pytest.skip("Requires actual HiDock device")
    
    @pytest.mark.device
    def test_real_device_health_check(self):
        """Test health check with real device (requires hardware)."""
        pytest.skip("Requires actual HiDock device")
    
    @pytest.mark.device
    def test_real_device_error_recovery(self):
        """Test error recovery with real device (requires hardware)."""
        pytest.skip("Requires actual HiDock device")
    
    @pytest.mark.device
    def test_real_device_performance_monitoring(self):
        """Test performance monitoring with real device (requires hardware)."""
        pytest.skip("Requires actual HiDock device")