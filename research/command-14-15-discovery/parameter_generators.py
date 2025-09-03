#!/usr/bin/env python3
"""
Parameter Generators for Command 10 Discovery

This module generates systematic parameter combinations for testing
Command 10 based on various hypotheses about its function.

Author: HiDock Research Project
Version: 1.0.0
Date: 2025-08-31
"""

import struct
import time
import itertools
from typing import List, Tuple, Generator

class ParameterGenerator:
    """Generate systematic parameter combinations for Command 10 testing"""
    
    def __init__(self):
        # Common patterns found in embedded systems
        self.magic_numbers = [
            0x12345678, 0xDEADBEEF, 0xCAFEBABE, 0xFEEDFACE,
            0x8BADF00D, 0xABADCAFE, 0xB16B00B5, 0xBAADF00D,
            0x0000BEEF, 0x1234ABCD, 0xAAAABBBB, 0x55555555
        ]
        
        # HiDock specific patterns (from firmware analysis)
        self.hidock_patterns = [
            0x1234,      # Jensen protocol magic
            0x10D6,      # Vendor ID
            0xB00D,      # Product ID
            0x060205,    # Version 6.2.5
            0x60205,     # Version code
            0x393733     # Build number
        ]
        
        # Common authentication patterns
        self.auth_patterns = [
            b'AUTH', b'PASS', b'UNLOCK', b'DEBUG', b'TEST',
            b'FACTORY', b'ADMIN', b'ROOT', b'SUPER', b'MASTER'
        ]
    
    def generate_empty_and_single_bytes(self) -> List[Tuple[bytes, str]]:
        """Generate empty and single byte parameters"""
        params = []
        
        # Empty parameter (we know this fails)
        params.append((b'', 'Empty parameters (known to fail)'))
        
        # Single bytes
        for i in [0x00, 0x01, 0x02, 0x0A, 0x0F, 0x10, 0x20, 0xFF]:
            params.append((bytes([i]), f'Single byte 0x{i:02X}'))
        
        return params
    
    def generate_magic_number_patterns(self) -> List[Tuple[bytes, str]]:
        """Generate magic number based parameters"""
        params = []
        
        # Standard magic numbers as 32-bit little endian
        for magic in self.magic_numbers:
            params.append((struct.pack('<I', magic), f'Magic number 0x{magic:08X} (32-bit LE)'))
        
        # HiDock specific patterns
        for pattern in self.hidock_patterns:
            params.append((struct.pack('<I', pattern), f'HiDock pattern 0x{pattern:08X}'))
            if pattern <= 0xFFFF:
                params.append((struct.pack('<H', pattern), f'HiDock pattern 0x{pattern:04X} (16-bit)'))
        
        return params
    
    def generate_command_subcommand_patterns(self) -> List[Tuple[bytes, str]]:
        """Generate command/subcommand structure parameters"""
        params = []
        
        # Command 10 with subcommands
        for subcmd in range(0, 16):
            # 16-bit command + 16-bit subcommand
            params.append((struct.pack('<HH', 10, subcmd), f'Command 10, subcommand {subcmd}'))
        
        # Extended subcommands
        for subcmd in [0x10, 0x20, 0xFF, 0x100, 0x200, 0xFFFF]:
            params.append((struct.pack('<HH', 10, subcmd), f'Command 10, extended subcommand 0x{subcmd:04X}'))
        
        return params
    
    def generate_authentication_patterns(self) -> List[Tuple[bytes, str]]:
        """Generate authentication-style parameters"""
        params = []
        
        # Text-based authentication
        for auth in self.auth_patterns:
            params.append((auth, f'Text auth: {auth.decode()}'))
            # With null terminator
            params.append((auth + b'\x00', f'Text auth (null-term): {auth.decode()}'))
        
        # Numeric authentication patterns
        auth_numbers = [
            0x12345678, 0x87654321, 0xAAAAAAAA, 0x55555555,
            0x00000001, 0xFFFFFFFF, 0x12341234, 0xABCDABCD
        ]
        
        for auth in auth_numbers:
            params.append((struct.pack('<I', auth), f'Auth key 0x{auth:08X}'))
        
        return params
    
    def generate_memory_address_patterns(self) -> List[Tuple[bytes, str]]:
        """Generate memory address and length parameters"""
        params = []
        
        # Common ARM memory addresses from firmware analysis
        addresses = [
            0x20000000,  # SRAM base
            0x08000000,  # Flash base
            0x40000000,  # Peripheral base
            0x00000000,  # ROM/Vector table
            0x90000000,  # External storage (hypothetical)
        ]
        
        # Standard read lengths
        lengths = [1, 4, 16, 32, 64, 256, 1024]
        
        for addr in addresses:
            for length in lengths:
                params.append((struct.pack('<II', addr, length), 
                             f'Memory read: addr=0x{addr:08X}, len={length}'))
        
        return params
    
    def generate_device_state_patterns(self) -> List[Tuple[bytes, str]]:
        """Generate device state and configuration parameters"""
        params = []
        
        # Device state queries
        state_queries = [
            (0x01, 'Query device state'),
            (0x02, 'Query hardware status'),
            (0x03, 'Query debug state'),
            (0x04, 'Query factory mode'),
            (0x05, 'Query test mode'),
        ]
        
        for value, desc in state_queries:
            params.append((struct.pack('<I', value), desc))
        
        # Configuration parameters
        config_patterns = [
            (struct.pack('<II', 0x01, 0x01), 'Enable debug mode'),
            (struct.pack('<II', 0x01, 0x00), 'Disable debug mode'),
            (struct.pack('<II', 0x02, 0x01), 'Enable factory mode'),
            (struct.pack('<II', 0x03, 0x01), 'Enable test mode'),
            (struct.pack('<II', 0xFF, 0xFF), 'Enable all modes'),
        ]
        
        params.extend(config_patterns)
        return params
    
    def generate_timing_based_patterns(self) -> List[Tuple[bytes, str]]:
        """Generate timestamp and timing based parameters"""
        params = []
        
        # Current timestamp
        current_time = int(time.time())
        params.append((struct.pack('<I', current_time), f'Current timestamp: {current_time}'))
        
        # Device epoch (common embedded epoch times)
        epochs = [
            0,           # Unix epoch
            946684800,   # Y2K epoch
            1577836800,  # 2020 epoch
            current_time # Current time
        ]
        
        for epoch in epochs:
            params.append((struct.pack('<I', epoch), f'Timestamp: {epoch}'))
            # 64-bit timestamps
            params.append((struct.pack('<Q', epoch), f'Timestamp (64-bit): {epoch}'))
        
        return params
    
    def generate_protocol_handshake_patterns(self) -> List[Tuple[bytes, str]]:
        """Generate protocol handshake patterns"""
        params = []
        
        # Jensen protocol handshake attempts
        jensen_handshakes = [
            (struct.pack('<HH', 0x1234, 0x0010), 'Jensen magic + Command 10'),
            (struct.pack('<HH', 0x1234, 0x5678), 'Jensen magic + response pattern'),
            (struct.pack('<I', 0x12345678), 'Extended Jensen magic'),
        ]
        
        params.extend(jensen_handshakes)
        
        # Device identification handshakes
        device_patterns = [
            (struct.pack('<HH', 0x10D6, 0xB00D), 'VID + PID'),
            (struct.pack('<I', 0xB00D10D6), 'PID + VID combined'),
        ]
        
        params.extend(device_patterns)
        return params
    
    def generate_bootloader_patterns(self) -> List[Tuple[bytes, str]]:
        """Generate bootloader and firmware update patterns"""
        params = []
        
        # Bootloader commands (inspired by Command 8/9 firmware update)
        bootloader_patterns = [
            (b'BOOT', 'Bootloader mode text'),
            (b'FWUP', 'Firmware update text'),
            (b'RECOVERY', 'Recovery mode text'),
            (struct.pack('<I', 0xB007), 'Bootloader magic (BOOT)'),
            (struct.pack('<I', 0x12345678), 'Firmware magic'),
        ]
        
        params.extend(bootloader_patterns)
        return params
    
    def generate_systematic_exploration(self, max_params: int = 100) -> List[Tuple[bytes, str]]:
        """Generate comprehensive systematic parameter exploration"""
        all_params = []
        
        # Collect all parameter types
        generators = [
            self.generate_empty_and_single_bytes(),
            self.generate_magic_number_patterns(),
            self.generate_command_subcommand_patterns(),
            self.generate_authentication_patterns(),
            self.generate_memory_address_patterns(),
            self.generate_device_state_patterns(),
            self.generate_timing_based_patterns(),
            self.generate_protocol_handshake_patterns(),
            self.generate_bootloader_patterns(),
        ]
        
        # Combine all parameters
        for generator_params in generators:
            all_params.extend(generator_params)
        
        # Limit to avoid excessive testing
        if len(all_params) > max_params:
            # Prioritize: take samples from each category
            samples_per_category = max_params // len(generators)
            limited_params = []
            
            for generator_params in generators:
                limited_params.extend(generator_params[:samples_per_category])
            
            all_params = limited_params[:max_params]
        
        return all_params
    
    def generate_focused_discovery(self) -> List[Tuple[bytes, str]]:
        """Generate focused parameter set for initial discovery"""
        params = []
        
        # High-priority patterns most likely to work
        high_priority = [
            # Jensen protocol patterns
            (struct.pack('<HH', 0x1234, 0x0010), 'Jensen magic + Command 10'),
            (struct.pack('<I', 0x1234), 'Jensen magic (32-bit)'),
            
            # Authentication attempts
            (struct.pack('<I', 0x12345678), 'Standard magic number'),
            (b'DEBUG', 'Debug mode text'),
            (b'ADMIN', 'Admin access text'),
            
            # Command/subcommand structure
            (struct.pack('<HH', 10, 0), 'Command 10, subcommand 0'),
            (struct.pack('<HH', 10, 1), 'Command 10, subcommand 1'),
            
            # Device specific
            (struct.pack('<HH', 0x10D6, 0xB00D), 'VID + PID'),
            (struct.pack('<I', 0x60205), 'Firmware version code'),
            
            # Simple state queries
            (struct.pack('<I', 1), 'Query state 1'),
            (struct.pack('<I', 0), 'Query state 0'),
        ]
        
        params.extend(high_priority)
        return params
    
    def generate_parameter_bruteforce(self, byte_length: int, max_combinations: int = 50) -> List[Tuple[bytes, str]]:
        """Generate brute force parameter combinations for specific byte lengths"""
        params = []
        
        if byte_length == 1:
            # Single byte brute force
            for i in range(0, min(256, max_combinations)):
                params.append((bytes([i]), f'Brute force byte: 0x{i:02X}'))
        
        elif byte_length == 2:
            # Two byte brute force (limited)
            common_16bit = [
                0x0000, 0x0001, 0x000A, 0x0010, 0x0100, 0x1000,
                0x1234, 0xABCD, 0xFFFF, 0x8000, 0x4000, 0x2000
            ]
            for value in common_16bit[:max_combinations]:
                params.append((struct.pack('<H', value), f'Brute force 16-bit: 0x{value:04X}'))
        
        elif byte_length == 4:
            # Four byte brute force (very limited)
            common_32bit = self.magic_numbers + self.hidock_patterns
            for value in common_32bit[:max_combinations]:
                params.append((struct.pack('<I', value), f'Brute force 32-bit: 0x{value:08X}'))
        
        return params