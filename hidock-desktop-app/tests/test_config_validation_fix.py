#!/usr/bin/env python3
"""
Test for configuration validation fix to prevent TclError from invalid boolean values.

This test follows TDD principles to ensure the config loading handles invalid data types gracefully.
"""

import pytest
import tempfile
import json
import os
from unittest.mock import patch
import customtkinter as ctk


class TestConfigValidation:
    """Test configuration validation and sanitization."""

    def test_config_with_invalid_boolean_values(self):
        """Test that load_config handles invalid boolean values gracefully."""
        
        # Create a temporary config file with invalid boolean values (reproduces the bug)
        invalid_config = {
            "autoconnect": "test_value",  # This should be boolean
            "quit_without_prompt_if_connected": "invalid",  # This should be boolean
            "auto_refresh_files": "not_boolean",  # This should be boolean
            "logs_pane_visible": "test_value",  # This should be boolean
            "loop_playback": 123,  # This should be boolean
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(invalid_config, f)
            temp_config_path = f.name
        
        try:
            # Mock the config file path to use our temporary file
            with patch('config_and_logger._CONFIG_FILE_PATH', temp_config_path):
                from config_and_logger import load_config
                
                # Load config - this should not crash and should provide valid defaults
                config = load_config()
                
                # Verify that invalid values are replaced with proper boolean defaults
                assert isinstance(config["autoconnect"], bool)
                assert config["autoconnect"] is False  # Default value
                
                assert isinstance(config["quit_without_prompt_if_connected"], bool)
                assert config["quit_without_prompt_if_connected"] is False  # Default value
                
                assert isinstance(config["auto_refresh_files"], bool)
                assert config["auto_refresh_files"] is False  # Default value
                
                assert isinstance(config["logs_pane_visible"], bool)
                assert config["logs_pane_visible"] is False  # Default value
                
                assert isinstance(config["loop_playback"], bool)
                assert config["loop_playback"] is False  # Default value
                
        finally:
            # Clean up
            os.unlink(temp_config_path)

    def test_config_with_valid_boolean_strings(self):
        """Test that valid boolean strings are converted correctly."""
        
        valid_string_config = {
            "autoconnect": "true",
            "quit_without_prompt_if_connected": "false", 
            "auto_refresh_files": "1",
            "logs_pane_visible": "0",
            "loop_playback": "yes",
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(valid_string_config, f)
            temp_config_path = f.name
        
        try:
            with patch('config_and_logger._CONFIG_FILE_PATH', temp_config_path):
                from config_and_logger import load_config
                
                config = load_config()
                
                # Verify string-to-boolean conversion works
                assert config["autoconnect"] is True
                assert config["quit_without_prompt_if_connected"] is False
                assert config["auto_refresh_files"] is True
                assert config["logs_pane_visible"] is False
                assert config["loop_playback"] is True
                
        finally:
            os.unlink(temp_config_path)

    def test_gui_initialization_with_invalid_config(self):
        """Test that GUI initialization handles invalid config values without TclError."""
        
        # Create invalid config similar to the one causing the original issue
        invalid_config = {
            "autoconnect": "test_value",
            "quit_without_prompt_if_connected": "test_value",
            "auto_refresh_files": "test_value",
            "logs_pane_visible": "test_value",
            "loop_playback": "test_value",
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(invalid_config, f)
            temp_config_path = f.name
        
        try:
            # Mock the config file path
            with patch('config_and_logger._CONFIG_FILE_PATH', temp_config_path):
                from config_and_logger import load_config
                
                config = load_config()
                
                # Test that we can create CTk variables without TclError
                root = ctk.CTk()
                try:
                    # These should not raise TclError anymore
                    autoconnect_var = ctk.BooleanVar(value=config.get("autoconnect", False))
                    quit_var = ctk.BooleanVar(value=config.get("quit_without_prompt_if_connected", False))
                    refresh_var = ctk.BooleanVar(value=config.get("auto_refresh_files", False))
                    logs_var = ctk.BooleanVar(value=config.get("logs_pane_visible", False))
                    loop_var = ctk.BooleanVar(value=config.get("loop_playback", False))
                    
                    # Verify the variables have correct boolean values
                    assert isinstance(autoconnect_var.get(), bool)
                    assert isinstance(quit_var.get(), bool)
                    assert isinstance(refresh_var.get(), bool)
                    assert isinstance(logs_var.get(), bool)
                    assert isinstance(loop_var.get(), bool)
                    
                finally:
                    root.destroy()
                    
        finally:
            # Clean up
            os.unlink(temp_config_path)

    def test_config_with_invalid_numeric_values(self):
        """Test that invalid numeric values are handled correctly."""
        
        invalid_config = {
            "selected_vid": "not_a_number",
            "selected_pid": "invalid",
            "recording_check_interval_s": "abc",
            "playback_volume": "not_float",
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(invalid_config, f)
            temp_config_path = f.name
        
        try:
            with patch('config_and_logger._CONFIG_FILE_PATH', temp_config_path):
                from config_and_logger import load_config
                
                config = load_config()
                
                # Verify that invalid numeric values are replaced with defaults
                assert isinstance(config["selected_vid"], int)
                assert isinstance(config["selected_pid"], int)
                assert isinstance(config["recording_check_interval_s"], int)
                assert isinstance(config["playback_volume"], (int, float))
                
        finally:
            os.unlink(temp_config_path)

    def test_config_with_invalid_enum_values(self):
        """Test that invalid enum values are handled correctly."""
        
        invalid_config = {
            "log_level": "INVALID_LEVEL",
            "appearance_mode": "InvalidMode",
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(invalid_config, f)
            temp_config_path = f.name
        
        try:
            with patch('config_and_logger._CONFIG_FILE_PATH', temp_config_path):
                from config_and_logger import load_config
                
                config = load_config()
                
                # Verify that invalid enum values are replaced with defaults
                assert config["log_level"] in ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
                assert config["log_level"] == "INFO"  # Default value
                
                assert config["appearance_mode"] in ["Light", "Dark", "System"]
                assert config["appearance_mode"] == "System"  # Default value
                
        finally:
            os.unlink(temp_config_path)