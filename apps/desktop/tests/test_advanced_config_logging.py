"""
Advanced tests for configuration and logging functionality.
"""

import json
import os
import tempfile
import logging
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, mock_open
import copy

import pytest


class TestConfigurationManagement:
    """Advanced tests for configuration management."""

    @pytest.fixture
    def mock_default_config(self):
        """Mock default configuration."""
        return {
            "application": {
                "name": "HiDock Explorer",
                "version": "1.0.0",
                "debug_mode": False,
                "auto_save_interval": 300
            },
            "device": {
                "vendor_id": "0x1234",
                "product_id": "0x5678",
                "auto_connect": True,
                "connection_timeout": 10,
                "retry_attempts": 3
            },
            "audio": {
                "default_format": "WAV",
                "sample_rate": 44100,
                "bit_depth": 16,
                "quality": "high"
            },
            "ui": {
                "theme": "dark",
                "window_geometry": "1024x768+100+100",
                "show_advanced_options": False,
                "language": "en"
            },
            "storage": {
                "download_directory": "~/Downloads/HiDock",
                "auto_cleanup": True,
                "max_storage_gb": 10,
                "compression_enabled": False
            }
        }

    @pytest.fixture
    def mock_user_config(self):
        """Mock user-modified configuration."""
        return {
            "ui": {
                "theme": "light",
                "window_geometry": "1280x720+200+150"
            },
            "storage": {
                "download_directory": "/home/user/Music",
                "max_storage_gb": 20
            }
        }

    @pytest.mark.unit
    def test_config_loading_logic(self, mock_default_config):
        """Test configuration loading logic."""
        config_sources = [
            {"source": "defaults", "config": mock_default_config, "priority": 1},
            {"source": "system", "config": {}, "priority": 2},
            {"source": "user", "config": {"ui": {"theme": "light"}}, "priority": 3}
        ]
        
        # Merge configurations by priority
        final_config = {}
        for source in sorted(config_sources, key=lambda x: x["priority"]):
            final_config = deep_merge_dict(final_config, source["config"])
        
        assert final_config["ui"]["theme"] == "light"  # User override
        assert final_config["device"]["auto_connect"] is True  # Default value
        assert final_config["application"]["name"] == "HiDock Explorer"

    @pytest.mark.unit
    def test_config_validation_logic(self, mock_default_config):
        """Test configuration validation logic."""
        config = mock_default_config.copy()
        validation_errors = []
        
        # Validate vendor/product IDs
        try:
            vendor_id = int(config["device"]["vendor_id"], 16)
            product_id = int(config["device"]["product_id"], 16)
            if not (0x0000 <= vendor_id <= 0xFFFF):
                validation_errors.append("Invalid vendor ID range")
            if not (0x0000 <= product_id <= 0xFFFF):
                validation_errors.append("Invalid product ID range")
        except ValueError:
            validation_errors.append("Invalid hex format for device IDs")
        
        # Validate audio settings
        valid_sample_rates = [8000, 16000, 22050, 44100, 48000]
        if config["audio"]["sample_rate"] not in valid_sample_rates:
            validation_errors.append("Invalid sample rate")
        
        valid_bit_depths = [8, 16, 24, 32]
        if config["audio"]["bit_depth"] not in valid_bit_depths:
            validation_errors.append("Invalid bit depth")
        
        # Validate storage settings
        if config["storage"]["max_storage_gb"] <= 0:
            validation_errors.append("Invalid storage limit")
        
        assert len(validation_errors) == 0  # All settings should be valid

    @pytest.mark.unit
    def test_config_migration_logic(self):
        """Test configuration migration logic."""
        # Old configuration format (v1.0)
        old_config = {
            "version": "1.0",
            "device_vendor": "0x1234",
            "device_product": "0x5678",
            "download_path": "/old/downloads",
            "theme": "dark"
        }
        
        # Migration rules
        migration_map = {
            "device_vendor": "device.vendor_id",
            "device_product": "device.product_id",
            "download_path": "storage.download_directory",
            "theme": "ui.theme"
        }
        
        # Perform migration
        new_config = {"version": "2.0"}
        for old_key, new_path in migration_map.items():
            if old_key in old_config:
                # Set nested value using path notation
                set_nested_value(new_config, new_path, old_config[old_key])
        
        assert new_config["device"]["vendor_id"] == "0x1234"
        assert new_config["storage"]["download_directory"] == "/old/downloads"
        assert new_config["version"] == "2.0"

    @pytest.mark.unit
    def test_config_backup_logic(self, mock_default_config):
        """Test configuration backup logic."""
        config = mock_default_config
        
        # Create backup metadata
        backup_info = {
            "timestamp": datetime.now().isoformat(),
            "config_version": config.get("version", "1.0"),
            "backup_reason": "auto_backup",
            "file_size": len(json.dumps(config, indent=2))
        }
        
        # Simulate backup rotation
        max_backups = 5
        existing_backups = [
            "config_backup_2024-01-01.json",
            "config_backup_2024-01-02.json",
            "config_backup_2024-01-03.json",
            "config_backup_2024-01-04.json",
            "config_backup_2024-01-05.json"
        ]
        
        if len(existing_backups) >= max_backups:
            # Remove oldest backup
            oldest_backup = sorted(existing_backups)[0]
            backups_to_remove = [oldest_backup]
        else:
            backups_to_remove = []
        
        assert len(backups_to_remove) == 1
        assert backups_to_remove[0] == "config_backup_2024-01-01.json"
        assert backup_info["backup_reason"] == "auto_backup"

    @pytest.mark.unit
    def test_config_environment_override(self, mock_default_config):
        """Test environment variable configuration override."""
        config = mock_default_config.copy()
        
        # Mock environment variables
        env_overrides = {
            "HIDOCK_DEBUG_MODE": "true",
            "HIDOCK_DOWNLOAD_DIR": "/env/downloads",
            "HIDOCK_THEME": "system",
            "HIDOCK_MAX_STORAGE": "50"
        }
        
        # Apply environment overrides
        env_mapping = {
            "HIDOCK_DEBUG_MODE": ("application.debug_mode", bool),
            "HIDOCK_DOWNLOAD_DIR": ("storage.download_directory", str),
            "HIDOCK_THEME": ("ui.theme", str),
            "HIDOCK_MAX_STORAGE": ("storage.max_storage_gb", int)
        }
        
        for env_var, (config_path, type_converter) in env_mapping.items():
            if env_var in env_overrides:
                value = env_overrides[env_var]
                if type_converter == bool:
                    converted_value = value.lower() in ("true", "1", "yes")
                elif type_converter == int:
                    converted_value = int(value)
                else:
                    converted_value = value
                
                set_nested_value(config, config_path, converted_value)
        
        assert config["application"]["debug_mode"] is True
        assert config["storage"]["download_directory"] == "/env/downloads"
        assert config["storage"]["max_storage_gb"] == 50

    @pytest.mark.unit
    def test_config_change_detection(self, mock_default_config):
        """Test configuration change detection logic."""
        original_config = copy.deepcopy(mock_default_config)
        modified_config = copy.deepcopy(mock_default_config)
        
        # Make some changes
        modified_config["ui"]["theme"] = "light"
        modified_config["storage"]["max_storage_gb"] = 20
        modified_config["device"]["auto_connect"] = False
        
        # Mock detect_config_changes function for this test
        def detect_config_changes(orig, mod):
            changes = []
            def compare_dicts(o, m, path=""):
                for key in set(o.keys()) | set(m.keys()):
                    current_path = f"{path}.{key}" if path else key
                    if key not in o:
                        changes.append({"path": current_path, "old": None, "new": m[key]})
                    elif key not in m:
                        changes.append({"path": current_path, "old": o[key], "new": None})
                    elif isinstance(o[key], dict) and isinstance(m[key], dict):
                        compare_dicts(o[key], m[key], current_path)
                    elif o[key] != m[key]:
                        changes.append({"path": current_path, "old": o[key], "new": m[key]})
            compare_dicts(orig, mod)
            return changes
        
        # Detect changes
        changes = detect_config_changes(original_config, modified_config)
        
        expected_changes = [
            {"path": "ui.theme", "old": "dark", "new": "light"},
            {"path": "storage.max_storage_gb", "old": 10, "new": 20},
            {"path": "device.auto_connect", "old": True, "new": False}
        ]
        
        assert len(changes) == 3
        assert any(change["path"] == "ui.theme" for change in changes)


