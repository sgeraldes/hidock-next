# calendar_service.py
"""
Calendar Service Interface and Implementation

⚠️  CALENDAR INTEGRATION DISABLED BY DEFAULT ⚠️

This module is NOT used by default to avoid requiring enterprise-level
Azure AD credentials that regular users don't have access to.

For advanced users who want calendar integration:
1. Install optional dependency: pip install hidock-next[calendar]
2. Enable in configuration: calendar_provider = "outlook"
3. Configure Azure AD credentials in Settings

This module provides the calendar integration functionality for HiDock Next,
enabling automatic correlation of meeting recordings with calendar events.

Phase 1 Features:
- Basic timestamp matching with calendar events (±15 minutes)
- Meeting metadata extraction and display
- Manual meeting linking interface
- Outlook/Microsoft Graph integration
"""

import asyncio
import os
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from enum import Enum

logger = logging.getLogger(__name__)


class CalendarProvider(Enum):
    """Supported calendar providers."""
    OUTLOOK = "outlook"
    GOOGLE = "google"  # Future implementation
    APPLE = "apple"    # Future implementation


@dataclass
class MeetingInfo:
    """Meeting information extracted from calendar events."""
    
    # Basic meeting details
    id: str
    subject: str
    organizer_name: str
    organizer_email: str
    start_time: datetime
    end_time: datetime
    location: Optional[str] = None
    
    # Attendees information
    attendees: List[Dict[str, str]] = None  # [{"name": "John Doe", "email": "john@example.com", "status": "accepted"}]
    required_attendees: List[str] = None    # List of required attendee emails
    optional_attendees: List[str] = None    # List of optional attendee emails
    
    # Meeting content
    body_preview: Optional[str] = None      # First 200 chars of meeting body
    body_html: Optional[str] = None         # Full HTML body (for agenda extraction)
    
    # Meeting metadata
    is_cancelled: bool = False
    is_all_day: bool = False
    is_recurring: bool = False
    recurrence_pattern: Optional[str] = None
    meeting_url: Optional[str] = None       # Teams/Zoom/etc. links
    
    # Correlation metadata
    confidence_score: float = 0.0          # How confident we are in the correlation (0.0 - 1.0)
    correlation_method: str = "manual"      # "timestamp", "manual", "ml" etc.
    
    def __post_init__(self):
        """Initialize default values for mutable fields."""
        if self.attendees is None:
            self.attendees = []
        if self.required_attendees is None:
            self.required_attendees = []
        if self.optional_attendees is None:
            self.optional_attendees = []
    
    @property
    def duration_minutes(self) -> int:
        """Calculate meeting duration in minutes."""
        return int((self.end_time - self.start_time).total_seconds() / 60)
    
    @property
    def attendee_count(self) -> int:
        """Get total number of attendees."""
        return len(self.attendees)
    
    @property
    def display_attendees(self) -> str:
        """Get formatted attendee list for display."""
        if not self.attendees:
            return "No attendees"
        
        names = [att.get("name", att.get("email", "Unknown")) for att in self.attendees[:3]]
        if len(self.attendees) > 3:
            names.append(f"and {len(self.attendees) - 3} more")
        return ", ".join(names)


@dataclass
class RecordingCorrelation:
    """Correlation between an audio recording and a meeting."""
    
    recording_filename: str
    recording_start_time: datetime
    meeting_info: Optional[MeetingInfo]
    correlation_confidence: float  # 0.0 - 1.0
    correlation_status: str        # "correlated", "manual", "failed", "pending"
    correlation_notes: Optional[str] = None
    
    @property
    def is_correlated(self) -> bool:
        """Check if recording is successfully correlated with a meeting."""
        return self.meeting_info is not None and self.correlation_confidence > 0.5
    
    @property
    def time_difference_minutes(self) -> Optional[int]:
        """Calculate time difference between recording and meeting start."""
        if not self.meeting_info:
            return None
        diff = abs((self.recording_start_time - self.meeting_info.start_time).total_seconds() / 60)
        return int(diff)


