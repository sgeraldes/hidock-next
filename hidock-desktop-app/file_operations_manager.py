"""
Advanced File Operations Manager for HiDock Desktop Application.

This module provides comprehensive file management capabilities including:
- Batch file operations with progress tracking and cancellation
- File validation and integrity checking
- Advanced search, filtering, and sorting capabilities
- File metadata management and caching system
- Storage optimization and analytics

Requirements addressed: 2.1, 2.2, 2.3, 2.4, 2.5, 9.1, 9.2
"""

import asyncio
import hashlib
import json
import os
import queue
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from config_and_logger import logger
from device_interface import OperationProgress


class FileOperationType(Enum):
    """Types of file operations that can be performed."""

    DOWNLOAD = "download"
    DELETE = "delete"
    VALIDATE = "validate"
    ANALYZE = "analyze"


class FileOperationStatus(Enum):
    """Status of file operations."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class FileMetadata:
    """Comprehensive file metadata structure."""

    filename: str
    size: int
    duration: float
    date_created: datetime
    device_path: str
    local_path: Optional[str] = None
    checksum: Optional[str] = None
    file_type: Optional[str] = None
    transcription_status: Optional[str] = None
    last_accessed: Optional[datetime] = None
    download_count: int = 0
    tags: List[str] = None

    def __post_init__(self):
        if self.tags is None:
            self.tags = []


@dataclass
class FileOperation:
    """Represents a file operation with progress tracking."""

    operation_id: str
    operation_type: FileOperationType
    filename: str
    status: FileOperationStatus
    progress: float = 0.0
    error_message: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    metadata: Dict[str, Any] = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


class FileSearchFilter:
    """Advanced file search and filtering capabilities."""

    def __init__(self):
        self.filename_pattern: Optional[str] = None
        self.size_min: Optional[int] = None
        self.size_max: Optional[int] = None
        self.duration_min: Optional[float] = None
        self.duration_max: Optional[float] = None
        self.date_from: Optional[datetime] = None
        self.date_to: Optional[datetime] = None
        self.file_types: List[str] = []
        self.tags: List[str] = []
        self.has_transcription: Optional[bool] = None
        self.downloaded_only: Optional[bool] = None

    def matches(self, file_metadata: FileMetadata) -> bool:
        """Check if file metadata matches the filter criteria."""
        if (
            self.filename_pattern
            and self.filename_pattern.lower() not in file_metadata.filename.lower()
        ):
            return False

        if self.size_min is not None and file_metadata.size < self.size_min:
            return False

        if self.size_max is not None and file_metadata.size > self.size_max:
            return False

        if self.duration_min is not None and file_metadata.duration < self.duration_min:
            return False

        if self.duration_max is not None and file_metadata.duration > self.duration_max:
            return False

        if self.date_from and file_metadata.date_created < self.date_from:
            return False

        if self.date_to and file_metadata.date_created > self.date_to:
            return False

        if self.file_types and not any(
            file_metadata.filename.lower().endswith(f".{ft.lower()}")
            for ft in self.file_types
        ):
            return False

        if self.tags and not any(tag in file_metadata.tags for tag in self.tags):
            return False

        if self.has_transcription is not None:
            has_trans = file_metadata.transcription_status is not None
            if has_trans != self.has_transcription:
                return False

        if self.downloaded_only is not None:
            is_downloaded = file_metadata.local_path is not None
            if is_downloaded != self.downloaded_only:
                return False

        return True


class FileMetadataCache:
    """SQLite-based file metadata cache for performance optimization."""

    def __init__(self, cache_dir: str):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.cache_dir / "file_metadata.db"
        self._init_database()

    def _init_database(self):
        """Initialize the SQLite database for metadata caching."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS file_metadata (
                    filename TEXT PRIMARY KEY,
                    size INTEGER,
                    duration REAL,
                    date_created TEXT,
                    device_path TEXT,
                    local_path TEXT,
                    checksum TEXT,
                    file_type TEXT,
                    transcription_status TEXT,
                    last_accessed TEXT,
                    download_count INTEGER,
                    tags TEXT,
                    cache_timestamp TEXT
                )
            """
            )
            conn.commit()

    def get_metadata(self, filename: str) -> Optional[FileMetadata]:
        """Retrieve cached metadata for a file."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "SELECT * FROM file_metadata WHERE filename = ?", (filename,)
            )
            row = cursor.fetchone()

            if row:
                return FileMetadata(
                    filename=row[0],
                    size=row[1],
                    duration=row[2],
                    date_created=datetime.fromisoformat(row[3]),
                    device_path=row[4],
                    local_path=row[5],
                    checksum=row[6],
                    file_type=row[7],
                    transcription_status=row[8],
                    last_accessed=datetime.fromisoformat(row[9]) if row[9] else None,
                    download_count=row[10],
                    tags=json.loads(row[11]) if row[11] else [],
                )
        return None

    def set_metadata(self, metadata: FileMetadata):
        """Cache metadata for a file."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO file_metadata 
                (filename, size, duration, date_created, device_path, local_path, 
                 checksum, file_type, transcription_status, last_accessed, 
                 download_count, tags, cache_timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    metadata.filename,
                    metadata.size,
                    metadata.duration,
                    metadata.date_created.isoformat(),
                    metadata.device_path,
                    metadata.local_path,
                    metadata.checksum,
                    metadata.file_type,
                    metadata.transcription_status,
                    (
                        metadata.last_accessed.isoformat()
                        if metadata.last_accessed
                        else None
                    ),
                    metadata.download_count,
                    json.dumps(metadata.tags),
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()

    def remove_metadata(self, filename: str):
        """Remove cached metadata for a file."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM file_metadata WHERE filename = ?", (filename,))
            conn.commit()

    def get_all_metadata(self) -> List[FileMetadata]:
        """Retrieve all cached metadata."""
        metadata_list = []
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("SELECT * FROM file_metadata")
            for row in cursor.fetchall():
                metadata_list.append(
                    FileMetadata(
                        filename=row[0],
                        size=row[1],
                        duration=row[2],
                        date_created=datetime.fromisoformat(row[3]),
                        device_path=row[4],
                        local_path=row[5],
                        checksum=row[6],
                        file_type=row[7],
                        transcription_status=row[8],
                        last_accessed=(
                            datetime.fromisoformat(row[9]) if row[9] else None
                        ),
                        download_count=row[10],
                        tags=json.loads(row[11]) if row[11] else [],
                    )
                )
        return metadata_list


