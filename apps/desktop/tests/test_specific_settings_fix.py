#!/usr/bin/env python3
"""
Test to verify specific settings mentioned by the user are being saved and loaded correctly.
This tests the exact settings that were reported as not working.
"""

import json
import os
import tempfile

import pytest

from config_and_logger import get_default_config, load_config, save_config


class TestSpecificSettingsFix:
    """Test the specific settings that were reported as not working."""

    def test_sorting_settings_persistence(self):
        """Test that sorting settings are saved and loaded correctly."""
        # Create a temporary config file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            temp_config_path = f.name

        try:
            config = get_default_config()
            config["treeview_sort_col_id"] = "name"  # Change from default "datetime"
            config["treeview_sort_descending"] = False  # Change from default True

            # Save config
            with open(temp_config_path, "w") as f:
                json.dump(config, f, indent=4)

            # Load config back
            with open(temp_config_path, "r") as f:
                loaded_config = json.load(f)

            assert loaded_config["treeview_sort_col_id"] == "name"
            assert loaded_config["treeview_sort_descending"] is False

        finally:
            if os.path.exists(temp_config_path):
                os.unlink(temp_config_path)

    def test_quit_without_confirmation_setting(self):
        """Test that quit without confirmation setting is saved and loaded correctly."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            temp_config_path = f.name

        try:
            config = get_default_config()
            config["quit_without_prompt_if_connected"] = True  # Change from default False

            # Save config
            with open(temp_config_path, "w") as f:
                json.dump(config, f, indent=4)

            # Load config back
            with open(temp_config_path, "r") as f:
                loaded_config = json.load(f)

            assert loaded_config["quit_without_prompt_if_connected"] is True

        finally:
            if os.path.exists(temp_config_path):
                os.unlink(temp_config_path)

    def test_debug_level_setting(self):
        """Test that debug level setting is saved and loaded correctly."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            temp_config_path = f.name

        try:
            config = get_default_config()
            config["log_level"] = "DEBUG"  # Change from default "INFO"

            # Save config
            with open(temp_config_path, "w") as f:
                json.dump(config, f, indent=4)

            # Load config back
            with open(temp_config_path, "r") as f:
                loaded_config = json.load(f)

            assert loaded_config["log_level"] == "DEBUG"

        finally:
            if os.path.exists(temp_config_path):
                os.unlink(temp_config_path)

    def test_recording_status_check_interval(self):
        """Test that recording status check interval is saved and loaded correctly."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            temp_config_path = f.name

        try:
            config = get_default_config()
            config["recording_check_interval_s"] = 10  # Change from default 3

            # Save config
            with open(temp_config_path, "w") as f:
                json.dump(config, f, indent=4)

            # Load config back
            with open(temp_config_path, "r") as f:
                loaded_config = json.load(f)

            assert loaded_config["recording_check_interval_s"] == 10

        finally:
            if os.path.exists(temp_config_path):
                os.unlink(temp_config_path)

    def test_all_problematic_settings_together(self):
        """Test all the problematic settings together to ensure they work in combination."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            temp_config_path = f.name

        try:
            config = get_default_config()

            # Set all the problematic settings
            config["treeview_sort_col_id"] = "size"
            config["treeview_sort_descending"] = False
            config["quit_without_prompt_if_connected"] = True
            config["log_level"] = "DEBUG"
            config["recording_check_interval_s"] = 15

            # Save config
            with open(temp_config_path, "w") as f:
                json.dump(config, f, indent=4)

            # Load config back
            with open(temp_config_path, "r") as f:
                loaded_config = json.load(f)

            # Verify all settings were saved and loaded correctly
            assert loaded_config["treeview_sort_col_id"] == "size"
            assert loaded_config["treeview_sort_descending"] is False
            assert loaded_config["quit_without_prompt_if_connected"] is True
            assert loaded_config["log_level"] == "DEBUG"
            assert loaded_config["recording_check_interval_s"] == 15

        finally:
            if os.path.exists(temp_config_path):
                os.unlink(temp_config_path)