class CalendarService(ABC):
    """Abstract base class for calendar service implementations."""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.is_authenticated = False
        self.last_sync_time = None
        self._meeting_cache: Dict[str, MeetingInfo] = {}
    
    @abstractmethod
    async def authenticate(self) -> bool:
        """Authenticate with the calendar service."""
        pass
    
    @abstractmethod
    async def get_meetings(self, start_date: datetime, end_date: datetime) -> List[MeetingInfo]:
        """Get meetings within the specified date range."""
        pass
    
    @abstractmethod
    async def get_meeting_by_id(self, meeting_id: str) -> Optional[MeetingInfo]:
        """Get a specific meeting by its ID."""
        pass
    
    @abstractmethod
    def is_available(self) -> bool:
        """Check if the calendar service is available and configured."""
        pass
    
    def clear_cache(self):
        """Clear the meeting cache."""
        self._meeting_cache.clear()
        logger.info("Calendar cache cleared")
    
    def get_cached_meeting(self, meeting_id: str) -> Optional[MeetingInfo]:
        """Get a meeting from cache."""
        return self._meeting_cache.get(meeting_id)
    
    def cache_meeting(self, meeting: MeetingInfo):
        """Cache a meeting for faster access."""
        self._meeting_cache[meeting.id] = meeting