class FileOperationsManager:
    """
    Advanced file operations manager with batch processing, progress tracking,
    and comprehensive file management capabilities.
    """

    def __init__(
        self,
        device_interface,
        download_dir: str,
        cache_dir: str = None,
        device_lock=None,
    ):
        self.device_interface = device_interface
        self.device_lock = device_lock  # Optional device lock for synchronization
        self.download_dir = Path(download_dir)
        self.download_dir.mkdir(parents=True, exist_ok=True)

        # Initialize metadata cache
        cache_dir = cache_dir or os.path.join(
            os.path.expanduser("~"), ".hidock", "cache"
        )
        self.metadata_cache = FileMetadataCache(cache_dir)

        # Operation tracking
        self.active_operations: Dict[str, FileOperation] = {}
        self.operation_queue = queue.Queue()
        self.operation_history: List[FileOperation] = []

        # Threading and cancellation
        self.worker_threads: List[threading.Thread] = []
        self.cancel_event = threading.Event()
        self.max_concurrent_operations = 3

        # Progress callbacks
        self.progress_callbacks: Dict[str, Callable] = {}
        self.global_progress_callback: Optional[Callable] = None

        # Statistics
        self.operation_stats = {
            "total_downloads": 0,
            "total_deletions": 0,
            "total_bytes_downloaded": 0,
            "total_operations_time": 0,
            "failed_operations": 0,
        }

        # Start worker threads
        self._start_worker_threads()

        logger.info("FileOpsManager", "__init__", "File operations manager initialized")

    def _start_worker_threads(self):
        """Start worker threads for processing file operations."""
        for i in range(self.max_concurrent_operations):
            thread = threading.Thread(
                target=self._worker_thread, name=f"FileOpsWorker-{i}", daemon=True
            )
            thread.start()
            self.worker_threads.append(thread)

    def _worker_thread(self):
        """Worker thread for processing file operations."""
        while not self.cancel_event.is_set():
            try:
                operation = self.operation_queue.get(timeout=1.0)
                if operation is None:  # Shutdown signal
                    break

                # Check if operation was cancelled before execution
                if operation.status == FileOperationStatus.CANCELLED:
                    logger.info(
                        "FileOpsManager",
                        "_worker_thread", 
                        f"Skipping cancelled operation {operation.operation_id}"
                    )
                    self.operation_queue.task_done()
                    continue

                self._execute_operation(operation)
                self.operation_queue.task_done()

            except queue.Empty:
                continue
            except RuntimeError as e:
                logger.error(
                    "FileOpsManager", "_worker_thread", f"Worker thread error: {e}"
                )

    def _execute_operation(self, operation: FileOperation):
        """Execute a single file operation."""
        operation.status = FileOperationStatus.IN_PROGRESS
        operation.start_time = datetime.now()

        try:
            # Check for cancellation before starting execution
            if operation.status == FileOperationStatus.CANCELLED:
                logger.info(
                    "FileOpsManager",
                    "_execute_operation",
                    f"Operation {operation.operation_id} was cancelled before execution"
                )
                return

            if operation.operation_type == FileOperationType.DOWNLOAD:
                self._execute_download(operation)
            elif operation.operation_type == FileOperationType.DELETE:
                self._execute_delete(operation)
            elif operation.operation_type == FileOperationType.VALIDATE:
                self._execute_validate(operation)
            elif operation.operation_type == FileOperationType.ANALYZE:
                self._execute_analyze(operation)

            # Check for cancellation after execution (in case it was cancelled during execution)
            if operation.status == FileOperationStatus.CANCELLED:
                logger.info(
                    "FileOpsManager",
                    "_execute_operation",
                    f"Operation {operation.operation_id} was cancelled during execution"
                )
                return

            operation.status = FileOperationStatus.COMPLETED
            operation.progress = 100.0

        except (IOError, ValueError, FileNotFoundError) as e:
            # Don't mark as failed if it was actually cancelled
            if operation.status != FileOperationStatus.CANCELLED:
                operation.status = FileOperationStatus.FAILED
                operation.error_message = str(e)
                self.operation_stats["failed_operations"] += 1
                logger.error(
                    "FileOpsManager",
                    "_execute_operation",
                    f"Operation {operation.operation_id} failed: {e}",
                )

        finally:
            operation.end_time = datetime.now()
            self.operation_history.append(operation)
            if operation.operation_id in self.active_operations:
                del self.active_operations[operation.operation_id]

            # Notify progress callback
            if operation.operation_id in self.progress_callbacks:
                self.progress_callbacks[operation.operation_id](operation)

    def _execute_download(self, operation: FileOperation):
        """Execute a file download operation."""
        filename = operation.filename
        local_path = self.download_dir / filename

        # The progress callback from the device adapter is more detailed (OperationProgress)
        # than what the old code expected. We need to adapt and forward to the GUI.
        def adapter_progress_callback(op_progress: OperationProgress):
            operation.progress = op_progress.progress * 100.0
            if operation.operation_id in self.progress_callbacks:
                # The GUI's callback expects a FileOperation object.
                # We update the current operation and pass it along.
                self.progress_callbacks[operation.operation_id](operation)

        try:
            # Get cached file size to avoid expensive file list operation
            cached_metadata = self.metadata_cache.get_metadata(filename)
            file_size = cached_metadata.size if cached_metadata else None

            if file_size:
                logger.debug(
                    "FileOpsManager",
                    "_execute_download",
                    f"Using cached file size {file_size} for {filename}",
                )
            else:
                logger.debug(
                    "FileOpsManager",
                    "_execute_download",
                    f"No cached metadata found for {filename}, will fetch from device",
                )

            # Use device lock if available to prevent conflicts with other device operations
            if self.device_lock:
                logger.debug(
                    "FileOpsManager",
                    "_execute_download",
                    f"Acquiring device lock for download of {filename}",
                )
                with self.device_lock:
                    asyncio.run(
                        self.device_interface.device_interface.download_recording(
                            recording_id=filename,
                            output_path=local_path,
                            progress_callback=adapter_progress_callback,
                            file_size=file_size,
                        )
                    )
            else:
                # Fallback if no device lock is provided
                asyncio.run(
                    self.device_interface.device_interface.download_recording(
                        recording_id=filename,
                        output_path=local_path,
                        progress_callback=adapter_progress_callback,
                        file_size=file_size,
                    )
                )

        except Exception as e:
            # Log the detailed error and re-raise an IOError to fit the existing
            # error handling in _execute_operation.
            logger.error(
                "FileOpsManager",
                "_execute_download",
                f"Download execution failed for {filename}: {e}",
            )
            raise IOError(f"Download failed for {filename}") from e

        # Validate downloaded file
        if self._validate_downloaded_file(filename, local_path):
            # Update metadata cache
            metadata = self.metadata_cache.get_metadata(filename)
            if metadata:
                metadata.local_path = str(local_path)
                metadata.download_count += 1
                metadata.last_accessed = datetime.now()
                self.metadata_cache.set_metadata(metadata)

            self.operation_stats["total_downloads"] += 1
            self.operation_stats["total_bytes_downloaded"] += local_path.stat().st_size

            logger.info(
                "FileOpsManager",
                "_execute_download",
                f"Successfully downloaded {filename}",
            )
        else:
            raise ValueError(f"File validation failed for {filename}")

    def _execute_delete(self, operation: FileOperation):
        """Execute a file deletion operation."""
        filename = operation.filename

        try:
            # Use device lock if available to prevent conflicts with other device operations
            if self.device_lock:
                logger.debug(
                    "FileOpsManager",
                    "_execute_delete",
                    f"Acquiring device lock for deletion of {filename}",
                )
                with self.device_lock:
                    asyncio.run(
                        self.device_interface.device_interface.delete_recording(
                            recording_id=filename,
                        )
                    )
            else:
                # Fallback if no device lock is provided
                asyncio.run(
                    self.device_interface.device_interface.delete_recording(
                        recording_id=filename,
                    )
                )

            # Remove from metadata cache
            self.metadata_cache.remove_metadata(filename)
            self.operation_stats["total_deletions"] += 1

            logger.info(
                "FileOpsManager", "_execute_delete", f"Successfully deleted {filename}"
            )

        except Exception as e:
            # Log the detailed error and re-raise an IOError to fit the existing
            # error handling in _execute_operation.
            logger.error(
                "FileOpsManager",
                "_execute_delete",
                f"Delete execution failed for {filename}: {e}",
            )
            raise IOError(f"Deletion failed for {filename}") from e

    def _execute_validate(self, operation: FileOperation):
        """Execute a file validation operation."""
        filename = operation.filename
        metadata = self.metadata_cache.get_metadata(filename)

        if metadata and metadata.local_path:
            local_path = Path(metadata.local_path)
            if local_path.exists():
                # Validate file integrity
                if self._validate_downloaded_file(filename, local_path):
                    operation.metadata["validation_result"] = "valid"
                else:
                    operation.metadata["validation_result"] = "invalid"
                    raise ValueError(f"File validation failed for {filename}")
            else:
                raise FileNotFoundError(f"Local file not found: {local_path}")
        else:
            raise ValueError(f"No local file to validate for {filename}")

    def _execute_analyze(self, operation: FileOperation):
        """Execute a file analysis operation."""
        filename = operation.filename
        metadata = self.metadata_cache.get_metadata(filename)

        if metadata:
            # Perform file analysis (size, type, etc.)
            analysis_result = {
                "file_size": metadata.size,
                "duration": metadata.duration,
                "file_type": self._detect_file_type(filename),
                "estimated_quality": self._estimate_audio_quality(metadata),
                "storage_efficiency": self._calculate_storage_efficiency(metadata),
            }

            operation.metadata["analysis_result"] = analysis_result
            logger.info(
                "FileOpsManager",
                "_execute_analyze",
                f"Analysis completed for {filename}",
            )
        else:
            raise ValueError(f"No metadata found for {filename}")

    def _validate_downloaded_file(self, filename: str, local_path: Path) -> bool:
        """Validate a downloaded file's integrity."""
        try:
            if not local_path.exists():
                logger.warning(
                    "FileOpsManager",
                    "_validate_downloaded_file",
                    f"Downloaded file does not exist: {local_path}",
                )
                return False

            # Check file size - this is the primary validation method
            metadata = self.metadata_cache.get_metadata(filename)
            if metadata and local_path.stat().st_size != metadata.size:
                logger.warning(
                    "FileOpsManager",
                    "_validate_downloaded_file",
                    f"Size mismatch for {filename}. Expected: {metadata.size}, Got: {local_path.stat().st_size}",
                )
                return False

            # Skip checksum validation for now as the device signature format
            # is incompatible with SHA-256 checksums calculated locally
            # TODO: Implement proper signature validation if device provides compatible checksums
            if metadata and metadata.checksum:
                logger.debug(
                    "FileOpsManager",
                    "_validate_downloaded_file",
                    f"Device signature for {filename}: {metadata.checksum} (validation skipped - format incompatible)",
                )

            # Basic file integrity check - ensure file is not empty and has reasonable content
            if local_path.stat().st_size == 0:
                logger.warning(
                    "FileOpsManager",
                    "_validate_downloaded_file",
                    f"Downloaded file is empty: {filename}",
                )
                return False

            logger.info(
                "FileOpsManager",
                "_validate_downloaded_file",
                f"File validation passed for {filename} ({local_path.stat().st_size} bytes)",
            )
            return True

        except OSError as e:
            logger.error(
                "FileOpsManager",
                "_validate_downloaded_file",
                f"Validation error for {filename}: {e}",
            )
            return False

    def _calculate_file_checksum(self, file_path: Path) -> str:
        """Calculate SHA-256 checksum of a file."""
        hash_sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_sha256.update(chunk)
        return hash_sha256.hexdigest()

    def _detect_file_type(self, filename: str) -> str:
        """Detect file type based on extension."""
        extension = Path(filename).suffix.lower()
        audio_types = {
            ".wav": "WAV Audio",
            ".mp3": "MP3 Audio",
            ".m4a": "M4A Audio",
            ".ogg": "OGG Audio",
            ".flac": "FLAC Audio",
        }
        return audio_types.get(extension, "Unknown")

    def _estimate_audio_quality(self, metadata: FileMetadata) -> str:
        """Estimate audio quality based on file size and duration."""
        if metadata.duration > 0:
            bitrate = (metadata.size * 8) / metadata.duration / 1000  # kbps
            if bitrate > 256:
                return "High"
            elif bitrate > 128:
                return "Medium"
            else:
                return "Low"
        return "Unknown"

    def _calculate_storage_efficiency(self, metadata: FileMetadata) -> float:
        """Calculate storage efficiency score (0-100)."""
        if metadata.duration > 0:
            bytes_per_second = metadata.size / metadata.duration
            # Normalize based on typical audio file sizes
            efficiency = min(100, (bytes_per_second / 16000) * 100)
            return round(efficiency, 2)
        return 0.0

    # Public API methods

    def queue_download(self, filename: str, progress_callback: Callable = None) -> str:
        """Queue a file download operation."""
        # Check if file is already queued or downloading
        for operation in self.active_operations.values():
            if (
                operation.filename == filename
                and operation.operation_type == FileOperationType.DOWNLOAD
                and operation.status
                in [FileOperationStatus.PENDING, FileOperationStatus.IN_PROGRESS]
            ):
                logger.warning(
                    "FileOpsManager",
                    "queue_download",
                    f"Download for {filename} already in progress, skipping duplicate",
                )
                return operation.operation_id

        # Check if file is already downloaded and ask for confirmation
        metadata = self.metadata_cache.get_metadata(filename)
        if metadata and metadata.local_path and os.path.exists(metadata.local_path):
            logger.info(
                "FileOpsManager",
                "queue_download",
                f"File {filename} already downloaded, proceeding with re-download",
            )

        operation_id = f"download_{filename}_{int(time.time())}"
        operation = FileOperation(
            operation_id=operation_id,
            operation_type=FileOperationType.DOWNLOAD,
            filename=filename,
            status=FileOperationStatus.PENDING,
        )

        self.active_operations[operation_id] = operation
        if progress_callback:
            self.progress_callbacks[operation_id] = progress_callback

        self.operation_queue.put(operation)
        logger.info(
            "FileOpsManager", "queue_download", f"Queued download for {filename}"
        )
        return operation_id

    def queue_delete(self, filename: str, progress_callback: Callable = None) -> str:
        """Queue a file deletion operation."""
        operation_id = f"delete_{filename}_{int(time.time())}"
        operation = FileOperation(
            operation_id=operation_id,
            operation_type=FileOperationType.DELETE,
            filename=filename,
            status=FileOperationStatus.PENDING,
        )

        self.active_operations[operation_id] = operation
        if progress_callback:
            self.progress_callbacks[operation_id] = progress_callback

        self.operation_queue.put(operation)
        logger.info("FileOpsManager", "queue_delete", f"Queued deletion for {filename}")
        return operation_id

    def queue_batch_download(
        self, filenames: List[str], progress_callback: Callable = None
    ) -> List[str]:
        """Queue multiple files for download."""
        operation_ids = []
        for filename in filenames:
            operation_id = self.queue_download(filename, progress_callback)
            operation_ids.append(operation_id)

        logger.info(
            "FileOpsManager",
            "queue_batch_download",
            f"Queued batch download for {len(filenames)} files",
        )
        return operation_ids

    def queue_batch_delete(
        self, filenames: List[str], progress_callback: Callable = None
    ) -> List[str]:
        """Queue multiple files for deletion."""
        operation_ids = []
        for filename in filenames:
            operation_id = self.queue_delete(filename, progress_callback)
            operation_ids.append(operation_id)

        logger.info(
            "FileOpsManager",
            "queue_batch_delete",
            f"Queued batch deletion for {len(filenames)} files",
        )
        return operation_ids

    def cancel_operation(self, operation_id: str) -> bool:
        """Cancel a specific operation and clean up partial files."""
        if operation_id in self.active_operations:
            operation = self.active_operations[operation_id]
            operation.status = FileOperationStatus.CANCELLED
            
            # Clean up partial downloads
            if operation.operation_type == FileOperationType.DOWNLOAD:
                partial_file_path = self.download_dir / operation.filename
                if partial_file_path.exists():
                    try:
                        partial_file_path.unlink()
                        logger.info(
                            "FileOpsManager",
                            "cancel_operation",
                            f"Cleaned up partial download: {partial_file_path}"
                        )
                    except Exception as e:
                        logger.warning(
                            "FileOpsManager",
                            "cancel_operation",
                            f"Failed to clean up partial download {partial_file_path}: {e}"
                        )
            
            logger.info(
                "FileOpsManager",
                "cancel_operation",
                f"Cancelled operation {operation_id}",
            )
            return True
        return False

    def cancel_all_operations(self):
        """Cancel all active operations."""
        for operation_id in list(self.active_operations.keys()):
            self.cancel_operation(operation_id)
        logger.info(
            "FileOpsManager", "cancel_all_operations", "Cancelled all operations"
        )

    def get_operation_status(self, operation_id: str) -> Optional[FileOperation]:
        """Get the status of a specific operation."""
        return self.active_operations.get(operation_id)

    def get_all_active_operations(self) -> List[FileOperation]:
        """Get all currently active operations."""
        return list(self.active_operations.values())

    def is_file_operation_active(
        self, filename: str, operation_type: FileOperationType = None
    ) -> bool:
        """Check if a file has an active operation (queued or in progress)."""
        for operation in self.active_operations.values():
            if operation.filename == filename and operation.status in [
                FileOperationStatus.PENDING,
                FileOperationStatus.IN_PROGRESS,
            ]:
                if operation_type is None or operation.operation_type == operation_type:
                    return True
        return False

    def search_files(self, search_filter: FileSearchFilter) -> List[FileMetadata]:
        """Search files using advanced filtering."""
        all_metadata = self.metadata_cache.get_all_metadata()
        return [
            metadata for metadata in all_metadata if search_filter.matches(metadata)
        ]

    def sort_files(
        self, files: List[FileMetadata], sort_by: str, reverse: bool = False
    ) -> List[FileMetadata]:
        """Sort files by specified criteria."""
        sort_key_map = {
            "name": lambda f: f.filename.lower(),
            "size": lambda f: f.size,
            "duration": lambda f: f.duration,
            "date": lambda f: f.date_created,
            "download_count": lambda f: f.download_count,
            "type": lambda f: self._detect_file_type(f.filename),
        }

        if sort_by in sort_key_map:
            return sorted(files, key=sort_key_map[sort_by], reverse=reverse)
        return files

    def get_statistics(self) -> Dict[str, Any]:
        """Get comprehensive file operation statistics."""
        all_metadata = self.metadata_cache.get_all_metadata()

        stats = self.operation_stats.copy()
        stats.update(
            {
                "total_files_cached": len(all_metadata),
                "total_downloaded_files": len(
                    [m for m in all_metadata if m.local_path]
                ),
                "active_operations": len(self.active_operations),
                "completed_operations": len(self.operation_history),
                "average_file_size": (
                    sum(m.size for m in all_metadata) / len(all_metadata)
                    if all_metadata
                    else 0
                ),
                "total_storage_used": sum(m.size for m in all_metadata),
                "cache_hit_rate": self._calculate_cache_hit_rate(),
            }
        )

        return stats

    def _calculate_cache_hit_rate(self) -> float:
        """Calculate cache hit rate for performance monitoring."""
        # This would be implemented based on actual cache usage tracking
        return 85.0  # Placeholder value

    def cleanup_old_cache_entries(self, days_old: int = 30):
        """Clean up old cache entries to maintain performance."""
        cutoff_date = datetime.now() - timedelta(days=days_old)

        with sqlite3.connect(self.metadata_cache.db_path) as conn:
            cursor = conn.execute(
                "DELETE FROM file_metadata WHERE cache_timestamp < ?",
                (cutoff_date.isoformat(),),
            )
            deleted_count = cursor.rowcount
            conn.commit()

        logger.info(
            "FileOpsManager",
            "cleanup_old_cache_entries",
            f"Cleaned up {deleted_count} old cache entries",
        )

    def shutdown(self):
        """Shutdown the file operations manager."""
        logger.info(
            "FileOpsManager", "shutdown", "Shutting down file operations manager"
        )

        # Cancel all operations
        self.cancel_all_operations()

        # Signal worker threads to stop
        self.cancel_event.set()

        # Add shutdown signals to queue
        for _ in self.worker_threads:
            self.operation_queue.put(None)

        # Wait for worker threads to finish
        for thread in self.worker_threads:
            thread.join(timeout=5.0)

        logger.info(
            "FileOpsManager", "shutdown", "File operations manager shutdown complete"
        )
