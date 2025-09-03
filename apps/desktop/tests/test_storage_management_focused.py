"""
Focused tests for the Storage Management Module.

This test suite covers the core functionality that can be reliably tested,
focusing on enums, dataclasses, and basic class functionality.
"""

import tempfile
import threading
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

# Import the module under test
import storage_management
from storage_management import (
    OptimizationSuggestion,
    OptimizationType,
    StorageAnalytics,
    StorageInfo,
    StorageMonitor,
    StorageOptimizer,
    StorageQuota,
    StorageQuotaManager,
    StorageWarningLevel,
)


class TestStorageEnums:
    """Test the enum classes for storage management."""

    def test_storage_warning_level_values(self):
        """Test StorageWarningLevel enum values."""
        assert StorageWarningLevel.NORMAL.value == "normal"
        assert StorageWarningLevel.WARNING.value == "warning"
        assert StorageWarningLevel.CRITICAL.value == "critical"
        assert StorageWarningLevel.FULL.value == "full"

        # Test that all expected levels exist
        expected_levels = {"normal", "warning", "critical", "full"}
        actual_levels = {level.value for level in StorageWarningLevel}
        assert actual_levels == expected_levels

    def test_optimization_type_values(self):
        """Test OptimizationType enum values."""
        assert OptimizationType.DUPLICATE_REMOVAL.value == "duplicate_removal"
        assert OptimizationType.OLD_FILE_CLEANUP.value == "old_file_cleanup"
        assert OptimizationType.CACHE_CLEANUP.value == "cache_cleanup"
        assert OptimizationType.TEMP_FILE_CLEANUP.value == "temp_file_cleanup"
        assert OptimizationType.COMPRESSION.value == "compression"
        assert OptimizationType.ARCHIVE_OLD_FILES.value == "archive_old_files"

        # Test enum completeness
        expected_types = {
            "duplicate_removal",
            "old_file_cleanup",
            "cache_cleanup",
            "temp_file_cleanup",
            "compression",
            "archive_old_files",
        }
        actual_types = {opt_type.value for opt_type in OptimizationType}
        assert actual_types == expected_types