class MeetingCorrelator:
    """Handles correlation logic between recordings and meetings."""
    
    def __init__(self, calendar_service: CalendarService, correlation_window_minutes: int = 15):
        self.calendar_service = calendar_service
        self.correlation_window_minutes = correlation_window_minutes
        logger.info(f"MeetingCorrelator initialized with ±{correlation_window_minutes} minute window")
    
    async def correlate_recording(self, filename: str, recording_time: datetime) -> RecordingCorrelation:
        """
        Correlate a recording with a meeting based on timestamp.
        
        Args:
            filename: Name of the recording file
            recording_time: When the recording was created
            
        Returns:
            RecordingCorrelation object with correlation results
        """
        logger.debug(f"Correlating recording: {filename} at {recording_time}")
        
        if not self.calendar_service.is_available() or not self.calendar_service.is_authenticated:
            return RecordingCorrelation(
                recording_filename=filename,
                recording_start_time=recording_time,
                meeting_info=None,
                correlation_confidence=0.0,
                correlation_status="failed",
                correlation_notes="Calendar service not available or authenticated"
            )
        
        # Get meetings in the correlation window
        window_start = recording_time - timedelta(minutes=self.correlation_window_minutes)
        window_end = recording_time + timedelta(minutes=self.correlation_window_minutes)
        
        try:
            meetings = await self.calendar_service.get_meetings(window_start, window_end)
            logger.debug(f"Found {len(meetings)} meetings in correlation window")
            
            if not meetings:
                return RecordingCorrelation(
                    recording_filename=filename,
                    recording_start_time=recording_time,
                    meeting_info=None,
                    correlation_confidence=0.0,
                    correlation_status="failed",
                    correlation_notes="No meetings found in correlation window"
                )
            
            # Find the best matching meeting
            best_meeting, confidence = self._find_best_meeting_match(recording_time, meetings)
            
            if best_meeting and confidence > 0.5:
                status = "correlated"
                notes = f"Automatically correlated with {confidence:.1%} confidence"
            elif best_meeting:
                status = "manual"
                notes = f"Low confidence match ({confidence:.1%}) - needs manual verification"
            else:
                status = "failed"
                notes = "No suitable meeting found for correlation"
            
            return RecordingCorrelation(
                recording_filename=filename,
                recording_start_time=recording_time,
                meeting_info=best_meeting,
                correlation_confidence=confidence,
                correlation_status=status,
                correlation_notes=notes
            )
            
        except Exception as e:
            logger.error(f"Error correlating recording {filename}: {e}")
            return RecordingCorrelation(
                recording_filename=filename,
                recording_start_time=recording_time,
                meeting_info=None,
                correlation_confidence=0.0,
                correlation_status="failed",
                correlation_notes=f"Error during correlation: {str(e)}"
            )
    
    def _find_best_meeting_match(self, recording_time: datetime, meetings: List[MeetingInfo]) -> Tuple[Optional[MeetingInfo], float]:
        """
        Find the best meeting match for a recording based on multiple factors.
        
        Args:
            recording_time: When the recording was created
            meetings: List of candidate meetings
            
        Returns:
            Tuple of (best_meeting, confidence_score)
        """
        best_meeting = None
        best_score = 0.0
        
        for meeting in meetings:
            if meeting.is_cancelled:
                continue
                
            score = self._calculate_correlation_score(recording_time, meeting)
            logger.debug(f"Meeting '{meeting.subject}' score: {score:.3f}")
            
            if score > best_score:
                best_score = score
                best_meeting = meeting
        
        logger.debug(f"Best match: {best_meeting.subject if best_meeting else 'None'} with score {best_score:.3f}")
        return best_meeting, best_score
    
    def _calculate_correlation_score(self, recording_time: datetime, meeting: MeetingInfo) -> float:
        """
        Calculate correlation score between recording and meeting.
        
        Scoring factors:
        - Time proximity (0.0 - 0.6): Closer to meeting start = higher score
        - Duration match (0.0 - 0.2): Recording length vs meeting length
        - Attendee count (0.0 - 0.1): More attendees = higher score
        - Meeting type (0.0 - 0.1): Regular meetings vs all-day events
        
        Returns:
            Score between 0.0 and 1.0
        """
        score = 0.0
        
        # 1. Time proximity score (max 0.6)
        time_diff_minutes = abs((recording_time - meeting.start_time).total_seconds() / 60)
        if time_diff_minutes <= 5:
            score += 0.6
        elif time_diff_minutes <= 10:
            score += 0.4
        elif time_diff_minutes <= self.correlation_window_minutes:
            score += 0.2
        
        # 2. Duration relevance (max 0.2)
        if not meeting.is_all_day and meeting.duration_minutes > 5:  # Reasonable meeting duration
            score += 0.2
        
        # 3. Attendee count bonus (max 0.1)
        attendee_bonus = min(meeting.attendee_count * 0.02, 0.1)
        score += attendee_bonus
        
        # 4. Meeting type bonus (max 0.1)
        if not meeting.is_all_day and meeting.subject and len(meeting.subject.strip()) > 3:
            score += 0.1
        
        return min(score, 1.0)  # Cap at 1.0
    
    async def correlate_multiple_recordings(self, recordings: List[Tuple[str, datetime]]) -> List[RecordingCorrelation]:
        """
        Correlate multiple recordings efficiently.
        
        Args:
            recordings: List of (filename, recording_time) tuples
            
        Returns:
            List of RecordingCorrelation objects
        """
        correlations = []
        
        for filename, recording_time in recordings:
            correlation = await self.correlate_recording(filename, recording_time)
            correlations.append(correlation)
        
        return correlations
    
    def get_correlation_statistics(self, correlations: List[RecordingCorrelation]) -> Dict[str, Any]:
        """Get statistics about correlation results."""
        if not correlations:
            return {"total": 0}
        
        total = len(correlations)
        correlated = sum(1 for c in correlations if c.correlation_status == "correlated")
        manual = sum(1 for c in correlations if c.correlation_status == "manual")
        failed = sum(1 for c in correlations if c.correlation_status == "failed")
        
        avg_confidence = sum(c.correlation_confidence for c in correlations if c.meeting_info) / max(1, correlated + manual)
        
        return {
            "total": total,
            "correlated": correlated,
            "manual": manual,
            "failed": failed,
            "success_rate": (correlated / total) * 100 if total > 0 else 0,
            "average_confidence": avg_confidence
        }


class CalendarServiceFactory:
    """Factory for creating calendar service instances."""
    
    @staticmethod
    def create_service(provider: CalendarProvider, config: Dict[str, Any]) -> CalendarService:
        """Create a calendar service instance."""
        if provider == CalendarProvider.OUTLOOK:
            from .outlook_calendar_service import OutlookCalendarService
            return OutlookCalendarService(config)
        else:
            raise ValueError(f"Unsupported calendar provider: {provider}")
    
    @staticmethod
    def get_available_providers() -> List[CalendarProvider]:
        """Get list of available calendar providers."""
        # For Phase 1, only Outlook is implemented
        return [CalendarProvider.OUTLOOK]
