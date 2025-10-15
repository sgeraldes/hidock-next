# calendar_cache_manager.py
"""
Persistent Calendar Cache Manager for HiDock Desktop

Aggressive caching system optimized for 500+ recordings dating from May.
Never re-fetch older meetings unless explicitly forced via GUI.
"""

import json
import os
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict

from config_and_logger import logger


@dataclass
class CachedMeeting:
    """Cached meeting information with expiration."""
    
    # Meeting basic info
    subject: str
    organizer: str
    start_time: str  # ISO format for JSON serialization
    end_time: str
    location: str
    
    # Attendee info
    attendees: List[Dict[str, str]]
    attendee_count: int
    
    # Display formatting
    display_text: str
    
    # Cache metadata
    cached_at: str  # When this was cached
    expires_at: str  # When this expires
    confidence_score: float
    
    # Rich meeting data for future UI
    body_preview: str = ""
    meeting_url: str = ""
    is_recurring: bool = False
    

class CalendarCacheManager:
    """Persistent calendar cache optimized for 500+ recordings."""
    
    def __init__(self, cache_dir: str):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        
        # Cache files
        self.meetings_cache_file = os.path.join(cache_dir, "meetings_cache.json")
        self.file_meetings_cache_file = os.path.join(cache_dir, "file_meetings_cache.json")
        
        # In-memory caches
        self._meetings_cache: Dict[str, CachedMeeting] = {}
        self._file_meetings_cache: Dict[str, str] = {}  # filename -> meeting_key
        
        # Thread safety
        self._cache_lock = threading.RLock()
        
        # Cache settings - AGGRESSIVE caching for old recordings
        self.OLD_RECORDING_THRESHOLD_DAYS = 30  # Recordings older than 30 days
        self.OLD_RECORDING_CACHE_DURATION_DAYS = 365  # Cache for 1 year
        self.RECENT_RECORDING_CACHE_DURATION_HOURS = 24  # Recent recordings cache for 24h
        
        # Load existing caches
        self._load_caches()
        
        logger.info("CalendarCache", "init", 
                   f"Initialized with {len(self._meetings_cache)} cached meetings and "
                   f"{len(self._file_meetings_cache)} file mappings")
    
    def _load_caches(self):
        """Load existing cache data from disk."""
        try:
            # Load meetings cache
            if os.path.exists(self.meetings_cache_file):
                with open(self.meetings_cache_file, 'r', encoding='utf-8') as f:
                    cache_data = json.load(f)
                    
                for key, data in cache_data.items():
                    # Convert dict back to CachedMeeting
                    try:
                        self._meetings_cache[key] = CachedMeeting(**data)
                    except Exception as e:
                        logger.warning("CalendarCache", "_load_caches", 
                                     f"Error loading cached meeting {key}: {e}")
                        
                logger.info("CalendarCache", "_load_caches", 
                           f"Loaded {len(self._meetings_cache)} meetings from cache")
            
            # Load file mappings cache
            if os.path.exists(self.file_meetings_cache_file):
                with open(self.file_meetings_cache_file, 'r', encoding='utf-8') as f:
                    self._file_meetings_cache = json.load(f)
                    
                logger.info("CalendarCache", "_load_caches", 
                           f"Loaded {len(self._file_meetings_cache)} file mappings from cache")
                           
        except Exception as e:
            logger.error("CalendarCache", "_load_caches", f"Error loading caches: {e}")
            # Reset caches on error
            self._meetings_cache = {}
            self._file_meetings_cache = {}
    
    def _save_caches(self):
        """Save cache data to disk."""
        try:
            with self._cache_lock:
                # Save meetings cache
                cache_data = {}
                for key, meeting in self._meetings_cache.items():
                    cache_data[key] = asdict(meeting)
                    
                with open(self.meetings_cache_file, 'w', encoding='utf-8') as f:
                    json.dump(cache_data, f, indent=2, ensure_ascii=False)
                
                # Save file mappings cache
                with open(self.file_meetings_cache_file, 'w', encoding='utf-8') as f:
                    json.dump(self._file_meetings_cache, f, indent=2)
                    
                logger.debug("CalendarCache", "_save_caches", "Cache saved to disk")
                
        except Exception as e:
            logger.error("CalendarCache", "_save_caches", f"Error saving caches: {e}")
    
    def _generate_meeting_key(self, subject: str, start_time: datetime, organizer: str) -> str:
        """Generate unique key for meeting."""
        # Use date + subject + organizer hash for uniqueness
        date_str = start_time.strftime("%Y-%m-%d")
        import hashlib
        content = f"{date_str}|{subject}|{organizer}"
        hash_suffix = hashlib.md5(content.encode()).hexdigest()[:8]
        return f"{date_str}_{hash_suffix}"
    
    def _is_old_recording(self, recording_date: datetime) -> bool:
        """Check if recording is considered 'old' for caching purposes."""
        threshold_date = datetime.now() - timedelta(days=self.OLD_RECORDING_THRESHOLD_DAYS)
        return recording_date < threshold_date
    
    def get_cached_meeting_for_file(self, filename: str, recording_date: datetime) -> Optional[CachedMeeting]:
        """Get cached meeting for a specific file."""
        with self._cache_lock:
            # Check if we have a direct file mapping
            if filename in self._file_meetings_cache:
                meeting_key = self._file_meetings_cache[filename]
                if meeting_key in self._meetings_cache:
                    meeting = self._meetings_cache[meeting_key]
                    
                    # Check if cache is still valid
                    if self._is_cache_valid(meeting, recording_date):
                        logger.debug("CalendarCache", "get_cached_meeting_for_file",
                                   f"Cache hit for {filename}: {meeting.subject}")
                        return meeting
                    else:
                        # Cache expired, remove it
                        logger.debug("CalendarCache", "get_cached_meeting_for_file",
                                   f"Cache expired for {filename}, removing")
                        del self._meetings_cache[meeting_key]
                        del self._file_meetings_cache[filename]
            
            return None
    
    def _is_cache_valid(self, meeting: CachedMeeting, recording_date: datetime) -> bool:
        """Check if cached meeting is still valid."""
        try:
            expires_at = datetime.fromisoformat(meeting.expires_at)
            
            # For old recordings, be very aggressive with caching
            if self._is_old_recording(recording_date):
                # Old recordings keep cache for much longer
                return datetime.now() < expires_at
            else:
                # Recent recordings have shorter cache duration
                return datetime.now() < expires_at
                
        except Exception as e:
            logger.warning("CalendarCache", "_is_cache_valid", f"Error checking cache validity: {e}")
            return False
    
    def cache_meeting_for_file(self, filename: str, recording_date: datetime, 
                              simple_meeting: Any) -> CachedMeeting:
        """Cache meeting data for a file."""
        try:
            with self._cache_lock:
                # Generate meeting key
                meeting_key = self._generate_meeting_key(
                    simple_meeting.subject,
                    simple_meeting.start_time, 
                    simple_meeting.organizer
                )
                
                # Determine cache expiration based on recording age
                now = datetime.now()
                if self._is_old_recording(recording_date):
                    # Old recordings: cache for 1 year
                    expires_at = now + timedelta(days=self.OLD_RECORDING_CACHE_DURATION_DAYS)
                    logger.debug("CalendarCache", "cache_meeting_for_file",
                               f"Old recording {filename} cached until {expires_at}")
                else:
                    # Recent recordings: cache for 24 hours
                    expires_at = now + timedelta(hours=self.RECENT_RECORDING_CACHE_DURATION_HOURS)
                
                # Create cached meeting
                cached_meeting = CachedMeeting(
                    subject=simple_meeting.subject,
                    organizer=simple_meeting.organizer,
                    start_time=simple_meeting.start_time.isoformat(),
                    end_time=simple_meeting.end_time.isoformat(),
                    location=simple_meeting.location or "",
                    attendees=simple_meeting.attendees or [],
                    attendee_count=len(simple_meeting.attendees) if simple_meeting.attendees else 0,
                    display_text=self._format_meeting_display_text(simple_meeting, include_organizer=False),
                    cached_at=now.isoformat(),
                    expires_at=expires_at.isoformat(),
                    confidence_score=0.9,  # High confidence for successful matches
                    body_preview="",  # TODO: Extract from meeting body if available
                    meeting_url="",   # TODO: Extract meeting URL if available
                    is_recurring=False  # TODO: Check if recurring
                )
                
                # Store in caches
                self._meetings_cache[meeting_key] = cached_meeting
                self._file_meetings_cache[filename] = meeting_key
                
                logger.debug("CalendarCache", "cache_meeting_for_file",
                           f"Cached meeting for {filename}: {simple_meeting.subject}")
                
                # Immediately persist cache to disk to avoid data loss on abrupt exits
                self._save_caches()
                
                return cached_meeting
                
        except Exception as e:
            logger.error("CalendarCache", "cache_meeting_for_file", 
                        f"Error caching meeting for {filename}: {e}")
            # Return a default cached meeting on error
            return CachedMeeting(
                subject="Error Caching",
                organizer="",
                start_time=recording_date.isoformat(),
                end_time=recording_date.isoformat(),
                location="",
                attendees=[],
                attendee_count=0,
                display_text="Cache Error",
                cached_at=datetime.now().isoformat(),
                expires_at=(datetime.now() + timedelta(hours=1)).isoformat(),
                confidence_score=0.0
            )
    
    def cache_no_meeting_for_file(self, filename: str, recording_date: datetime):
        """Cache that a file has no associated meeting."""
        try:
            with self._cache_lock:
                # Use special key for "no meeting" entries
                meeting_key = f"NO_MEETING_{filename}_{recording_date.strftime('%Y%m%d')}"
                
                # Determine cache duration
                now = datetime.now()
                if self._is_old_recording(recording_date):
                    expires_at = now + timedelta(days=self.OLD_RECORDING_CACHE_DURATION_DAYS)
                else:
                    expires_at = now + timedelta(hours=self.RECENT_RECORDING_CACHE_DURATION_HOURS)
                
                # Create "no meeting" cache entry
                no_meeting_cache = CachedMeeting(
                    subject="",
                    organizer="",
                    start_time=recording_date.isoformat(),
                    end_time=recording_date.isoformat(),
                    location="",
                    attendees=[],
                    attendee_count=0,
                    display_text="",  # Show nothing instead of "No Meeting"
                    cached_at=now.isoformat(),
                    expires_at=expires_at.isoformat(),
                    confidence_score=1.0  # High confidence in "no meeting"
                )
                
                self._meetings_cache[meeting_key] = no_meeting_cache
                self._file_meetings_cache[filename] = meeting_key
                
                logger.debug("CalendarCache", "cache_no_meeting_for_file",
                           f"Cached 'no meeting' for {filename}")
                
                # Immediately persist cache to disk to avoid data loss on abrupt exits
                self._save_caches()
                
        except Exception as e:
            logger.error("CalendarCache", "cache_no_meeting_for_file", 
                        f"Error caching 'no meeting' for {filename}: {e}")
    
    def _format_meeting_display_text(self, simple_meeting: Any, include_organizer: bool = True) -> str:
        """Format meeting for TreeView display.
        
        Args:
            simple_meeting: Meeting object with subject, organizer, etc.
            include_organizer: Whether to include organizer info (False for consistent live display)
        """
        if not simple_meeting or not simple_meeting.subject:
            return ""  # Return empty string instead of "No Meeting"
        
        # Start with subject
        display = simple_meeting.subject.strip()
        
        # Add organizer if requested and available and different from subject
        if include_organizer and simple_meeting.organizer and simple_meeting.organizer.strip():
            organizer = simple_meeting.organizer.strip()
            # Clean up organizer (remove email domain)
            if '@' in organizer:
                organizer = organizer.split('@')[0].replace('.', ' ').title()
            
            # Only add organizer if it adds useful info
            if organizer.lower() not in display.lower():
                display += f" - {organizer}"
        
        # Truncate if too long for TreeView column
        if len(display) > 45:
            display = display[:42] + "..."
        
        return display
    
    def update_display_format_for_existing_cache(self):
        """Update display text format for existing cached meetings to ensure consistency.
        
        This method updates cached meetings that may have the old format with organizer info
        to use the new clean format (subject only) for consistency with live refresh display.
        """
        try:
            with self._cache_lock:
                updated_count = 0
                for meeting_key, cached_meeting in self._meetings_cache.items():
                    # Check if this cached meeting has organizer info in display_text
                    if cached_meeting.display_text and " - " in cached_meeting.display_text:
                        # Extract just the subject part (before the " - ")
                        subject_only = cached_meeting.display_text.split(" - ")[0].strip()
                        
                        # Update the display_text to clean format
                        if subject_only and subject_only != cached_meeting.display_text:
                            # Create updated cached meeting with clean display text
                            updated_meeting = CachedMeeting(
                                subject=cached_meeting.subject,
                                organizer=cached_meeting.organizer,
                                start_time=cached_meeting.start_time,
                                end_time=cached_meeting.end_time,
                                location=cached_meeting.location,
                                attendees=cached_meeting.attendees,
                                attendee_count=cached_meeting.attendee_count,
                                display_text=subject_only,  # Clean format
                                cached_at=cached_meeting.cached_at,
                                expires_at=cached_meeting.expires_at,
                                confidence_score=cached_meeting.confidence_score,
                                body_preview=cached_meeting.body_preview,
                                meeting_url=cached_meeting.meeting_url,
                                is_recurring=cached_meeting.is_recurring
                            )
                            
                            self._meetings_cache[meeting_key] = updated_meeting
                            updated_count += 1
                
                if updated_count > 0:
                    logger.info("CalendarCache", "update_display_format", 
                               f"Updated display format for {updated_count} cached meetings")
                    self._save_caches()
                else:
                    logger.debug("CalendarCache", "update_display_format", 
                                "No cached meetings needed display format updates")
                    
        except Exception as e:
            logger.error("CalendarCache", "update_display_format", 
                        f"Error updating cached meeting display formats: {e}")
    
    def get_cache_statistics(self) -> Dict[str, Any]:
        """Get cache statistics for monitoring."""
        with self._cache_lock:
            now = datetime.now()
            
            # Count entries by age
            old_entries = 0
            recent_entries = 0
            expired_entries = 0
            no_meeting_entries = 0
            
            for meeting_key, meeting in self._meetings_cache.items():
                try:
                    cached_at = datetime.fromisoformat(meeting.cached_at)
                    expires_at = datetime.fromisoformat(meeting.expires_at)
                    
                    if now > expires_at:
                        expired_entries += 1
                    elif meeting_key.startswith("NO_MEETING_"):
                        no_meeting_entries += 1
                    elif self._is_old_recording(cached_at):
                        old_entries += 1
                    else:
                        recent_entries += 1
                        
                except Exception:
                    expired_entries += 1  # Count parsing errors as expired
            
            return {
                "total_meetings_cached": len(self._meetings_cache),
                "total_file_mappings": len(self._file_meetings_cache),
                "old_entries": old_entries,
                "recent_entries": recent_entries,
                "expired_entries": expired_entries,
                "no_meeting_entries": no_meeting_entries,
                "cache_hit_ratio": self._calculate_hit_ratio(),
            }
    
    def _calculate_hit_ratio(self) -> float:
        """Calculate cache hit ratio (placeholder for now)."""
        # TODO: Track actual hits/misses for accurate ratio
        return 0.85  # Estimated based on aggressive caching strategy
    
    def cleanup_expired_entries(self) -> int:
        """Remove expired cache entries."""
        removed_count = 0
        now = datetime.now()
        
        try:
            with self._cache_lock:
                expired_keys = []
                expired_files = []
                
                # Find expired meetings
                for meeting_key, meeting in self._meetings_cache.items():
                    try:
                        expires_at = datetime.fromisoformat(meeting.expires_at)
                        if now > expires_at:
                            expired_keys.append(meeting_key)
                    except Exception:
                        expired_keys.append(meeting_key)  # Remove invalid entries
                
                # Find files pointing to expired meetings
                for filename, meeting_key in self._file_meetings_cache.items():
                    if meeting_key in expired_keys:
                        expired_files.append(filename)
                
                # Remove expired entries
                for key in expired_keys:
                    del self._meetings_cache[key]
                    removed_count += 1
                
                for filename in expired_files:
                    del self._file_meetings_cache[filename]
                
                if removed_count > 0:
                    logger.info("CalendarCache", "cleanup_expired_entries",
                               f"Removed {removed_count} expired cache entries")
                    self._save_caches()
                
        except Exception as e:
            logger.error("CalendarCache", "cleanup_expired_entries", 
                        f"Error during cache cleanup: {e}")
        
        return removed_count
    
    def force_refresh_file(self, filename: str):
        """Force refresh calendar data for a specific file."""
        with self._cache_lock:
            if filename in self._file_meetings_cache:
                meeting_key = self._file_meetings_cache[filename]
                if meeting_key in self._meetings_cache:
                    del self._meetings_cache[meeting_key]
                del self._file_meetings_cache[filename]
                
                logger.info("CalendarCache", "force_refresh_file", 
                           f"Forced refresh for {filename}")
                self._save_caches()
    
    def force_refresh_all(self):
        """Force refresh all calendar data (for GUI force refresh)."""
        with self._cache_lock:
            self._meetings_cache.clear()
            self._file_meetings_cache.clear()
            
            logger.info("CalendarCache", "force_refresh_all", 
                       "Forced refresh of all calendar cache")
            self._save_caches()
    
    def shutdown(self):
        """Save caches on shutdown."""
        logger.info("CalendarCache", "shutdown", "Saving cache on shutdown...")
        self._save_caches()