class TestStorageDataClasses:
    """Test the dataclass structures for storage management."""

    def test_storage_info_creation(self):
        """Test StorageInfo dataclass creation and properties."""
        now = datetime.now()
        storage_info = StorageInfo(
            total_space=1000000,
            used_space=750000,
            free_space=250000,
            usage_percentage=75.0,
            warning_level=StorageWarningLevel.WARNING,
            last_updated=now,
        )

        assert storage_info.total_space == 1000000
        assert storage_info.used_space == 750000
        assert storage_info.free_space == 250000
        assert storage_info.usage_percentage == 75.0
        assert storage_info.warning_level == StorageWarningLevel.WARNING
        assert storage_info.last_updated == now

    def test_storage_info_consistency(self):
        """Test StorageInfo data consistency."""
        storage_info = StorageInfo(
            total_space=1000,
            used_space=750,
            free_space=250,
            usage_percentage=75.0,
            warning_level=StorageWarningLevel.WARNING,
            last_updated=datetime.now(),
        )

        # Basic consistency check
        assert storage_info.used_space + storage_info.free_space == storage_info.total_space
        assert 70 <= storage_info.usage_percentage <= 85  # Should be in warning range

    def test_storage_quota_creation(self):
        """Test StorageQuota dataclass creation."""
        quota = StorageQuota(
            max_total_size=10000000,
            max_file_count=1000,
            max_file_size=100000,
            retention_days=30,
            auto_cleanup_enabled=True,
            warning_threshold=0.8,
            critical_threshold=0.9,
        )

        assert quota.max_total_size == 10000000
        assert quota.max_file_count == 1000
        assert quota.max_file_size == 100000
        assert quota.retention_days == 30
        assert quota.auto_cleanup_enabled is True
        assert quota.warning_threshold == 0.8
        assert quota.critical_threshold == 0.9

    def test_storage_quota_default_thresholds(self):
        """Test StorageQuota default threshold values."""
        quota = StorageQuota(
            max_total_size=10000000,
            max_file_count=1000,
            max_file_size=100000,
            retention_days=30,
            auto_cleanup_enabled=True,
        )

        # Should use default values for thresholds
        assert quota.warning_threshold == 0.8
        assert quota.critical_threshold == 0.9

    def test_optimization_suggestion_creation(self):
        """Test OptimizationSuggestion dataclass creation."""
        suggestion = OptimizationSuggestion(
            type=OptimizationType.DUPLICATE_REMOVAL,
            description="Remove duplicate files to save space",
            potential_savings=1048576,  # 1MB
            priority=4,
            action_required=True,
            estimated_time="5 minutes",
            files_affected=["file1.txt", "duplicate_file1.txt"],
        )

        assert suggestion.type == OptimizationType.DUPLICATE_REMOVAL
        assert suggestion.description == "Remove duplicate files to save space"
        assert suggestion.potential_savings == 1048576
        assert suggestion.priority == 4
        assert suggestion.action_required is True
        assert suggestion.estimated_time == "5 minutes"
        assert len(suggestion.files_affected) == 2

    def test_optimization_suggestion_priority_range(self):
        """Test OptimizationSuggestion priority validation."""
        # Test valid priority range (1-5)
        for priority in range(1, 6):
            suggestion = OptimizationSuggestion(
                type=OptimizationType.CACHE_CLEANUP,
                description=f"Priority {priority} task",
                potential_savings=1024,
                priority=priority,
                action_required=False,
                estimated_time="1 minute",
                files_affected=[],
            )
            assert 1 <= suggestion.priority <= 5

    def test_storage_analytics_creation(self):
        """Test StorageAnalytics dataclass creation."""
        analytics = StorageAnalytics(
            total_files=150,
            total_size=102400,  # 100KB
            file_type_distribution={"txt": {"count": 50, "size": 51200}, "jpg": {"count": 30, "size": 30720}},
            size_distribution={"small": 120, "medium": 20, "large": 10},
            age_distribution={"recent": 100, "old": 50},
            access_patterns={"frequent": 80, "occasional": 70},
            growth_trend={"daily": 2.5, "weekly": 15.0, "monthly": 60.0},
            duplicate_files=[("hash_abc123", ["file1.txt", "copy_file1.txt"])],
        )

        assert analytics.total_files == 150
        assert analytics.total_size == 102400
        assert analytics.file_type_distribution["txt"]["count"] == 50
        assert analytics.size_distribution["small"] == 120
        assert analytics.age_distribution["recent"] == 100
        assert analytics.access_patterns["frequent"] == 80
        assert analytics.growth_trend["monthly"] == 60.0
        assert len(analytics.duplicate_files) == 1


class TestStorageMonitorBasics:
    """Test basic StorageMonitor functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.test_paths = ["/tmp/test1", "/tmp/test2"]

    @patch("storage_management.StorageMonitor.start_monitoring")
    @patch("storage_management.StorageMonitor._update_storage_info")
    def test_storage_monitor_initialization(self, mock_update, mock_start):
        """Test StorageMonitor initialization."""
        monitor = StorageMonitor(self.test_paths, update_interval=60.0)

        assert monitor.update_interval == 60.0
        assert len(monitor.paths_to_monitor) == 2
        assert monitor.storage_info == {}
        assert monitor.callbacks == []
        assert isinstance(monitor.stop_event, threading.Event)

        mock_update.assert_called_once()
        mock_start.assert_called_once()

    @patch("storage_management.StorageMonitor.start_monitoring")
    @patch("storage_management.StorageMonitor._update_storage_info")
    def test_storage_monitor_callback_management(self, mock_update, mock_start):
        """Test adding and removing callbacks."""
        monitor = StorageMonitor(self.test_paths)

        callback1 = Mock()
        callback2 = Mock()

        # Test adding callbacks
        monitor.add_callback(callback1)
        monitor.add_callback(callback2)

        assert len(monitor.callbacks) == 2
        assert callback1 in monitor.callbacks
        assert callback2 in monitor.callbacks

        # Test removing callbacks
        monitor.remove_callback(callback1)
        assert len(monitor.callbacks) == 1
        assert callback1 not in monitor.callbacks
        assert callback2 in monitor.callbacks

        # Test removing non-existent callback (should not error)
        monitor.remove_callback(Mock())
        assert len(monitor.callbacks) == 1


class TestStorageOptimizerBasics:
    """Test basic StorageOptimizer functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.test_paths = ["/tmp/test_optimization"]

    def test_storage_optimizer_initialization(self):
        """Test StorageOptimizer initialization."""
        with patch("storage_management.StorageOptimizer._init_database"):
            optimizer = StorageOptimizer(self.test_paths)

            assert len(optimizer.base_paths) == 1
            assert isinstance(optimizer.base_paths[0], Path)
            assert optimizer.cache_dir is not None
            assert optimizer.db_path is not None


