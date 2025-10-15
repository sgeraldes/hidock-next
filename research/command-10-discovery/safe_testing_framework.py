#!/usr/bin/env python3
"""
Safe Testing Framework for Command 10 Discovery

This framework provides safe testing with automatic device recovery
and comprehensive logging for Command 10 parameter discovery.

Author: HiDock Research Project
Version: 1.0.0
Date: 2025-08-31
"""

import sys
import time
import os
import struct
import threading
import json
from datetime import datetime
from typing import Optional, Dict, List, Tuple, Any

# Add hidock-desktop-app to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'hidock-desktop-app'))

from config_and_logger import logger
from hidock_device import HiDockJensen
import usb.backend.libusb1

class SafeCommandTester:
    """
    Safe testing framework with automatic device recovery
    """
    
    def __init__(self):
        self.backend = None
        self.device = None
        self.test_results = []
        self.recovery_count = 0
        self.max_recovery_attempts = 3
        self.test_timeout = 5.0  # seconds
        
        # Test session info
        self.session_start = datetime.now()
        self.session_id = f"cmd10_session_{int(time.time())}"
        
    def initialize_backend(self) -> bool:
        """Initialize USB backend safely"""
        try:
            # Look for libusb in hidock-desktop-app directory
            app_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'hidock-desktop-app')
            lib_path = os.path.join(app_dir, 'libusb-1.0.dll')
            
            if os.path.exists(lib_path):
                self.backend = usb.backend.libusb1.get_backend(find_library=lambda x: lib_path)
            else:
                self.backend = usb.backend.libusb1.get_backend()
                
            if self.backend:
                logger.info("SafeTester", "initialize_backend", "USB backend initialized successfully")
                return True
            else:
                logger.error("SafeTester", "initialize_backend", "Failed to initialize USB backend")
                return False
                
        except Exception as e:
            logger.error("SafeTester", "initialize_backend", f"Backend initialization error: {e}")
            return False
    
    def connect_device(self) -> bool:
        """Connect to device with error handling"""
        try:
            if self.device:
                try:
                    self.device.disconnect()
                except:
                    pass
                    
            self.device = HiDockJensen(self.backend)
            if self.device.connect():
                logger.info("SafeTester", "connect_device", "Device connected successfully")
                return True
            else:
                logger.error("SafeTester", "connect_device", "Device connection failed")
                return False
                
        except Exception as e:
            logger.error("SafeTester", "connect_device", f"Connection error: {e}")
            return False
    
    def test_device_health(self) -> bool:
        """Test if device is responsive"""
        try:
            # Try a safe command (Command 1 - GET_DEVICE_INFO)
            response = self.device._send_and_receive(1, b"", timeout_ms=2000)
            if response:
                logger.info("SafeTester", "test_device_health", "Device health check PASSED")
                return True
            else:
                logger.warning("SafeTester", "test_device_health", "Device health check FAILED - no response")
                return False
                
        except Exception as e:
            logger.warning("SafeTester", "test_device_health", f"Device health check FAILED - {e}")
            return False
    
    def attempt_device_recovery(self) -> bool:
        """Attempt to recover device connection"""
        logger.info("SafeTester", "attempt_device_recovery", f"Attempting device recovery (attempt {self.recovery_count + 1})")
        
        try:
            # Disconnect current connection
            if self.device:
                try:
                    self.device.disconnect()
                except:
                    pass
            
            # Wait for device to reset
            time.sleep(3)
            
            # Reconnect
            if self.connect_device():
                if self.test_device_health():
                    self.recovery_count += 1
                    logger.info("SafeTester", "attempt_device_recovery", "Device recovery SUCCESSFUL")
                    return True
            
            logger.error("SafeTester", "attempt_device_recovery", "Device recovery FAILED")
            return False
            
        except Exception as e:
            logger.error("SafeTester", "attempt_device_recovery", f"Recovery error: {e}")
            return False
    
    def safe_command_test(self, command_id: int, parameters: bytes, description: str = "") -> Dict[str, Any]:
        """
        Safely test a command with automatic recovery
        
        Returns detailed test result dictionary
        """
        test_start = time.time()
        result = {
            'timestamp': datetime.now().isoformat(),
            'command_id': command_id,
            'parameters': parameters.hex() if parameters else '',
            'parameter_length': len(parameters),
            'description': description,
            'status': 'unknown',
            'response': None,
            'error': None,
            'response_time': 0,
            'recovery_required': False,
            'device_healthy_after': False
        }
        
        try:
            logger.info("SafeTester", "safe_command_test", 
                       f"Testing Command {command_id} with {len(parameters)} bytes: {description}")
            
            # Pre-test health check
            if not self.test_device_health():
                if not self.attempt_device_recovery():
                    result['status'] = 'device_unhealthy'
                    result['error'] = 'Device not responsive before test'
                    return result
            
            # Execute the command with timeout
            start_time = time.time()
            response = self.device._send_and_receive(command_id, parameters, timeout_ms=int(self.test_timeout * 1000))
            elapsed_time = time.time() - start_time
            
            result['response_time'] = elapsed_time
            
            if response:
                result['status'] = 'success'
                result['response'] = self._format_response(response)
                logger.info("SafeTester", "safe_command_test", 
                           f"Command {command_id} SUCCESS: Response in {elapsed_time:.2f}s")
            else:
                result['status'] = 'no_response'
                logger.info("SafeTester", "safe_command_test", 
                           f"Command {command_id} NO_RESPONSE in {elapsed_time:.2f}s")
            
            # Post-test health check
            time.sleep(1)  # Give device time to recover
            result['device_healthy_after'] = self.test_device_health()
            
        except Exception as e:
            result['status'] = 'error'
            result['error'] = str(e)
            result['response_time'] = time.time() - start_time
            
            logger.warning("SafeTester", "safe_command_test", 
                          f"Command {command_id} ERROR: {e}")
            
            # Check if device recovery is needed
            time.sleep(2)  # Wait for device to settle
            if not self.test_device_health():
                logger.info("SafeTester", "safe_command_test", "Device requires recovery")
                result['recovery_required'] = True
                
                if self.recovery_count < self.max_recovery_attempts:
                    if self.attempt_device_recovery():
                        result['device_healthy_after'] = True
                    else:
                        result['device_healthy_after'] = False
                        logger.error("SafeTester", "safe_command_test", 
                                   "CRITICAL: Device recovery failed")
                else:
                    result['device_healthy_after'] = False
                    logger.error("SafeTester", "safe_command_test", 
                               f"CRITICAL: Max recovery attempts ({self.max_recovery_attempts}) reached")
            else:
                result['device_healthy_after'] = True
        
        # Log result
        self.test_results.append(result)
        return result
    
    def _format_response(self, response) -> Dict[str, Any]:
        """Format response for logging"""
        if isinstance(response, dict):
            formatted = {
                'type': 'structured',
                'command_id': response.get('id', 'unknown'),
                'sequence': response.get('sequence', 'unknown'),
                'body_length': len(response.get('body', b'')),
            }
            
            body = response.get('body', b'')
            if body:
                formatted['body_hex'] = body.hex()
                if len(body) <= 32:
                    formatted['body_ascii'] = ''.join(chr(b) if 32 <= b <= 126 else '.' for b in body)
            else:
                formatted['body_hex'] = ''
                
            return formatted
        else:
            return {
                'type': 'raw',
                'data': str(response)
            }
    
    def run_parameter_test_batch(self, command_id: int, parameter_list: List[Tuple[bytes, str]]) -> List[Dict[str, Any]]:
        """
        Run a batch of parameter tests for a command
        
        Args:
            command_id: Command to test
            parameter_list: List of (parameters, description) tuples
        
        Returns:
            List of test results
        """
        batch_results = []
        
        logger.info("SafeTester", "run_parameter_test_batch", 
                   f"Starting batch test of Command {command_id} with {len(parameter_list)} parameter sets")
        
        for i, (parameters, description) in enumerate(parameter_list):
            print(f"\nTest {i+1}/{len(parameter_list)}: {description}")
            print(f"Parameters: {parameters.hex() if parameters else 'empty'} ({len(parameters)} bytes)")
            
            result = self.safe_command_test(command_id, parameters, description)
            batch_results.append(result)
            
            print(f"Result: {result['status']}")
            if result['status'] == 'success':
                print(f"Response time: {result['response_time']:.2f}s")
                if result['response']:
                    print(f"Response: {result['response']}")
            elif result['status'] == 'error':
                print(f"Error: {result['error']}")
            
            if result['recovery_required']:
                print("⚠️  Device recovery was required")
            
            if not result['device_healthy_after']:
                print("❌ CRITICAL: Device not healthy after test")
                break
            
            # Small delay between tests
            time.sleep(1)
        
        return batch_results
    
    def save_results(self, filename: str = None) -> str:
        """Save test results to file"""
        if filename is None:
            filename = f"command_10_discovery_{self.session_id}.json"
        
        filepath = os.path.join(os.path.dirname(__file__), filename)
        
        session_data = {
            'session_info': {
                'session_id': self.session_id,
                'start_time': self.session_start.isoformat(),
                'end_time': datetime.now().isoformat(),
                'total_tests': len(self.test_results),
                'recovery_attempts': self.recovery_count,
                'max_recovery_attempts': self.max_recovery_attempts
            },
            'test_results': self.test_results
        }
        
        try:
            with open(filepath, 'w') as f:
                json.dump(session_data, f, indent=2)
            
            logger.info("SafeTester", "save_results", f"Results saved to {filepath}")
            return filepath
        except Exception as e:
            logger.error("SafeTester", "save_results", f"Failed to save results: {e}")
            return ""
    
    def generate_summary_report(self) -> str:
        """Generate human-readable summary of test results"""
        if not self.test_results:
            return "No test results available"
        
        total_tests = len(self.test_results)
        success_count = len([r for r in self.test_results if r['status'] == 'success'])
        error_count = len([r for r in self.test_results if r['status'] == 'error'])
        no_response_count = len([r for r in self.test_results if r['status'] == 'no_response'])
        recovery_count = len([r for r in self.test_results if r['recovery_required']])
        
        summary = f"""
Command 10 Parameter Discovery - Test Summary
============================================
Session: {self.session_id}
Duration: {self.session_start} to {datetime.now()}

Test Results:
- Total tests: {total_tests}
- Successful responses: {success_count}
- Errors (with recovery): {error_count}
- No responses: {no_response_count}  
- Recovery required: {recovery_count}

Success Rate: {(success_count/total_tests)*100:.1f}%
Device Recovery Rate: {(recovery_count/max(1, error_count))*100:.1f}%

Promising Results:
"""
        
        # Find successful tests
        successful_tests = [r for r in self.test_results if r['status'] == 'success']
        if successful_tests:
            summary += "\n✅ SUCCESS - Command 10 responded to these parameters:\n"
            for result in successful_tests:
                summary += f"  - {result['description']}: {result['parameters']} -> {result['response']}\n"
        else:
            summary += "\n❌ No successful Command 10 responses found\n"
        
        # Find interesting errors
        error_tests = [r for r in self.test_results if r['status'] == 'error' and not r['recovery_required']]
        if error_tests:
            summary += "\n🔍 ERRORS (without device failure - potentially interesting):\n"
            for result in error_tests[:5]:  # Show first 5
                summary += f"  - {result['description']}: {result['error']}\n"
        
        return summary
    
    def cleanup(self):
        """Clean up resources"""
        try:
            if self.device:
                self.device.disconnect()
                logger.info("SafeTester", "cleanup", "Device disconnected")
        except:
            pass