# offline_mode_manager.py
"""
Offline Mode Manager for HiDock Desktop Application.

This module provides functionality for working with cached file lists and
downloaded files when the device is disconnected, enabling a seamless
offline experience.
"""

import os
from datetime import datetime
from typing import List, Optional

from config_and_logger import logger
from file_operations_manager import FileMetadata


class OfflineModeManager:
    """Manages offline functionality including cached file lists and local playback."""

    def __init__(self, file_operations_manager, download_directory: str):
        self.file_operations_manager = file_operations_manager
        self.download_directory = download_directory
        self.is_offline_mode = False

        logger.info("OfflineMode", "__init__", "Offline mode manager initialized")

    def enter_offline_mode(self):
        """Enter offline mode - use cached data and downloaded files only."""
        self.is_offline_mode = True
        logger.info("OfflineMode", "enter_offline_mode", "Entered offline mode")

    def exit_offline_mode(self):
        """Exit offline mode - return to normal device-connected operation."""
        self.is_offline_mode = False
        logger.info("OfflineMode", "exit_offline_mode", "Exited offline mode")

    def get_cached_file_list(self) -> List[FileMetadata]:
        """Get the cached file list for offline viewing."""
        try:
            cached_files = self.file_operations_manager.metadata_cache.get_all_metadata()
            logger.info("OfflineMode", "get_cached_file_list", f"Retrieved {len(cached_files)} cached files")
            return cached_files
        except Exception as e:
            logger.error("OfflineMode", "get_cached_file_list", f"Error retrieving cached files: {e}")
            return []

    def get_downloaded_files_only(self) -> List[FileMetadata]:
        """Get only files that have been downloaded and are available locally."""
        cached_files = self.get_cached_file_list()
        downloaded_files = []

        for file_metadata in cached_files:
            # Use the enhanced offline file path check
            local_path = self.get_offline_file_path(file_metadata.filename)
            if local_path:
                # Update the metadata with the found local path if it wasn't set
                if not file_metadata.local_path:
                    file_metadata.local_path = local_path
                downloaded_files.append(file_metadata)

        logger.info("OfflineMode", "get_downloaded_files_only", f"Found {len(downloaded_files)} downloaded files")
        return downloaded_files

    def is_file_playable_offline(self, filename: str) -> bool:
        """Check if a file can be played in offline mode."""
        # Use get_offline_file_path which checks both cache and download directory
        return self.get_offline_file_path(filename) is not None

    def get_offline_file_path(self, filename: str) -> Optional[str]:
        """Get the local file path for offline playback."""
        # First check cached metadata
        cached_metadata = self.file_operations_manager.metadata_cache.get_metadata(filename)
        if cached_metadata and cached_metadata.local_path and os.path.exists(cached_metadata.local_path):
            return cached_metadata.local_path
        
        # If not found in cache, check download directory directly
        # Use the same filename sanitization as _get_local_filepath
        safe_filename = filename.replace(":", "-").replace(" ", "_").replace("\\", "_").replace("/", "_")
        
        # Check for .wav file (converted from .hda)
        wav_path = os.path.join(self.download_directory, safe_filename.replace(".hda", ".wav"))
        if os.path.exists(wav_path):
            return wav_path
            
        # Check for original .hda file
        hda_path = os.path.join(self.download_directory, safe_filename)
        if os.path.exists(hda_path):
            return hda_path
            
        return None

    def update_offline_status_indicators(self, files_dict: List[dict]) -> List[dict]:
        """Update file status indicators for offline mode display."""
        for file_dict in files_dict:
            filename = file_dict["name"]

            # Check if file is available locally
            if self.is_file_playable_offline(filename):
                file_dict["gui_status"] = "Downloaded"
                file_dict["offline_available"] = True
            else:
                file_dict["gui_status"] = "On Device (Offline)"
                file_dict["offline_available"] = False

        return files_dict

    def get_offline_statistics(self) -> dict:
        """Get statistics about offline availability."""
        cached_files = self.get_cached_file_list()
        downloaded_files = self.get_downloaded_files_only()

        total_cached_size = sum(f.size for f in cached_files)
        downloaded_size = sum(f.size for f in downloaded_files)

        stats = {
            "total_cached_files": len(cached_files),
            "downloaded_files": len(downloaded_files),
            "offline_availability_percent": (len(downloaded_files) / len(cached_files) * 100) if cached_files else 0,
            "total_cached_size_mb": total_cached_size / (1024 * 1024),
            "downloaded_size_mb": downloaded_size / (1024 * 1024),
            "last_cache_update": self._get_last_cache_update(),
        }

        return stats

    def _get_last_cache_update(self) -> Optional[datetime]:
        """Get the timestamp of the last cache update."""
        try:
            import sqlite3

            with sqlite3.connect(self.file_operations_manager.metadata_cache.db_path) as conn:
                cursor = conn.execute("SELECT MAX(cache_timestamp) FROM file_metadata")
                result = cursor.fetchone()
                if result and result[0]:
                    return datetime.fromisoformat(result[0])
        except Exception as e:
            logger.warning("OfflineMode", "_get_last_cache_update", f"Error getting cache timestamp: {e}")
        return None