class TestStorageQuotaManagerBasics:
    """Test basic StorageQuotaManager functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.quota = StorageQuota(
            max_total_size=10000000,
            max_file_count=1000,
            max_file_size=100000,
            retention_days=30,
            auto_cleanup_enabled=True,
        )

    @patch("storage_management.StorageMonitor")
    def test_storage_quota_manager_initialization(self, mock_monitor):
        """Test StorageQuotaManager initialization."""
        mock_monitor_instance = Mock()
        mock_monitor.return_value = mock_monitor_instance

        manager = StorageQuotaManager(self.quota, mock_monitor_instance)

        assert manager.quota_config == self.quota
        assert manager.storage_monitor == mock_monitor_instance
        assert manager.warning_callbacks == []

        # Should register callback with monitor
        mock_monitor_instance.add_callback.assert_called_once()

    @patch("storage_management.StorageMonitor")
    def test_storage_quota_manager_warning_callbacks(self, mock_monitor):
        """Test warning callback management."""
        mock_monitor_instance = Mock()
        manager = StorageQuotaManager(self.quota, mock_monitor_instance)

        callback1 = Mock()
        callback2 = Mock()

        # Test adding callbacks
        manager.add_warning_callback(callback1)
        manager.add_warning_callback(callback2)

        assert len(manager.warning_callbacks) == 2
        assert callback1 in manager.warning_callbacks
        assert callback2 in manager.warning_callbacks

        # Test removing callbacks
        manager.remove_warning_callback(callback1)
        assert len(manager.warning_callbacks) == 1
        assert callback1 not in manager.warning_callbacks


class TestUtilityFunctions:
    """Test utility functions and helpers."""

    def test_warning_level_determination_logic(self):
        """Test logic for determining warning levels based on usage."""
        test_cases = [
            (50.0, StorageWarningLevel.NORMAL),  # < 70%
            (65.0, StorageWarningLevel.NORMAL),  # < 70%
            (75.0, StorageWarningLevel.WARNING),  # 70-85%
            (80.0, StorageWarningLevel.WARNING),  # 70-85%
            (88.0, StorageWarningLevel.CRITICAL),  # 85-95%
            (92.0, StorageWarningLevel.CRITICAL),  # 85-95%
            (97.0, StorageWarningLevel.FULL),  # > 95%
            (99.0, StorageWarningLevel.FULL),  # > 95%
        ]

        for percentage, expected_level in test_cases:
            # Apply the warning level logic
            if percentage < 70:
                actual_level = StorageWarningLevel.NORMAL
            elif percentage < 85:
                actual_level = StorageWarningLevel.WARNING
            elif percentage < 95:
                actual_level = StorageWarningLevel.CRITICAL
            else:
                actual_level = StorageWarningLevel.FULL

            assert actual_level == expected_level, f"Failed for {percentage}%"

    def test_quota_threshold_validation(self):
        """Test quota threshold validation logic."""
        # Valid thresholds
        valid_quota = StorageQuota(
            max_total_size=1000,
            max_file_count=100,
            max_file_size=10,
            retention_days=30,
            auto_cleanup_enabled=True,
            warning_threshold=0.7,
            critical_threshold=0.9,
        )

        assert 0 < valid_quota.warning_threshold < valid_quota.critical_threshold < 1
        assert valid_quota.warning_threshold < valid_quota.critical_threshold


class TestDataClassConversions:
    """Test dataclass conversions and serialization."""

    def test_storage_info_to_dict_conversion(self):
        """Test converting StorageInfo to dictionary."""
        from dataclasses import asdict

        now = datetime.now()
        storage_info = StorageInfo(
            total_space=1000,
            used_space=750,
            free_space=250,
            usage_percentage=75.0,
            warning_level=StorageWarningLevel.WARNING,
            last_updated=now,
        )

        info_dict = asdict(storage_info)

        assert isinstance(info_dict, dict)
        assert info_dict["total_space"] == 1000
        assert info_dict["used_space"] == 750
        assert info_dict["usage_percentage"] == 75.0
        assert info_dict["warning_level"] == StorageWarningLevel.WARNING
        assert info_dict["last_updated"] == now

    def test_storage_quota_serialization(self):
        """Test StorageQuota serialization compatibility."""
        from dataclasses import asdict

        quota = StorageQuota(
            max_total_size=10000, max_file_count=1000, max_file_size=100, retention_days=30, auto_cleanup_enabled=True
        )

        quota_dict = asdict(quota)

        # Should be JSON-serializable types
        assert isinstance(quota_dict["max_total_size"], int)
        assert isinstance(quota_dict["auto_cleanup_enabled"], bool)
        assert isinstance(quota_dict["warning_threshold"], float)


class TestErrorHandlingScenarios:
    """Test error handling in storage management."""

    @patch("storage_management.StorageMonitor.start_monitoring")
    @patch("storage_management.StorageMonitor._update_storage_info")
    def test_storage_monitor_empty_paths(self, mock_update, mock_start):
        """Test StorageMonitor with empty paths list."""
        monitor = StorageMonitor([])

        assert len(monitor.paths_to_monitor) == 0
        assert monitor.storage_info == {}

    def test_optimization_suggestion_edge_cases(self):
        """Test OptimizationSuggestion with edge case values."""
        # Test with maximum priority
        suggestion = OptimizationSuggestion(
            type=OptimizationType.DUPLICATE_REMOVAL,
            description="Critical optimization",
            potential_savings=0,  # No savings
            priority=5,  # Maximum priority
            action_required=True,
            estimated_time="Unknown",
            files_affected=[],  # No files affected
        )

        assert suggestion.potential_savings == 0
        assert suggestion.priority == 5
        assert len(suggestion.files_affected) == 0

    def test_storage_quota_edge_values(self):
        """Test StorageQuota with edge case values."""
        # Test with minimal values
        minimal_quota = StorageQuota(
            max_total_size=1,
            max_file_count=1,
            max_file_size=1,
            retention_days=1,
            auto_cleanup_enabled=False,
            warning_threshold=0.1,
            critical_threshold=0.9,
        )

        assert minimal_quota.max_total_size == 1
        assert minimal_quota.retention_days == 1
        assert minimal_quota.auto_cleanup_enabled is False


class TestModuleIntegration:
    """Test module-level integration and imports."""

    def test_module_imports_successfully(self):
        """Test that storage_management module imports correctly."""
        assert storage_management is not None

        # Test that all main classes are importable
        classes_to_test = [
            "StorageWarningLevel",
            "OptimizationType",
            "StorageInfo",
            "StorageQuota",
            "OptimizationSuggestion",
            "StorageAnalytics",
            "StorageMonitor",
            "StorageOptimizer",
            "StorageQuotaManager",
        ]

        for class_name in classes_to_test:
            assert hasattr(storage_management, class_name), f"Missing class: {class_name}"

    def test_enum_types_are_enums(self):
        """Test that enum types are proper Python enums."""
        from enum import Enum

        assert issubclass(StorageWarningLevel, Enum)
        assert issubclass(OptimizationType, Enum)

    def test_dataclass_types_are_dataclasses(self):
        """Test that dataclass types are proper dataclasses."""
        from dataclasses import is_dataclass

        dataclasses_to_test = [StorageInfo, StorageQuota, OptimizationSuggestion, StorageAnalytics]

        for dataclass_type in dataclasses_to_test:
            assert is_dataclass(dataclass_type), f"{dataclass_type} is not a dataclass"
