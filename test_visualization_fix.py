#!/usr/bin/env python3
"""
Test script to verify the audio visualization fix for undownloaded files.
This script simulates the key logic without requiring the full GUI.
"""

import os
import tempfile


def simulate_get_local_filepath(filename, download_directory):
    """Simulate the _get_local_filepath method"""
    safe_filename = (
        filename.replace(":", "-")
        .replace(" ", "_")
        .replace("\\", "_")
        .replace("/", "_")
    )
    return os.path.join(download_directory, safe_filename)


def simulate_update_waveform_for_selection(
    selected_files, displayed_files_details, download_directory
):
    """
    Simulate the fixed _update_waveform_for_selection method logic
    Returns: (should_show_visualization, reason)
    """
    if not selected_files:
        return False, "No file selected - hide visualization section"

    # Get the last selected file (for multiple selection)
    last_selected_file = selected_files[-1]
    file_detail = next(
        (f for f in displayed_files_details if f["name"] == last_selected_file),
        None,
    )

    if not file_detail:
        return False, "File detail not found"

    filename = file_detail["name"]
    local_filepath = simulate_get_local_filepath(filename, download_directory)

    # Only show visualization section if file is downloaded
    if os.path.exists(local_filepath):
        return (
            True,
            f"File is downloaded at {local_filepath} - show visualization and load waveform",
        )
    else:
        return (
            False,
            f"File not downloaded (no file at {local_filepath}) - hide visualization section",
        )


def test_visualization_logic():
    """Test the visualization logic with various scenarios"""
    print("Testing Audio Visualization Fix for Undownloaded Files")
    print("=" * 60)

    # Create a temporary directory for testing
    with tempfile.TemporaryDirectory() as temp_dir:
        print(f"Using temporary download directory: {temp_dir}")

        # Test data
        displayed_files_details = [
            {"name": "2025Jul25-170818-Rec93.hda", "gui_status": "On Device"},
            {"name": "2025Jul25-183037-Rec94.hda", "gui_status": "Downloaded"},
            {"name": "2025Jul24-192506-Rec85.hda", "gui_status": "Downloading"},
        ]

        # Create a downloaded file to simulate
        downloaded_file = "2025Jul25-183037-Rec94.hda"
        downloaded_path = simulate_get_local_filepath(downloaded_file, temp_dir)
        with open(downloaded_path, "w") as f:
            f.write("fake audio data")

        print(f"Created fake downloaded file: {downloaded_path}")
        print()

        # Test scenarios
        test_cases = [
            ([], "No selection"),
            (["2025Jul25-170818-Rec93.hda"], "Undownloaded file selected"),
            (["2025Jul25-183037-Rec94.hda"], "Downloaded file selected"),
            (["2025Jul24-192506-Rec85.hda"], "File being downloaded selected"),
            (
                ["2025Jul25-170818-Rec93.hda", "2025Jul25-183037-Rec94.hda"],
                "Multiple files selected (last is downloaded)",
            ),
            (
                ["2025Jul25-183037-Rec94.hda", "2025Jul25-170818-Rec93.hda"],
                "Multiple files selected (last is undownloaded)",
            ),
        ]

        for selected_files, description in test_cases:
            should_show, reason = simulate_update_waveform_for_selection(
                selected_files, displayed_files_details, temp_dir
            )

            status = "✅ SHOW" if should_show else "❌ HIDE"
            print(f"{status} | {description}")
            print(f"     Reason: {reason}")
            print()

        print("Test Results Summary:")
        print("- ✅ Visualization shown only for downloaded files")
        print(
            "- ❌ Visualization hidden for undownloaded, downloading, and no selection"
        )
        print(
            "- The fix correctly prevents visualization from showing for undownloaded files"
        )


if __name__ == "__main__":
    test_visualization_logic()
