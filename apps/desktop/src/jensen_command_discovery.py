#!/usr/bin/env python3
"""
Jensen Protocol Command Discovery Tool

This tool systematically tests all possible Jensen protocol command IDs to discover
what commands the HiDock H1E device actually supports, including the missing
commands 10, 14, and 15.

IMPORTANT: This tool should only be used with real hardware for validation.
It provides the foundation for determining what's actually possible vs. theoretical.

Usage:
    python jensen_command_discovery.py [--safe-mode] [--range START-END]

Author: HiDock Hardware Analysis Project
Version: 1.0.0
Date: 2025-08-31
"""

import sys
import time
import json
import os
import platform
import argparse
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict

# Add current directory to Python path
sys.path.insert(0, '.')

from config_and_logger import logger
from hidock_device import HiDockJensen
import usb.backend.libusb1


def initialize_usb_backend():
    """
    Initialize libusb backend with cross-platform support
    
    Uses the same logic as the existing desktop app for proper USB backend initialization
    """
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        system = platform.system()
        
        # Build platform-specific library paths
        if system == "Darwin":  # macOS
            lib_paths_to_try = [
                "/opt/homebrew/lib/libusb-1.0.dylib",  # Apple Silicon Homebrew
                "/usr/local/lib/libusb-1.0.dylib",     # Intel Mac Homebrew
                "/opt/local/lib/libusb-1.0.dylib",     # MacPorts
                "/usr/lib/libusb-1.0.dylib",           # System location
            ]
        elif system == "Linux":
            lib_paths_to_try = [
                "/usr/lib/x86_64-linux-gnu/libusb-1.0.so",  # Ubuntu/Debian x64
                "/usr/lib/aarch64-linux-gnu/libusb-1.0.so", # Ubuntu/Debian ARM64
                "/usr/lib64/libusb-1.0.so",                  # RHEL/CentOS/Fedora x64
                "/usr/lib/libusb-1.0.so",                    # Generic location
                "/usr/local/lib/libusb-1.0.so",              # Compiled from source
            ]
        elif system == "Windows":
            lib_paths_to_try = (
                [os.path.join(script_dir, name) for name in ["libusb-1.0.dll"]]
                + [os.path.join(script_dir, "MS64", "dll", name) for name in ["libusb-1.0.dll"]]
                + [os.path.join(script_dir, "MS32", "dll", name) for name in ["libusb-1.0.dll"]]
                + [os.path.join(script_dir, "lib", name) for name in ["libusb-1.0.dll"]]
            )
        else:
            lib_paths_to_try = []
        
        # Try to find the library in the specified paths
        lib_path = next((p for p in lib_paths_to_try if os.path.exists(p)), None)
        
        if not lib_path:
            # Fallback to system paths
            backend_instance = usb.backend.libusb1.get_backend()
            if not backend_instance:
                logger.error("Discovery", "initialize_usb_backend", 
                           f"libusb backend failed from system paths on {system}")
                return None
        else:
            # Use the found library path
            backend_instance = usb.backend.libusb1.get_backend(find_library=lambda x: lib_path)
            if not backend_instance:
                logger.error("Discovery", "initialize_usb_backend",
                           f"Failed to initialize backend with library: {lib_path}")
                return None
        
        logger.info("Discovery", "initialize_usb_backend", 
                   f"USB backend initialized successfully on {system}")
        return backend_instance
        
    except Exception as e:
        logger.error("Discovery", "initialize_usb_backend", f"Backend initialization failed: {e}")
        return None


@dataclass
class CommandResult:
    """Result of testing a single command"""
    command_id: int
    status: str  # 'supported', 'no_response', 'error', 'timeout'
    response_length: int
    response_preview: str  # First 32 bytes as hex
    error_message: str
    response_time_ms: float
    test_timestamp: str


@dataclass
class DiscoverySession:
    """Complete command discovery session results"""
    device_info: Dict
    test_range: Tuple[int, int]
    total_commands_tested: int
    supported_commands: List[int]
    unknown_commands: List[int]
    error_commands: List[int]
    command_results: List[CommandResult]
    session_timestamp: str
    discovery_duration_seconds: float


