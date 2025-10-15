#!/usr/bin/env python3
"""
Audio Metadata Database Manager for HiDock Desktop

Stores transcriptions, AI analysis, user descriptions, and processing status
for audio recordings. This is separate from the calendar cache and focused
on the audio content analysis and user-editable metadata.
"""

import sqlite3
import json
import os
import threading
from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum
from dataclasses import dataclass, asdict

from config_and_logger import logger


class ProcessingStatus(Enum):
    """Processing status for audio files."""
    NOT_PROCESSED = "not_processed"
    TRANSCRIBING = "transcribing"
    TRANSCRIBED = "transcribed"
    AI_ANALYZING = "ai_analyzing"
    AI_ANALYZED = "ai_analyzed"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass
class AudioMetadata:
    """Complete metadata for an audio recording."""
    
    # File identification
    filename: str
    file_path: str
    file_size: int
    duration_seconds: float
    date_created: datetime
    
    # Processing status
    processing_status: ProcessingStatus
    processing_started_at: Optional[datetime] = None
    processing_completed_at: Optional[datetime] = None
    processing_error: Optional[str] = None
    
    # Transcription data
    transcription_text: Optional[str] = None
    transcription_confidence: Optional[float] = None
    transcription_language: Optional[str] = None
    
    # AI-generated analysis
    ai_summary: Optional[str] = None
    ai_participants: Optional[List[str]] = None
    ai_action_items: Optional[List[str]] = None
    ai_topics: Optional[List[str]] = None
    ai_sentiment: Optional[str] = None
    ai_key_quotes: Optional[List[str]] = None
    
    # User-editable fields (can override AI)
    user_title: Optional[str] = None
    user_description: Optional[str] = None
    user_participants: Optional[List[str]] = None
    user_action_items: Optional[List[str]] = None
    user_tags: Optional[List[str]] = None
    user_notes: Optional[str] = None
    
    # Display fields (computed from above)
    display_title: Optional[str] = None  # user_title or ai_summary or filename
    display_description: Optional[str] = None  # user_description or ai_summary
    
    # Metadata
    created_at: datetime = datetime.now()
    updated_at: datetime = datetime.now()