class TestLoggingSystem:
    """Advanced tests for logging system."""

    @pytest.fixture
    def mock_log_config(self):
        """Mock logging configuration."""
        return {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "standard": {
                    "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                    "datefmt": "%Y-%m-%d %H:%M:%S"
                },
                "detailed": {
                    "format": "%(asctime)s [%(levelname)s] %(name)s:%(lineno)d - %(funcName)s() - %(message)s"
                }
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "level": "INFO",
                    "formatter": "standard"
                },
                "file": {
                    "class": "logging.FileHandler",
                    "filename": "hidock.log",
                    "level": "DEBUG",
                    "formatter": "detailed"
                },
                "rotating_file": {
                    "class": "logging.handlers.RotatingFileHandler",
                    "filename": "hidock_rotating.log",
                    "maxBytes": 1048576,  # 1MB
                    "backupCount": 5
                }
            },
            "loggers": {
                "hidock": {
                    "level": "DEBUG",
                    "handlers": ["console", "file"],
                    "propagate": False
                },
                "hidock.device": {
                    "level": "INFO",
                    "handlers": ["rotating_file"]
                }
            }
        }

    @pytest.mark.unit
    def test_log_level_filtering(self, mock_log_config):
        """Test log level filtering logic."""
        log_levels = {
            "DEBUG": 10,
            "INFO": 20,
            "WARNING": 30,
            "ERROR": 40,
            "CRITICAL": 50
        }
        
        # Test messages at different levels
        test_messages = [
            {"level": "DEBUG", "message": "Debug message"},
            {"level": "INFO", "message": "Info message"},
            {"level": "WARNING", "message": "Warning message"},
            {"level": "ERROR", "message": "Error message"}
        ]
        
        # Filter for INFO level and above
        min_level = log_levels["INFO"]
        filtered_messages = [
            msg for msg in test_messages
            if log_levels[msg["level"]] >= min_level
        ]
        
        assert len(filtered_messages) == 3  # INFO, WARNING, ERROR
        assert filtered_messages[0]["level"] == "INFO"

    @pytest.mark.unit
    def test_log_rotation_logic(self):
        """Test log rotation logic."""
        log_file_info = {
            "current_size": 1200000,  # 1.2MB
            "max_size": 1048576,      # 1MB
            "backup_count": 5,
            "existing_backups": [
                "hidock.log.1",
                "hidock.log.2",
                "hidock.log.3",
                "hidock.log.4"
            ]
        }
        
        # Check if rotation is needed
        needs_rotation = log_file_info["current_size"] > log_file_info["max_size"]
        
        if needs_rotation:
            # Simulate rotation process
            rotation_steps = []
            
            # Remove oldest backup if at limit
            if len(log_file_info["existing_backups"]) >= log_file_info["backup_count"]:
                oldest_backup = f"hidock.log.{log_file_info['backup_count']}"
                rotation_steps.append(f"remove_{oldest_backup}")
            
            # Rename existing backups
            for i in range(len(log_file_info["existing_backups"]), 0, -1):
                old_name = f"hidock.log.{i}"
                new_name = f"hidock.log.{i+1}"
                rotation_steps.append(f"rename_{old_name}_to_{new_name}")
            
            # Move current log to backup
            rotation_steps.append("rename_hidock.log_to_hidock.log.1")
            # Create new log file
            rotation_steps.append("create_new_hidock.log")
        
        assert needs_rotation is True
        assert len(rotation_steps) == 6  # Remove + 4 renames + move current + create new

    @pytest.mark.unit
    def test_log_formatting_logic(self, mock_log_config):
        """Test log message formatting logic."""
        formatter_config = mock_log_config["formatters"]["detailed"]
        format_string = formatter_config["format"]
        
        # Mock log record
        log_record = {
            "asctime": "2024-01-15 10:30:45",
            "levelname": "ERROR",
            "name": "hidock.device",
            "lineno": 123,
            "funcName": "connect_device",
            "message": "Failed to connect to device"
        }
        
        # Simulate formatting
        formatted_message = format_string % log_record
        expected = "2024-01-15 10:30:45 [ERROR] hidock.device:123 - connect_device() - Failed to connect to device"
        
        assert formatted_message == expected

    @pytest.mark.unit
    def test_structured_logging_logic(self):
        """Test structured logging logic."""
        # Structured log entry
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "level": "INFO",
            "logger": "hidock.audio",
            "event": "file_processed",
            "context": {
                "filename": "recording_001.wav",
                "duration": 120.5,
                "size_mb": 15.2,
                "processing_time": 2.3
            },
            "user_id": "user123",
            "session_id": "sess_abc123"
        }
        
        # Extract searchable fields
        searchable_fields = {
            "event_type": log_entry["event"],
            "filename": log_entry["context"]["filename"],
            "user_id": log_entry["user_id"],
            "duration": log_entry["context"]["duration"]
        }
        
        # Create search index entry
        index_entry = {
            "timestamp": log_entry["timestamp"],
            "level": log_entry["level"],
            "searchable": searchable_fields
        }
        
        assert index_entry["searchable"]["event_type"] == "file_processed"
        assert index_entry["searchable"]["filename"] == "recording_001.wav"

    @pytest.mark.unit
    def test_log_aggregation_logic(self):
        """Test log aggregation and metrics logic."""
        # Mock log entries for last hour
        log_entries = [
            {"timestamp": datetime.now() - timedelta(minutes=5), "level": "INFO"},
            {"timestamp": datetime.now() - timedelta(minutes=10), "level": "WARNING"},
            {"timestamp": datetime.now() - timedelta(minutes=15), "level": "ERROR"},
            {"timestamp": datetime.now() - timedelta(minutes=20), "level": "INFO"},
            {"timestamp": datetime.now() - timedelta(minutes=25), "level": "ERROR"},
            {"timestamp": datetime.now() - timedelta(minutes=30), "level": "DEBUG"}
        ]
        
        # Aggregate by level
        level_counts = {}
        for entry in log_entries:
            level = entry["level"]
            level_counts[level] = level_counts.get(level, 0) + 1
        
        # Calculate error rate
        total_entries = len(log_entries)
        error_entries = level_counts.get("ERROR", 0) + level_counts.get("CRITICAL", 0)
        error_rate = (error_entries / total_entries) * 100 if total_entries > 0 else 0
        
        assert level_counts["INFO"] == 2
        assert level_counts["ERROR"] == 2
        assert abs(error_rate - 33.33) < 0.01  # Approximately 33.3%

    @pytest.mark.unit
    def test_sensitive_data_filtering(self):
        """Test sensitive data filtering in logs."""
        # Log message with potentially sensitive data
        original_message = "User authenticated with password abc123 and API key sk-1234567890"
        
        # Sensitive data patterns
        sensitive_patterns = [
            (r'password\s+\w+', 'password [REDACTED]'),
            (r'api[_\s]key\s+sk-\w+', 'api_key [REDACTED]'),
            (r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b', '[CREDIT_CARD_REDACTED]'),
            (r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL_REDACTED]')
        ]
        
        # Apply filtering
        filtered_message = original_message
        for pattern, replacement in sensitive_patterns:
            import re
            filtered_message = re.sub(pattern, replacement, filtered_message, flags=re.IGNORECASE)
        
        assert "abc123" not in filtered_message
        assert "sk-1234567890" not in filtered_message
        assert "[REDACTED]" in filtered_message

    @pytest.mark.unit
    def test_log_compression_logic(self):
        """Test log file compression logic."""
        log_files = [
            {"name": "hidock.log.1", "size": 5242880, "age_days": 1},  # 5MB, 1 day old
            {"name": "hidock.log.2", "size": 3145728, "age_days": 3},  # 3MB, 3 days old
            {"name": "hidock.log.3", "size": 2097152, "age_days": 7},  # 2MB, 7 days old
            {"name": "hidock.log.4", "size": 1048576, "age_days": 14}  # 1MB, 14 days old
        ]
        
        # Compression criteria
        min_age_for_compression = 2  # days
        min_size_for_compression = 1048576  # 1MB
        
        files_to_compress = []
        for log_file in log_files:
            if (log_file["age_days"] >= min_age_for_compression and 
                log_file["size"] >= min_size_for_compression):
                files_to_compress.append(log_file["name"])
        
        assert len(files_to_compress) == 3  # All except the 1-day old file
        assert "hidock.log.1" not in files_to_compress

    @pytest.mark.integration
    def test_logging_performance_impact(self):
        """Test logging performance impact analysis."""
        import time
        
        # Simulate logging operations
        logging_operations = [
            {"operation": "format_message", "time_ms": 0.5},
            {"operation": "write_to_file", "time_ms": 2.1},
            {"operation": "rotate_file", "time_ms": 15.3},
            {"operation": "compress_old_log", "time_ms": 250.7}
        ]
        
        # Calculate performance metrics
        total_time = sum(op["time_ms"] for op in logging_operations)
        avg_time = total_time / len(logging_operations)
        
        # Identify performance bottlenecks
        bottlenecks = [
            op for op in logging_operations 
            if op["time_ms"] > avg_time * 2
        ]
        
        # Performance recommendations
        recommendations = []
        if any(op["operation"] == "compress_old_log" for op in bottlenecks):
            recommendations.append("compress_logs_async")
        if any(op["operation"] == "rotate_file" for op in bottlenecks):
            recommendations.append("optimize_rotation")
        
        assert abs(total_time - 268.6) < 0.01
        assert len(bottlenecks) == 1  # compress_old_log is the bottleneck
        assert "compress_logs_async" in recommendations


# Helper functions for configuration tests
def deep_merge_dict(base_dict, update_dict):
    """Deep merge two dictionaries."""
    result = base_dict.copy()
    for key, value in update_dict.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge_dict(result[key], value)
        else:
            result[key] = value
    return result


def set_nested_value(dictionary, path, value):
    """Set a nested dictionary value using dot notation path."""
    keys = path.split('.')
    current = dictionary
    for key in keys[:-1]:
        if key not in current:
            current[key] = {}
        current = current[key]
    current[keys[-1]] = value


def detect_config_changes(original, modified, path=""):
    """Detect changes between two configuration dictionaries."""
    changes = []
    
    # Check for modified values
    for key in original:
        current_path = f"{path}.{key}" if path else key
        if key in modified:
            if isinstance(original[key], dict) and isinstance(modified[key], dict):
                changes.extend(detect_config_changes(original[key], modified[key], current_path))
            elif original[key] != modified[key]:
                changes.append({
                    "path": current_path,
                    "old": original[key],
                    "new": modified[key]
                })
    
    return changes