class JensenCommandDiscovery:
    """
    Jensen Protocol Command Discovery Tool
    
    This class systematically tests Jensen protocol commands to determine
    what the HiDock H1E device actually supports beyond the documented commands.
    """
    
    def __init__(self, jensen_device: HiDockJensen):
        """Initialize command discovery tool"""
        self.device = jensen_device
        self.discovery_results = []
        self.safe_mode = True  # Default to safe mode
        self.test_timeout = 2000  # 2 second timeout per command
        
        # Known safe commands that shouldn't cause issues
        self.known_safe_commands = [1, 2, 4, 6, 11, 16, 18]
        
        # Commands to avoid in safe mode (potential device modification)
        self.potentially_dangerous_commands = [3, 7, 8, 9, 12, 17, 19]
        
        logger.info("Discovery", "__init__", "Jensen Command Discovery initialized")
    
    def set_safe_mode(self, enabled: bool):
        """Enable or disable safe mode"""
        self.safe_mode = enabled
        mode = "ENABLED" if enabled else "DISABLED"
        logger.info("Discovery", "set_safe_mode", f"Safe mode {mode}")
    
    def test_single_command(self, command_id: int, test_payload: bytes = b"") -> CommandResult:
        """
        Test a single command ID to see if device responds
        
        Args:
            command_id: Command ID to test
            test_payload: Optional payload to send with command
            
        Returns:
            CommandResult: Results of the command test
        """
        start_time = time.time()
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        
        logger.debug("Discovery", "test_single_command", 
                    f"Testing CMD {command_id} with {len(test_payload)} byte payload")
        
        try:
            # Check if command should be skipped in safe mode
            if self.safe_mode and command_id in self.potentially_dangerous_commands:
                return CommandResult(
                    command_id=command_id,
                    status='skipped_safe_mode',
                    response_length=0,
                    response_preview='',
                    error_message='Skipped in safe mode - potentially dangerous',
                    response_time_ms=0,
                    test_timestamp=timestamp
                )
            
            # Send command and wait for response
            response = self.device._send_and_receive(
                command_id, 
                test_payload, 
                timeout_ms=self.test_timeout
            )
            
            response_time = (time.time() - start_time) * 1000  # Convert to ms
            
            if response:
                # Command returned data - likely supported
                response_preview = response[:32].hex() if len(response) <= 32 else response[:32].hex() + "..."
                
                result = CommandResult(
                    command_id=command_id,
                    status='supported',
                    response_length=len(response),
                    response_preview=response_preview,
                    error_message='',
                    response_time_ms=response_time,
                    test_timestamp=timestamp
                )
                
                logger.info("Discovery", "test_single_command", 
                           f"[OK] CMD {command_id}: SUPPORTED ({len(response)} bytes, {response_time:.1f}ms)")
                
            else:
                # No response - command may not exist or returned empty
                result = CommandResult(
                    command_id=command_id,
                    status='no_response',
                    response_length=0,
                    response_preview='',
                    error_message='',
                    response_time_ms=response_time,
                    test_timestamp=timestamp
                )
                
                logger.debug("Discovery", "test_single_command",
                           f"[?] CMD {command_id}: NO RESPONSE ({response_time:.1f}ms)")
            
        except Exception as e:
            response_time = (time.time() - start_time) * 1000
            error_msg = str(e)
            
            # Categorize the error
            if "timeout" in error_msg.lower():
                status = 'timeout'
            elif "unknown command" in error_msg.lower() or "invalid" in error_msg.lower():
                status = 'unsupported'
            else:
                status = 'error'
            
            result = CommandResult(
                command_id=command_id,
                status=status,
                response_length=0,
                response_preview='',
                error_message=error_msg,
                response_time_ms=response_time,
                test_timestamp=timestamp
            )
            
            logger.debug("Discovery", "test_single_command",
                        f"[FAIL] CMD {command_id}: {status.upper()} - {error_msg}")
        
        return result
    
    def discover_commands_in_range(self, start_cmd: int, end_cmd: int) -> List[CommandResult]:
        """
        Discover all supported commands in a given range
        
        Args:
            start_cmd: Starting command ID
            end_cmd: Ending command ID (inclusive)
            
        Returns:
            List[CommandResult]: Results for all tested commands
        """
        results = []
        total_commands = end_cmd - start_cmd + 1
        
        logger.info("Discovery", "discover_commands_in_range",
                   f"Testing commands {start_cmd}-{end_cmd} ({total_commands} commands)")
        
        for cmd_id in range(start_cmd, end_cmd + 1):
            # Add small delay between commands to avoid overwhelming device
            time.sleep(0.1)
            
            result = self.test_single_command(cmd_id)
            results.append(result)
            
            # Progress reporting
            if cmd_id % 10 == 0 or result.status == 'supported':
                progress = ((cmd_id - start_cmd + 1) / total_commands) * 100
                logger.info("Discovery", "discover_commands_in_range",
                           f"Progress: {progress:.1f}% (CMD {cmd_id})")
        
        return results
    
    def test_missing_commands(self) -> List[CommandResult]:
        """
        Specifically test the missing commands 10, 14, 15
        
        Returns:
            List[CommandResult]: Results for missing commands
        """
        missing_commands = [10, 14, 15]
        results = []
        
        logger.info("Discovery", "test_missing_commands", 
                   "Testing missing commands: 10, 14, 15")
        
        for cmd_id in missing_commands:
            # Test with empty payload
            result = self.test_single_command(cmd_id)
            results.append(result)
            
            # If command is supported, try different payloads
            if result.status == 'supported':
                logger.info("Discovery", "test_missing_commands",
                           f"[FOUND] Missing command {cmd_id}! Testing with payloads...")
                
                # Test with various payloads to understand command
                test_payloads = [
                    b"",           # Empty
                    b"\x00",       # Single null byte
                    b"\x00\x01",   # Two bytes
                    b"\x01\x02\x03\x04",  # Four bytes
                ]
                
                for i, payload in enumerate(test_payloads):
                    payload_result = self.test_single_command(cmd_id, payload)
                    payload_result.command_id = f"{cmd_id}_payload_{i}"
                    results.append(payload_result)
        
        return results
    
    def validate_known_commands(self) -> List[CommandResult]:
        """
        Validate all known commands work as expected
        
        Returns:
            List[CommandResult]: Results for known commands
        """
        known_commands = list(range(1, 21))  # Commands 1-20
        results = []
        
        logger.info("Discovery", "validate_known_commands",
                   "Validating known commands 1-20")
        
        for cmd_id in known_commands:
            result = self.test_single_command(cmd_id)
            results.append(result)
            
            if result.status != 'supported' and cmd_id in self.known_safe_commands:
                logger.warning("Discovery", "validate_known_commands",
                              f"⚠️ Known command {cmd_id} not responding as expected!")
        
        return results
    
    def comprehensive_discovery(self, max_command_id: int = 50) -> DiscoverySession:
        """
        Perform comprehensive command discovery
        
        Args:
            max_command_id: Maximum command ID to test
            
        Returns:
            DiscoverySession: Complete discovery results
        """
        start_time = time.time()
        session_timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        
        logger.info("Discovery", "comprehensive_discovery",
                   f"Starting comprehensive command discovery (1-{max_command_id})")
        
        # Get device info first
        try:
            device_info = {
                'connected': self.device.is_connected(),
                'model': getattr(self.device, 'model', 'unknown'),
                'device_info': getattr(self.device, 'device_info', {})
            }
        except Exception as e:
            device_info = {'error': f'Could not get device info: {e}'}
        
        # Test all commands in range
        all_results = self.discover_commands_in_range(1, max_command_id)
        
        # Analyze results
        supported_commands = []
        unknown_commands = []
        error_commands = []
        
        for result in all_results:
            if result.status == 'supported':
                supported_commands.append(result.command_id)
            elif result.status in ['no_response', 'timeout']:
                unknown_commands.append(result.command_id)
            else:
                error_commands.append(result.command_id)
        
        discovery_duration = time.time() - start_time
        
        session = DiscoverySession(
            device_info=device_info,
            test_range=(1, max_command_id),
            total_commands_tested=len(all_results),
            supported_commands=supported_commands,
            unknown_commands=unknown_commands,
            error_commands=error_commands,
            command_results=all_results,
            session_timestamp=session_timestamp,
            discovery_duration_seconds=discovery_duration
        )
        
        logger.info("Discovery", "comprehensive_discovery",
                   f"Discovery complete: {len(supported_commands)} supported, "
                   f"{len(unknown_commands)} unknown, {len(error_commands)} errors")
        
        return session
    
    def save_discovery_results(self, session: DiscoverySession, filename: str = None):
        """
        Save discovery results to JSON file
        
        Args:
            session: Discovery session to save
            filename: Optional filename, defaults to timestamped file
        """
        if not filename:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            filename = f"jensen_command_discovery_{timestamp}.json"
        
        try:
            # Convert to dictionary for JSON serialization
            session_dict = asdict(session)
            
            with open(filename, 'w') as f:
                json.dump(session_dict, f, indent=2, default=str)
            
            logger.info("Discovery", "save_discovery_results",
                       f"Discovery results saved to {filename}")
        except Exception as e:
            logger.error("Discovery", "save_discovery_results",
                        f"Failed to save results: {e}")
    
    def print_discovery_summary(self, session: DiscoverySession):
        """Print a human-readable summary of discovery results"""
        print("\n" + "="*60)
        print("🔍 JENSEN PROTOCOL COMMAND DISCOVERY SUMMARY")
        print("="*60)
        
        print(f"📅 Session: {session.session_timestamp}")
        print(f"⏱️  Duration: {session.discovery_duration_seconds:.1f} seconds")
        print(f"🎯 Commands Tested: {session.total_commands_tested} "
              f"(range {session.test_range[0]}-{session.test_range[1]})")
        
        print(f"\n📊 RESULTS SUMMARY:")
        print(f"  ✅ Supported Commands: {len(session.supported_commands)}")
        print(f"  ❓ Unknown/No Response: {len(session.unknown_commands)}")  
        print(f"  ❌ Error Commands: {len(session.error_commands)}")
        
        if session.supported_commands:
            print(f"\n✅ SUPPORTED COMMANDS:")
            for cmd_id in session.supported_commands:
                result = next(r for r in session.command_results if r.command_id == cmd_id)
                print(f"  CMD {cmd_id:2d}: {result.response_length:4d} bytes "
                      f"({result.response_time_ms:.1f}ms) - {result.response_preview[:16]}")
        
        # Highlight missing commands if found
        missing_found = [cmd for cmd in [10, 14, 15] if cmd in session.supported_commands]
        if missing_found:
            print(f"\n🎉 MISSING COMMANDS FOUND:")
            for cmd_id in missing_found:
                result = next(r for r in session.command_results if r.command_id == cmd_id)
                print(f"  CMD {cmd_id}: {result.response_preview}")
        
        print("\n" + "="*60)


