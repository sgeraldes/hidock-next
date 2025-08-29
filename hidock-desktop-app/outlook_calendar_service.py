# outlook_calendar_service.py
"""
Outlook Calendar Service for HiDock Desktop App.

⚠️  CALENDAR INTEGRATION DISABLED BY DEFAULT ⚠️

This module requires enterprise-level Azure AD credentials that regular users
don't have access to, so it's disabled by default.

For advanced users who want calendar integration:
1. Install optional dependency: pip install hidock-next[calendar]
2. Enable in configuration: calendar_provider = "outlook"
3. Configure Azure AD credentials in Settings

This module provides integration with Microsoft Outlook calendar via the O365 library,
allowing audio files to be correlated with calendar meetings for enhanced metadata.
"""

import datetime
import json
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import threading
import time

from config_and_logger import logger

try:
    from O365 import Account
    from O365.calendar import Calendar, Event, Schedule
    OUTLOOK_AVAILABLE = True
except ImportError:
    OUTLOOK_AVAILABLE = False
    # Create dummy classes for type hints when O365 is not available
    Event = object
    Schedule = object
    Account = object
    Calendar = object
    logger.warning(
        "OutlookService", 
        "ImportError", 
        "O365 library not available. Install with: pip install O365[calendar]"
    )


class MeetingMetadata:
    """Represents meeting metadata extracted from Outlook calendar."""
    
    def __init__(self, event_data: Dict):
        self.event_id: str = event_data.get('id', '')
        self.subject: str = event_data.get('subject', '')
        self.organizer: str = event_data.get('organizer', '')
        self.attendees: List[str] = event_data.get('attendees', [])
        self.start_time: datetime = event_data.get('start_time')
        self.end_time: datetime = event_data.get('end_time')
        self.location: str = event_data.get('location', '')
        self.body: str = event_data.get('body', '')
        self.meeting_url: str = event_data.get('meeting_url', '')
        # Use proper URL parsing for security
        self.is_teams_meeting: bool = False
        if self.meeting_url:
            from urllib.parse import urlparse
            try:
                parsed = urlparse(self.meeting_url)
                self.is_teams_meeting = parsed.hostname and parsed.hostname.endswith('teams.microsoft.com')
            except Exception:
                self.is_teams_meeting = False
        self.is_recurring: bool = event_data.get('is_recurring', False)
        self.categories: List[str] = event_data.get('categories', [])
        self.sensitivity: str = event_data.get('sensitivity', 'normal')
        
    def to_dict(self) -> Dict:
        """Convert meeting metadata to dictionary for storage."""
        return {
            'event_id': self.event_id,
            'subject': self.subject,
            'organizer': self.organizer,
            'attendees': self.attendees,
            'start_time': self.start_time.isoformat() if self.start_time else None,
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'location': self.location,
            'body': self.body,
            'meeting_url': self.meeting_url,
            'is_teams_meeting': self.is_teams_meeting,
            'is_recurring': self.is_recurring,
            'categories': self.categories,
            'sensitivity': self.sensitivity
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'MeetingMetadata':
        """Create MeetingMetadata from dictionary."""
        # Create a copy to avoid modifying the original
        data_copy = data.copy()
        
        # Handle datetime parsing
        if 'start_time' in data_copy and data_copy['start_time']:
            data_copy['start_time'] = datetime.fromisoformat(data_copy['start_time'].replace('Z', '+00:00'))
        if 'end_time' in data_copy and data_copy['end_time']:
            data_copy['end_time'] = datetime.fromisoformat(data_copy['end_time'].replace('Z', '+00:00'))
        
        # Map event_id back to id for constructor
        if 'event_id' in data_copy:
            data_copy['id'] = data_copy['event_id']
        
        return cls(data_copy)


class OutlookCalendarService:
    """Service for integrating with Microsoft Outlook calendar."""
    
    def __init__(self, config):
        self.config = config
        self.account: Optional[Account] = None
        self.schedule: Optional[Schedule] = None
        self.cache_file = "outlook_calendar_cache.json"
        self.cache_duration = 3600  # 1 hour cache
        self._cache_lock = threading.Lock()
        self._meeting_cache: Dict[str, MeetingMetadata] = {}
        self._last_cache_update = 0
        self._is_authenticated = False
        
    def is_available(self) -> bool:
        """Check if Outlook integration is available."""
        return OUTLOOK_AVAILABLE
    
    def is_enabled(self) -> bool:
        """Check if Outlook integration is enabled in settings."""
        return self.config.get("calendar_provider", "disabled") == "outlook"
    
    def is_authenticated(self) -> bool:
        """Check if user is authenticated with Outlook."""
        return self._is_authenticated and self.account is not None
    
    def authenticate(self, client_id: str, client_secret: str, tenant_id: str = 'common') -> bool:
        """
        Authenticate with Microsoft Outlook/Office 365.
        
        Args:
            client_id: Azure AD application client ID
            client_secret: Azure AD application client secret
            tenant_id: Azure AD tenant ID (default: 'common')
            
        Returns:
            True if authentication successful, False otherwise
        """
        if not OUTLOOK_AVAILABLE:
            logger.error("OutlookService", "authenticate", "O365 library not available")
            return False
            
        try:
            credentials = (client_id, client_secret)
            
            # Set up scopes for calendar access
            scopes = ['https://graph.microsoft.com/Calendars.Read']
            
            self.account = Account(
                credentials, 
                auth_flow_type='authorization',
                tenant_id=tenant_id
            )
            
            # Authenticate
            if self.account.authenticate(scopes=scopes):
                self.schedule = self.account.schedule()
                self._is_authenticated = True
                logger.info("OutlookService", "authenticate", "Successfully authenticated with Outlook")
                
                # Save credentials securely (encrypted)
                self._save_credentials(client_id, client_secret, tenant_id)
                return True
            else:
                logger.error("OutlookService", "authenticate", "Failed to authenticate with Outlook")
                return False
                
        except Exception as e:
            logger.error("OutlookService", "authenticate", f"Authentication error: {e}")
            return False
    
    def _save_credentials(self, client_id: str, client_secret: str, tenant_id: str):
        """Save credentials to config (Note: For now, credentials are managed via settings UI)."""
        try:
            # Credentials are saved via the settings UI encryption system
            # This method is kept for compatibility but doesn't implement encryption here
            logger.info("OutlookService", "_save_credentials", "Credentials should be saved via settings UI")
        except Exception as e:
            logger.error("OutlookService", "_save_credentials", f"Error saving credentials: {e}")
    
    def _load_credentials(self) -> Optional[Tuple[str, str, str]]:
        """Load credentials from config."""
        try:
            client_id = self.config.get('calendar_outlook_client_id', '')
            # Note: Client secret decryption should be handled by the caller
            client_secret_encrypted = self.config.get('calendar_outlook_client_secret_encrypted', '')
            tenant_id = self.config.get('calendar_outlook_tenant_id', 'common')
            
            if not client_id or not client_secret_encrypted:
                return None
                
            # For now, return the encrypted secret - decryption will be handled elsewhere
            return client_id, client_secret_encrypted, tenant_id
        except Exception as e:
            logger.error("OutlookService", "_load_credentials", f"Error loading credentials: {e}")
            return None
    
    def auto_authenticate(self) -> bool:
        """Attempt to authenticate using saved credentials."""
        if not self.is_enabled():
            return False
            
        credentials = self._load_credentials()
        if not credentials:
            return False
            
        client_id, client_secret, tenant_id = credentials
        return self.authenticate(client_id, client_secret, tenant_id)
    
    def get_meetings_for_date_range(self, start_date: datetime, end_date: datetime) -> List[MeetingMetadata]:
        """
        Retrieve meetings from Outlook calendar for a specific date range.
        
        Args:
            start_date: Start of date range
            end_date: End of date range
            
        Returns:
            List of MeetingMetadata objects
        """
        if not self.is_authenticated():
            logger.warning("OutlookService", "get_meetings", "Not authenticated")
            return []
        
        try:
            # Check cache first
            cached_meetings = self._get_cached_meetings(start_date, end_date)
            if cached_meetings is not None:
                return cached_meetings
            
            # Fetch from Outlook
            calendar = self.schedule.get_default_calendar()
            
            # Query events in the date range
            query = calendar.new_query('start').greater_equal(start_date)
            query = query.chain('and').on_attribute('end').less_equal(end_date)
            
            events = calendar.get_events(
                query=query,
                include_recurring=True,
                limit=100  # Reasonable limit
            )
            
            meetings = []
            for event in events:
                meeting_data = self._extract_meeting_data(event)
                meeting = MeetingMetadata(meeting_data)
                meetings.append(meeting)
            
            # Cache the results
            self._cache_meetings(meetings, start_date, end_date)
            
            logger.info("OutlookService", "get_meetings", f"Retrieved {len(meetings)} meetings from Outlook")
            return meetings
            
        except Exception as e:
            logger.error("OutlookService", "get_meetings", f"Error retrieving meetings: {e}")
            return []
    
    def _extract_meeting_data(self, event: Event) -> Dict:
        """Extract meeting data from Outlook Event object."""
        try:
            # Extract attendees
            attendees = []
            if hasattr(event, 'attendees') and event.attendees:
                for attendee in event.attendees:
                    attendees.append(attendee.address if hasattr(attendee, 'address') else str(attendee))
            
            # Extract organizer
            organizer = ""
            if hasattr(event, 'organizer') and event.organizer:
                organizer = event.organizer.address if hasattr(event.organizer, 'address') else str(event.organizer)
            
            # Extract meeting URL from body or location
            meeting_url = ""
            body_text = event.get_body_text() if hasattr(event, 'get_body_text') else ""
            
            # Look for Teams/meeting URLs in body or location
            for text in [body_text, event.location or ""]:
                # Use proper URL parsing for security
                import re
                from urllib.parse import urlparse
                # Extract potential URLs
                url_matches = re.findall(r'https?://[^\s<>"\']+', text)
                for url in url_matches:
                    try:
                        parsed = urlparse(url)
                        if parsed.hostname and parsed.hostname.endswith('teams.microsoft.com'):
                            meeting_url = url
                            break
                    except Exception:
                        continue
                else:
                    # Legacy fallback for direct Teams URL pattern matching
                    teams_match = re.search(r'https://teams\.microsoft\.com/[^\s<>"\']+', text)
                    if teams_match:
                        meeting_url = teams_match.group()
                        break
                elif 'zoom.us' in text.lower():
                    # Extract Zoom URL
                    import re
                    zoom_match = re.search(r'https://[\w-]+\.zoom\.us/[^\s<>"\']+', text)
                    if zoom_match:
                        meeting_url = zoom_match.group()
                        break
            
            return {
                'id': event.object_id if hasattr(event, 'object_id') else '',
                'subject': event.subject or 'No Subject',
                'organizer': organizer,
                'attendees': attendees,
                'start_time': event.start,
                'end_time': event.end,
                'location': event.location or '',
                'body': body_text,
                'meeting_url': meeting_url,
                'is_recurring': hasattr(event, 'recurrence') and event.recurrence is not None,
                'categories': getattr(event, 'categories', []) or [],
                'sensitivity': getattr(event, 'sensitivity', 'normal') or 'normal'
            }
        except Exception as e:
            logger.error("OutlookService", "_extract_meeting_data", f"Error extracting meeting data: {e}")
            return {
                'id': '',
                'subject': 'Error extracting meeting data',
                'organizer': '',
                'attendees': [],
                'start_time': None,
                'end_time': None,
                'location': '',
                'body': '',
                'meeting_url': '',
                'is_recurring': False,
                'categories': [],
                'sensitivity': 'normal'
            }
    
    def find_meeting_for_audio_file(self, file_datetime: datetime, duration_seconds: int = None) -> Optional[MeetingMetadata]:
        """
        Find the most likely meeting that corresponds to an audio file.
        
        Args:
            file_datetime: Start time of the audio file
            duration_seconds: Duration of audio file (optional)
            
        Returns:
            MeetingMetadata object if a matching meeting is found, None otherwise
        """
        if not self.is_authenticated():
            return None
        
        # Search within a reasonable window around the file time
        search_start = file_datetime - timedelta(hours=2)  # 2 hours before
        search_end = file_datetime + timedelta(hours=6)    # 6 hours after
        
        meetings = self.get_meetings_for_date_range(search_start, search_end)
        if not meetings:
            return None
        
        # Find meetings that the audio file could belong to
        candidate_meetings = []
        
        for meeting in meetings:
            if not meeting.start_time or not meeting.end_time:
                continue
            
            # Check if audio file starts during the meeting
            # This is the primary criterion as specified
            if meeting.start_time <= file_datetime <= meeting.end_time:
                candidate_meetings.append((meeting, 0))  # Exact match gets priority 0
                
            # Also consider meetings that started up to 30 minutes before audio
            # (in case recording started late)
            elif (meeting.start_time <= file_datetime <= 
                  meeting.start_time + timedelta(minutes=30)):
                candidate_meetings.append((meeting, 1))  # Close match gets priority 1
        
        if not candidate_meetings:
            return None
        
        # Sort by priority (0 = exact match, 1 = close match) and return best match
        candidate_meetings.sort(key=lambda x: x[1])
        best_meeting = candidate_meetings[0][0]
        
        logger.info(
            "OutlookService", 
            "find_meeting", 
            f"Found meeting '{best_meeting.subject}' for audio file at {file_datetime}"
        )
        
        return best_meeting
    
    def _get_cached_meetings(self, start_date: datetime, end_date: datetime) -> Optional[List[MeetingMetadata]]:
        """Get meetings from cache if available and not expired."""
        with self._cache_lock:
            try:
                if not os.path.exists(self.cache_file):
                    return None
                
                # Check if cache is expired
                if time.time() - self._last_cache_update > self.cache_duration:
                    return None
                
                with open(self.cache_file, 'r', encoding='utf-8') as f:
                    cache_data = json.load(f)
                
                # Check if requested date range is covered by cache
                cache_start = datetime.fromisoformat(cache_data.get('start_date', ''))
                cache_end = datetime.fromisoformat(cache_data.get('end_date', ''))
                
                if start_date >= cache_start and end_date <= cache_end:
                    meetings = []
                    for meeting_data in cache_data.get('meetings', []):
                        meeting = MeetingMetadata.from_dict(meeting_data)
                        meetings.append(meeting)
                    
                    logger.info("OutlookService", "_get_cached_meetings", f"Loaded {len(meetings)} meetings from cache")
                    return meetings
                
                return None
                
            except Exception as e:
                logger.warning("OutlookService", "_get_cached_meetings", f"Error reading cache: {e}")
                return None
    
    def _cache_meetings(self, meetings: List[MeetingMetadata], start_date: datetime, end_date: datetime):
        """Cache meetings to file."""
        with self._cache_lock:
            try:
                cache_data = {
                    'start_date': start_date.isoformat(),
                    'end_date': end_date.isoformat(),
                    'timestamp': time.time(),
                    'meetings': [meeting.to_dict() for meeting in meetings]
                }
                
                with open(self.cache_file, 'w', encoding='utf-8') as f:
                    json.dump(cache_data, f, indent=2, ensure_ascii=False)
                
                self._last_cache_update = time.time()
                logger.info("OutlookService", "_cache_meetings", f"Cached {len(meetings)} meetings")
                
            except Exception as e:
                logger.error("OutlookService", "_cache_meetings", f"Error caching meetings: {e}")
    
    def clear_cache(self):
        """Clear the meeting cache."""
        with self._cache_lock:
            try:
                if os.path.exists(self.cache_file):
                    os.remove(self.cache_file)
                self._meeting_cache.clear()
                self._last_cache_update = 0
                logger.info("OutlookService", "clear_cache", "Meeting cache cleared")
            except Exception as e:
                logger.error("OutlookService", "clear_cache", f"Error clearing cache: {e}")
    
    def test_connection(self) -> bool:
        """Test the Outlook connection."""
        try:
            if not self.is_authenticated():
                return False
            
            # Try to get the default calendar
            calendar = self.schedule.get_default_calendar()
            if calendar:
                logger.info("OutlookService", "test_connection", "Connection test successful")
                return True
            else:
                logger.warning("OutlookService", "test_connection", "Could not access default calendar")
                return False
                
        except Exception as e:
            logger.error("OutlookService", "test_connection", f"Connection test failed: {e}")
            return False
    
    def get_status_info(self) -> Dict[str, str]:
        """Get status information for display in UI."""
        status = {
            'available': 'Yes' if self.is_available() else 'No (O365 library missing)',
            'enabled': 'Yes' if self.is_enabled() else 'No',
            'authenticated': 'Yes' if self.is_authenticated() else 'No',
            'cache_age': 'N/A'
        }
        
        if os.path.exists(self.cache_file):
            try:
                age_seconds = time.time() - self._last_cache_update
                if age_seconds < 60:
                    status['cache_age'] = f"{age_seconds:.0f} seconds"
                elif age_seconds < 3600:
                    status['cache_age'] = f"{age_seconds/60:.0f} minutes"
                else:
                    status['cache_age'] = f"{age_seconds/3600:.1f} hours"
            except:
                status['cache_age'] = 'Unknown'
        
        return status