class AudioMetadataDB:
    """Database manager for audio metadata and analysis results."""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.db_lock = threading.RLock()
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        
        # Initialize database
        self._init_database()
        
        logger.info("AudioMetadataDB", "init", f"Initialized audio metadata database at {db_path}")
    
    def _init_database(self):
        """Initialize the database schema."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                # Enable foreign keys
                conn.execute("PRAGMA foreign_keys = ON")
                
                # Create main audio_metadata table
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS audio_metadata (
                        filename TEXT PRIMARY KEY,
                        file_path TEXT NOT NULL,
                        file_size INTEGER NOT NULL,
                        duration_seconds REAL NOT NULL,
                        date_created TIMESTAMP NOT NULL,
                        
                        -- Processing status
                        processing_status TEXT NOT NULL DEFAULT 'not_processed',
                        processing_started_at TIMESTAMP,
                        processing_completed_at TIMESTAMP,
                        processing_error TEXT,
                        
                        -- Transcription data
                        transcription_text TEXT,
                        transcription_confidence REAL,
                        transcription_language TEXT,
                        
                        -- AI-generated analysis (JSON fields)
                        ai_summary TEXT,
                        ai_participants TEXT,  -- JSON array
                        ai_action_items TEXT,  -- JSON array  
                        ai_topics TEXT,        -- JSON array
                        ai_sentiment TEXT,
                        ai_key_quotes TEXT,    -- JSON array
                        
                        -- User-editable fields (JSON arrays where applicable)
                        user_title TEXT,
                        user_description TEXT,
                        user_participants TEXT,  -- JSON array
                        user_action_items TEXT,  -- JSON array
                        user_tags TEXT,          -- JSON array
                        user_notes TEXT,
                        
                        -- Display fields (computed)
                        display_title TEXT,
                        display_description TEXT,
                        
                        -- Metadata
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                
                # Create index for faster queries
                conn.execute("CREATE INDEX IF NOT EXISTS idx_processing_status ON audio_metadata(processing_status)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_date_created ON audio_metadata(date_created)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_updated_at ON audio_metadata(updated_at)")
                
                # Create processing_log table for tracking processing history
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS processing_log (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        filename TEXT NOT NULL,
                        processing_step TEXT NOT NULL,
                        status TEXT NOT NULL,
                        message TEXT,
                        timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (filename) REFERENCES audio_metadata(filename)
                    )
                """)
                
                conn.commit()
                logger.debug("AudioMetadataDB", "_init_database", "Database schema initialized")
                
            finally:
                conn.close()
    
    def get_metadata(self, filename: str) -> Optional[AudioMetadata]:
        """Get metadata for a specific audio file."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute(
                    "SELECT * FROM audio_metadata WHERE filename = ?", 
                    (filename,)
                )
                row = cursor.fetchone()
                
                if row:
                    return self._row_to_metadata(row)
                return None
                
            finally:
                conn.close()
    
    def _row_to_metadata(self, row: sqlite3.Row) -> AudioMetadata:
        """Convert database row to AudioMetadata object."""
        return AudioMetadata(
            filename=row['filename'],
            file_path=row['file_path'],
            file_size=row['file_size'],
            duration_seconds=row['duration_seconds'],
            date_created=datetime.fromisoformat(row['date_created']),
            processing_status=ProcessingStatus(row['processing_status']),
            processing_started_at=datetime.fromisoformat(row['processing_started_at']) if row['processing_started_at'] else None,
            processing_completed_at=datetime.fromisoformat(row['processing_completed_at']) if row['processing_completed_at'] else None,
            processing_error=row['processing_error'],
            transcription_text=row['transcription_text'],
            transcription_confidence=row['transcription_confidence'],
            transcription_language=row['transcription_language'],
            ai_summary=row['ai_summary'],
            ai_participants=json.loads(row['ai_participants']) if row['ai_participants'] else None,
            ai_action_items=json.loads(row['ai_action_items']) if row['ai_action_items'] else None,
            ai_topics=json.loads(row['ai_topics']) if row['ai_topics'] else None,
            ai_sentiment=row['ai_sentiment'],
            ai_key_quotes=json.loads(row['ai_key_quotes']) if row['ai_key_quotes'] else None,
            user_title=row['user_title'],
            user_description=row['user_description'],
            user_participants=json.loads(row['user_participants']) if row['user_participants'] else None,
            user_action_items=json.loads(row['user_action_items']) if row['user_action_items'] else None,
            user_tags=json.loads(row['user_tags']) if row['user_tags'] else None,
            user_notes=row['user_notes'],
            display_title=row['display_title'],
            display_description=row['display_description'],
            created_at=datetime.fromisoformat(row['created_at']),
            updated_at=datetime.fromisoformat(row['updated_at'])
        )
    
    def save_metadata(self, metadata: AudioMetadata) -> bool:
        """Save or update metadata for an audio file."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                # Update timestamps
                metadata.updated_at = datetime.now()
                
                # Compute display fields
                metadata.display_title = self._compute_display_title(metadata)
                metadata.display_description = self._compute_display_description(metadata)
                
                # Convert to dict for database storage
                data = {
                    'filename': metadata.filename,
                    'file_path': metadata.file_path,
                    'file_size': metadata.file_size,
                    'duration_seconds': metadata.duration_seconds,
                    'date_created': metadata.date_created.isoformat(),
                    'processing_status': metadata.processing_status.value,
                    'processing_started_at': metadata.processing_started_at.isoformat() if metadata.processing_started_at else None,
                    'processing_completed_at': metadata.processing_completed_at.isoformat() if metadata.processing_completed_at else None,
                    'processing_error': metadata.processing_error,
                    'transcription_text': metadata.transcription_text,
                    'transcription_confidence': metadata.transcription_confidence,
                    'transcription_language': metadata.transcription_language,
                    'ai_summary': metadata.ai_summary,
                    'ai_participants': json.dumps(metadata.ai_participants) if metadata.ai_participants else None,
                    'ai_action_items': json.dumps(metadata.ai_action_items) if metadata.ai_action_items else None,
                    'ai_topics': json.dumps(metadata.ai_topics) if metadata.ai_topics else None,
                    'ai_sentiment': metadata.ai_sentiment,
                    'ai_key_quotes': json.dumps(metadata.ai_key_quotes) if metadata.ai_key_quotes else None,
                    'user_title': metadata.user_title,
                    'user_description': metadata.user_description,
                    'user_participants': json.dumps(metadata.user_participants) if metadata.user_participants else None,
                    'user_action_items': json.dumps(metadata.user_action_items) if metadata.user_action_items else None,
                    'user_tags': json.dumps(metadata.user_tags) if metadata.user_tags else None,
                    'user_notes': metadata.user_notes,
                    'display_title': metadata.display_title,
                    'display_description': metadata.display_description,
                    'updated_at': metadata.updated_at.isoformat()
                }
                
                # Use INSERT OR REPLACE for upsert behavior
                columns = ', '.join(data.keys())
                placeholders = ', '.join(['?' for _ in data])
                
                conn.execute(
                    f"INSERT OR REPLACE INTO audio_metadata ({columns}) VALUES ({placeholders})",
                    list(data.values())
                )
                
                conn.commit()
                
                logger.debug("AudioMetadataDB", "save_metadata", 
                           f"Saved metadata for {metadata.filename}")
                return True
                
            except Exception as e:
                logger.error("AudioMetadataDB", "save_metadata", 
                           f"Error saving metadata for {metadata.filename}: {e}")
                return False
            finally:
                conn.close()
    
    def _compute_display_title(self, metadata: AudioMetadata) -> str:
        """Compute display title from available data."""
        # Priority: user_title > ai_summary > calendar subject > filename
        if metadata.user_title:
            return metadata.user_title
        elif metadata.ai_summary:
            # Use first line of AI summary as title
            return metadata.ai_summary.split('\n')[0][:50]
        else:
            # Fallback to filename without extension
            return os.path.splitext(metadata.filename)[0]
    
    def _compute_display_description(self, metadata: AudioMetadata) -> str:
        """Compute display description from available data."""
        # Priority: user_description > ai_summary > transcription excerpt
        if metadata.user_description:
            return metadata.user_description
        elif metadata.ai_summary:
            return metadata.ai_summary
        elif metadata.transcription_text:
            # Use first 200 characters of transcription
            return metadata.transcription_text[:200] + "..." if len(metadata.transcription_text) > 200 else metadata.transcription_text
        else:
            return ""
    
    def update_processing_status(self, filename: str, status: ProcessingStatus, 
                               error_message: Optional[str] = None) -> bool:
        """Update processing status for an audio file."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                now = datetime.now()
                
                if status == ProcessingStatus.TRANSCRIBING:
                    conn.execute("""
                        UPDATE audio_metadata 
                        SET processing_status = ?, processing_started_at = ?, updated_at = ?
                        WHERE filename = ?
                    """, (status.value, now.isoformat(), now.isoformat(), filename))
                elif status in [ProcessingStatus.COMPLETED, ProcessingStatus.ERROR]:
                    conn.execute("""
                        UPDATE audio_metadata 
                        SET processing_status = ?, processing_completed_at = ?, 
                            processing_error = ?, updated_at = ?
                        WHERE filename = ?
                    """, (status.value, now.isoformat(), error_message, now.isoformat(), filename))
                else:
                    conn.execute("""
                        UPDATE audio_metadata 
                        SET processing_status = ?, updated_at = ?
                        WHERE filename = ?
                    """, (status.value, now.isoformat(), filename))
                
                conn.commit()
                
                # Log to processing_log
                conn.execute("""
                    INSERT INTO processing_log (filename, processing_step, status, message)
                    VALUES (?, ?, ?, ?)
                """, (filename, status.value, "updated", error_message))
                
                conn.commit()
                return True
                
            except Exception as e:
                logger.error("AudioMetadataDB", "update_processing_status", 
                           f"Error updating status for {filename}: {e}")
                return False
            finally:
                conn.close()
    
    def save_transcription(self, filename: str, transcription_text: str, 
                          confidence: float = None, language: str = None) -> bool:
        """Save transcription results for an audio file."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                now = datetime.now()
                
                conn.execute("""
                    UPDATE audio_metadata 
                    SET transcription_text = ?, transcription_confidence = ?, 
                        transcription_language = ?, processing_status = ?, updated_at = ?
                    WHERE filename = ?
                """, (transcription_text, confidence, language, 
                      ProcessingStatus.TRANSCRIBED.value, now.isoformat(), filename))
                
                conn.commit()
                
                logger.info("AudioMetadataDB", "save_transcription", 
                          f"Saved transcription for {filename} ({len(transcription_text)} chars)")
                return True
                
            except Exception as e:
                logger.error("AudioMetadataDB", "save_transcription", 
                           f"Error saving transcription for {filename}: {e}")
                return False
            finally:
                conn.close()
    
    def save_ai_analysis(self, filename: str, summary: str = None, 
                        participants: List[str] = None, action_items: List[str] = None,
                        topics: List[str] = None, sentiment: str = None,
                        key_quotes: List[str] = None) -> bool:
        """Save AI analysis results for an audio file."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                now = datetime.now()
                
                # Get current metadata to compute display fields
                metadata = self.get_metadata(filename)
                if metadata:
                    # Update AI fields
                    metadata.ai_summary = summary
                    metadata.ai_participants = participants
                    metadata.ai_action_items = action_items
                    metadata.ai_topics = topics
                    metadata.ai_sentiment = sentiment
                    metadata.ai_key_quotes = key_quotes
                    metadata.processing_status = ProcessingStatus.AI_ANALYZED
                    
                    # Recompute display fields
                    display_title = self._compute_display_title(metadata)
                    display_description = self._compute_display_description(metadata)
                    
                    conn.execute("""
                        UPDATE audio_metadata 
                        SET ai_summary = ?, ai_participants = ?, ai_action_items = ?,
                            ai_topics = ?, ai_sentiment = ?, ai_key_quotes = ?,
                            display_title = ?, display_description = ?,
                            processing_status = ?, updated_at = ?
                        WHERE filename = ?
                    """, (
                        summary,
                        json.dumps(participants) if participants else None,
                        json.dumps(action_items) if action_items else None,
                        json.dumps(topics) if topics else None,
                        sentiment,
                        json.dumps(key_quotes) if key_quotes else None,
                        display_title,
                        display_description,
                        ProcessingStatus.AI_ANALYZED.value,
                        now.isoformat(),
                        filename
                    ))
                    
                    conn.commit()
                    
                    logger.info("AudioMetadataDB", "save_ai_analysis", 
                              f"Saved AI analysis for {filename}")
                    return True
                else:
                    logger.warning("AudioMetadataDB", "save_ai_analysis", 
                                 f"No metadata found for {filename}")
                    return False
                
            except Exception as e:
                logger.error("AudioMetadataDB", "save_ai_analysis", 
                           f"Error saving AI analysis for {filename}: {e}")
                return False
            finally:
                conn.close()
    
    def update_user_fields(self, filename: str, user_title: str = None, 
                          user_description: str = None, user_participants: List[str] = None,
                          user_action_items: List[str] = None, user_tags: List[str] = None,
                          user_notes: str = None) -> bool:
        """Update user-editable fields for an audio file."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                # Get current metadata to recompute display fields
                metadata = self.get_metadata(filename)
                if not metadata:
                    logger.warning("AudioMetadataDB", "update_user_fields", 
                                 f"No metadata found for {filename}")
                    return False
                
                # Update user fields
                if user_title is not None:
                    metadata.user_title = user_title
                if user_description is not None:
                    metadata.user_description = user_description
                if user_participants is not None:
                    metadata.user_participants = user_participants
                if user_action_items is not None:
                    metadata.user_action_items = user_action_items
                if user_tags is not None:
                    metadata.user_tags = user_tags
                if user_notes is not None:
                    metadata.user_notes = user_notes
                
                # Recompute display fields
                display_title = self._compute_display_title(metadata)
                display_description = self._compute_display_description(metadata)
                
                now = datetime.now()
                
                conn.execute("""
                    UPDATE audio_metadata 
                    SET user_title = ?, user_description = ?, user_participants = ?,
                        user_action_items = ?, user_tags = ?, user_notes = ?,
                        display_title = ?, display_description = ?, updated_at = ?
                    WHERE filename = ?
                """, (
                    metadata.user_title,
                    metadata.user_description,
                    json.dumps(metadata.user_participants) if metadata.user_participants else None,
                    json.dumps(metadata.user_action_items) if metadata.user_action_items else None,
                    json.dumps(metadata.user_tags) if metadata.user_tags else None,
                    metadata.user_notes,
                    display_title,
                    display_description,
                    now.isoformat(),
                    filename
                ))
                
                conn.commit()
                
                logger.info("AudioMetadataDB", "update_user_fields", 
                          f"Updated user fields for {filename}")
                return True
                
            except Exception as e:
                logger.error("AudioMetadataDB", "update_user_fields", 
                           f"Error updating user fields for {filename}: {e}")
                return False
            finally:
                conn.close()
    
    def create_file_entry(self, filename: str, file_path: str, file_size: int,
                         duration_seconds: float, date_created: datetime) -> bool:
        """Create a new file entry in the database."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                metadata = AudioMetadata(
                    filename=filename,
                    file_path=file_path,
                    file_size=file_size,
                    duration_seconds=duration_seconds,
                    date_created=date_created,
                    processing_status=ProcessingStatus.NOT_PROCESSED
                )
                
                # Compute initial display fields
                display_title = self._compute_display_title(metadata)
                display_description = self._compute_display_description(metadata)
                
                conn.execute("""
                    INSERT OR REPLACE INTO audio_metadata 
                    (filename, file_path, file_size, duration_seconds, date_created,
                     processing_status, display_title, display_description)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    filename, file_path, file_size, duration_seconds, 
                    date_created.isoformat(), ProcessingStatus.NOT_PROCESSED.value,
                    display_title, display_description
                ))
                
                conn.commit()
                
                logger.debug("AudioMetadataDB", "create_file_entry", 
                           f"Created entry for {filename}")
                return True
                
            except Exception as e:
                logger.error("AudioMetadataDB", "create_file_entry", 
                           f"Error creating entry for {filename}: {e}")
                return False
            finally:
                conn.close()
    
    def get_files_by_status(self, status: ProcessingStatus) -> List[AudioMetadata]:
        """Get all files with a specific processing status."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute(
                    "SELECT * FROM audio_metadata WHERE processing_status = ? ORDER BY date_created DESC",
                    (status.value,)
                )
                
                return [self._row_to_metadata(row) for row in cursor.fetchall()]
                
            finally:
                conn.close()
    
    def get_all_metadata(self) -> List[AudioMetadata]:
        """Get metadata for all audio files."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute(
                    "SELECT * FROM audio_metadata ORDER BY date_created DESC"
                )
                
                return [self._row_to_metadata(row) for row in cursor.fetchall()]
                
            finally:
                conn.close()
    
    def get_processing_statistics(self) -> Dict[str, int]:
        """Get statistics about processing status."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                cursor = conn.execute("""
                    SELECT processing_status, COUNT(*) as count
                    FROM audio_metadata 
                    GROUP BY processing_status
                """)
                
                stats = {}
                for row in cursor.fetchall():
                    stats[row[0]] = row[1]
                
                return stats
                
            finally:
                conn.close()
    
    def search_metadata(self, query: str) -> List[AudioMetadata]:
        """Search metadata by text content."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                conn.row_factory = sqlite3.Row
                
                # Search in multiple fields
                cursor = conn.execute("""
                    SELECT * FROM audio_metadata 
                    WHERE transcription_text LIKE ? 
                       OR ai_summary LIKE ?
                       OR user_title LIKE ?
                       OR user_description LIKE ?
                       OR user_notes LIKE ?
                    ORDER BY updated_at DESC
                """, (f"%{query}%", f"%{query}%", f"%{query}%", f"%{query}%", f"%{query}%"))
                
                return [self._row_to_metadata(row) for row in cursor.fetchall()]
                
            finally:
                conn.close()
    
    def delete_metadata(self, filename: str) -> bool:
        """Delete metadata for an audio file."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                # Delete from processing log first (foreign key constraint)
                conn.execute("DELETE FROM processing_log WHERE filename = ?", (filename,))
                
                # Delete main metadata
                cursor = conn.execute("DELETE FROM audio_metadata WHERE filename = ?", (filename,))
                
                conn.commit()
                
                if cursor.rowcount > 0:
                    logger.info("AudioMetadataDB", "delete_metadata", 
                              f"Deleted metadata for {filename}")
                    return True
                else:
                    logger.debug("AudioMetadataDB", "delete_metadata", 
                               f"No metadata found for {filename}")
                    return False
                
            except Exception as e:
                logger.error("AudioMetadataDB", "delete_metadata", 
                           f"Error deleting metadata for {filename}: {e}")
                return False
            finally:
                conn.close()
    
    def cleanup_orphaned_entries(self, existing_filenames: List[str]) -> int:
        """Remove metadata for files that no longer exist on device."""
        with self.db_lock:
            conn = sqlite3.connect(self.db_path)
            try:
                # Get all filenames in database
                cursor = conn.execute("SELECT filename FROM audio_metadata")
                db_filenames = [row[0] for row in cursor.fetchall()]
                
                # Find orphaned entries
                orphaned = [f for f in db_filenames if f not in existing_filenames]
                
                if orphaned:
                    # Delete orphaned entries
                    for filename in orphaned:
                        conn.execute("DELETE FROM processing_log WHERE filename = ?", (filename,))
                        conn.execute("DELETE FROM audio_metadata WHERE filename = ?", (filename,))
                    
                    conn.commit()
                    
                    logger.info("AudioMetadataDB", "cleanup_orphaned_entries", 
                              f"Removed {len(orphaned)} orphaned entries")
                
                return len(orphaned)
                
            except Exception as e:
                logger.error("AudioMetadataDB", "cleanup_orphaned_entries", 
                           f"Error during cleanup: {e}")
                return 0
            finally:
                conn.close()
    
    def get_status_display_text(self, metadata: AudioMetadata) -> str:
        """Get display text for TreeView meeting column based on processing status."""
        if metadata.processing_status == ProcessingStatus.NOT_PROCESSED:
            return ""  # Blank for unprocessed
        elif metadata.processing_status == ProcessingStatus.TRANSCRIBING:
            return "Transcribing..."
        elif metadata.processing_status == ProcessingStatus.AI_ANALYZING:
            return "Analyzing..."
        elif metadata.processing_status in [ProcessingStatus.AI_ANALYZED, ProcessingStatus.COMPLETED]:
            return metadata.display_title or ""
        elif metadata.processing_status == ProcessingStatus.ERROR:
            return "Processing Error"
        else:
            return ""
    
    def close(self):
        """Close database connections."""
        # SQLite connections are closed after each operation, so nothing to do here
        logger.info("AudioMetadataDB", "close", "Database manager closed")


# Singleton instance for global access
_audio_metadata_db = None
_db_lock = threading.Lock()

def get_audio_metadata_db() -> AudioMetadataDB:
    """Get singleton instance of AudioMetadataDB."""
    global _audio_metadata_db
    
    if _audio_metadata_db is None:
        with _db_lock:
            if _audio_metadata_db is None:
                db_path = os.path.join(os.path.expanduser("~"), ".hidock", "audio_metadata.db")
                _audio_metadata_db = AudioMetadataDB(db_path)
    
    return _audio_metadata_db