def main():
    """Main discovery tool runner"""
    parser = argparse.ArgumentParser(description='Jensen Protocol Command Discovery Tool')
    parser.add_argument('--safe-mode', action='store_true', default=True,
                       help='Enable safe mode (skip potentially dangerous commands)')
    parser.add_argument('--full-scan', action='store_true', 
                       help='Disable safe mode and test all commands')
    parser.add_argument('--range', type=str, default='1-50',
                       help='Command range to test (e.g., "1-50", "10-15")')
    parser.add_argument('--missing-only', action='store_true',
                       help='Test only missing commands 10, 14, 15')
    parser.add_argument('--output', type=str,
                       help='Output filename for results JSON')
    
    args = parser.parse_args()
    
    # Parse command range
    try:
        start_cmd, end_cmd = map(int, args.range.split('-'))
    except ValueError:
        print(f"❌ Invalid range format: {args.range}. Use format like '1-50'")
        sys.exit(1)
    
    # Initialize device connection using proper backend initialization
    try:
        backend = initialize_usb_backend()
        if not backend:
            print("X Could not initialize USB backend")
            print("   Make sure libusb is installed:")
            print("   - Windows: Ensure libusb-1.0.dll is in the script directory")
            print("   - macOS: brew install libusb") 
            print("   - Linux: sudo apt-get install libusb-1.0-0-dev")
            sys.exit(1)
        
        jensen_device = HiDockJensen(backend)
        
        # Attempt to connect
        if not jensen_device.connect():
            print("X Could not connect to HiDock device")
            print("   Make sure device is connected and drivers are installed")
            sys.exit(1)
        
        print("Connected to HiDock device successfully")
        
    except Exception as e:
        print(f"X Device connection failed: {e}")
        sys.exit(1)
    
    # Initialize discovery tool
    discovery = JensenCommandDiscovery(jensen_device)
    discovery.set_safe_mode(args.safe_mode and not args.full_scan)
    
    print(f"\nJensen Protocol Command Discovery")
    print(f"   Safe Mode: {'ON' if discovery.safe_mode else 'OFF'}")
    print(f"   Range: {args.range}")
    
    try:
        if args.missing_only:
            # Test only missing commands
            print("\n[TARGET] Testing missing commands 10, 14, 15...")
            results = discovery.test_missing_commands()
            
            print("\nMISSING COMMAND RESULTS:")
            for result in results:
                status_emoji = "[OK]" if result.status == 'supported' else "[FAIL]"
                print(f"  {status_emoji} CMD {result.command_id}: {result.status}")
                if result.status == 'supported':
                    print(f"      Response: {result.response_length} bytes - {result.response_preview}")
        
        else:
            # Full discovery
            session = discovery.comprehensive_discovery(end_cmd)
            
            # Print summary
            discovery.print_discovery_summary(session)
            
            # Save results
            if args.output:
                discovery.save_discovery_results(session, args.output)
            else:
                discovery.save_discovery_results(session)
    
    except KeyboardInterrupt:
        print("\n\n⚠️ Discovery interrupted by user")
        
    except Exception as e:
        print(f"\n❌ Discovery failed: {e}")
        import traceback
        traceback.print_exc()
        
    finally:
        # Clean up device connection
        try:
            jensen_device.disconnect()
            print("\n🔌 Device disconnected")
        except:
            pass


if __name__ == "__main__":
    main()