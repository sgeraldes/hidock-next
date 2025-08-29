# simple_calendar_mixin.py
"""
Simple Calendar Integration Mixin for HiDock GUI

This mixin adds EASY calendar integration to the main GUI:
- Uses simple_outlook_integration.py for actual calendar access
- Enhances file listings with meeting information
- No complex setup required for users
"""

import logging
from datetime import datetime
from typing import Dict, List
import threading

from config_and_logger import logger

try:
    from simple_outlook_integration import create_simple_outlook_integration
    SIMPLE_CALENDAR_AVAILABLE = True
except ImportError:
    SIMPLE_CALENDAR_AVAILABLE = False


class SimpleCalendarMixin:
    """Simple calendar integration mixin for the main GUI."""
    
    def _ensure_calendar_initialized(self):
        """Ensure calendar integration is initialized (lazy initialization)."""
        if not hasattr(self, '_calendar_integration'):
            self._calendar_integration = None
            self._calendar_cache = {}
            self._calendar_cache_date = None
            self._initialize_simple_calendar()
    
    def _initialize_simple_calendar(self):
        """Initialize the simple calendar integration."""
        if not SIMPLE_CALENDAR_AVAILABLE:
            logger.debug("SimpleCalendar", "init", "Simple calendar integration not available")
            return
        
        try:
            self._calendar_integration = create_simple_outlook_integration()
            if self._calendar_integration.is_available():
                status = self._calendar_integration.get_integration_status()
                logger.info("SimpleCalendar", "init", f"Calendar integration ready: {status['available_methods']}")
            else:
                logger.info("SimpleCalendar", "init", "No calendar integration methods available")
        except Exception as e:
            logger.warning("SimpleCalendar", "init", f"Failed to initialize calendar integration: {e}")
    
    def enhance_files_with_meeting_data(self, files_dict: List[Dict]) -> List[Dict]:
        """
        Enhance file data with simple meeting information.
        
        Args:
            files_dict: List of file dictionaries from the device
            
        Returns:
            Enhanced list with meeting metadata added
        """
        # Ensure calendar is initialized
        self._ensure_calendar_initialized()
        
        if not SIMPLE_CALENDAR_AVAILABLE or not self._calendar_integration:
            return self._add_empty_meeting_fields(files_dict)
        
        if not self._calendar_integration.is_available():
            return self._add_empty_meeting_fields(files_dict)
        
        try:
            enhanced_files = []
            
            for file_data in files_dict:
                enhanced_file = file_data.copy()
                
                # Parse file creation datetime
                file_datetime = self._parse_file_datetime(file_data)
                
                if file_datetime:
                    # Find matching meeting
                    meeting = self._find_meeting_for_file(file_datetime)
                    
                    if meeting:
                        enhanced_file.update(self._create_simple_meeting_fields(meeting))
                        logger.debug("SimpleCalendar", "enhance_files", 
                                   f"Matched '{file_data['name']}' with meeting '{meeting.subject}'")
                    else:
                        enhanced_file.update(self._create_empty_meeting_fields())
                else:
                    enhanced_file.update(self._create_empty_meeting_fields())
                
                enhanced_files.append(enhanced_file)
            
            return enhanced_files
            
        except Exception as e:
            logger.warning("SimpleCalendar", "enhance_files", f"Error enhancing files with meeting data: {e}")
            # Return original data with empty meeting fields on error
            return self._add_empty_meeting_fields(files_dict)
    
    def _parse_file_datetime(self, file_data: Dict) -> datetime:
        """Parse datetime from file data."""
        try:
            # Try the 'time' field first (datetime object)
            if 'time' in file_data and file_data['time']:
                if isinstance(file_data['time'], datetime):
                    return file_data['time']
            
            # Fall back to combining createDate and createTime
            create_date = file_data.get('createDate', '')
            create_time = file_data.get('createTime', '')
            
            if create_date and create_time and create_date != '---' and create_time != '---':
                datetime_str = f"{create_date} {create_time}"
                # Handle different date formats
                for fmt in ["%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"]:
                    try:
                        return datetime.strptime(datetime_str, fmt)
                    except ValueError:
                        continue
            
            return None
            
        except Exception as e:
            logger.debug("SimpleCalendar", "_parse_file_datetime", 
                        f"Error parsing datetime for {file_data.get('name', 'unknown')}: {e}")
            return None
    
    def _find_meeting_for_file(self, file_datetime: datetime):
        """Find meeting for file datetime with caching."""
        try:
            # Check cache first (cache meetings for the whole day)
            cache_date = file_datetime.date()
            if self._calendar_cache_date != cache_date:
                # Cache expired or different date, refresh
                self._calendar_cache = {}
                self._calendar_cache_date = cache_date
                
                # Get meetings for this date
                meetings = self._calendar_integration.get_meetings_for_date(file_datetime)
                for meeting in meetings:
                    # Cache by hour to make lookup faster
                    hour_key = meeting.start_time.hour
                    if hour_key not in self._calendar_cache:
                        self._calendar_cache[hour_key] = []
                    self._calendar_cache[hour_key].append(meeting)
            
            # Find best match from cache
            return self._calendar_integration.find_meeting_for_recording(file_datetime, tolerance_minutes=20)
            
        except Exception as e:
            logger.debug("SimpleCalendar", "_find_meeting_for_file", f"Error finding meeting: {e}")
            return None
    
    def _create_simple_meeting_fields(self, meeting) -> Dict:
        """Create simple meeting fields dictionary."""
        # Clean and format subject and organizer for display
        subject = meeting.subject if meeting.subject else 'No Subject'
        organizer = meeting.organizer if meeting.organizer else 'Unknown Organizer'
        
        # Clean up organizer (remove email domain and format name)
        if '@' in organizer:
            organizer = organizer.split('@')[0].replace('.', ' ').title()
        
        # Create combined display text: "Subject - Organizer"
        meeting_display_text = subject
        if organizer and organizer != 'Unknown Organizer':
            meeting_display_text += f" - {organizer}"
        
        # Truncate for display if too long
        if len(meeting_display_text) > 60:
            meeting_display_text = meeting_display_text[:57] + "..."
        
        # Format attendees
        attendee_count = len(meeting.attendees)
        if attendee_count > 1:
            attendees_display = f"{attendee_count} attendees"
        elif attendee_count == 1:
            attendees_display = "1 attendee"
        else:
            attendees_display = "No attendees"
        
        # Determine meeting type
        meeting_type = "In-person" if meeting.location else "Virtual"
        if meeting.location:
            location_lower = meeting.location.lower()
            # Use proper URL parsing for security
            from urllib.parse import urlparse
            try:
                # Check if location contains URLs and parse them
                import re
                urls = re.findall(r'https?://[^\s<>"\']+', location_lower)
                for url in urls:
                    parsed = urlparse(url)
                    hostname = parsed.hostname
                    if hostname and hostname.endswith("teams.microsoft.com"):
                        meeting_type = "Teams"
                        break
                    elif hostname and hostname.endswith("zoom.us"):
                        meeting_type = "Zoom"
                        break
                else:
                    # Fallback for simple text matching (non-URL context)
                    if "teams meeting" in location_lower or "microsoft teams" in location_lower:
                        meeting_type = "Teams"
                    elif "zoom meeting" in location_lower:
                        meeting_type = "Zoom"
            except Exception:
                # Fallback for parsing errors
                if "teams meeting" in location_lower or "microsoft teams" in location_lower:
                    meeting_type = "Teams"
                elif "zoom meeting" in location_lower:
                    meeting_type = "Zoom"
        
        return {
            'has_meeting': True,
            'meeting_subject': subject,
            'meeting_organizer': organizer,
            'meeting_attendees_display': attendees_display,
            'meeting_attendees_count': attendee_count,
            'meeting_location': meeting.location,
            'meeting_type': meeting_type,
            'meeting_start_time': meeting.start_time,
            'meeting_end_time': meeting.end_time,
            'meeting_duration_minutes': meeting.duration_minutes,
            # Simplified fields
            'meeting_time_display': meeting.start_time.strftime("%H:%M"),
            'meeting_date_display': meeting.start_time.strftime("%Y-%m-%d"),
            'meeting_display_text': meeting_display_text  # For treeview column display
        }
    
    def _create_empty_meeting_fields(self) -> Dict:
        """Create empty meeting fields for files without meetings."""
        return {
            'has_meeting': False,
            'meeting_subject': '',
            'meeting_organizer': '',
            'meeting_attendees_display': '',
            'meeting_attendees_count': 0,
            'meeting_location': '',
            'meeting_type': '',
            'meeting_start_time': None,
            'meeting_end_time': None,
            'meeting_duration_minutes': 0,
            'meeting_time_display': '',
            'meeting_date_display': '',
            'meeting_display_text': 'No Meeting'  # Grey text for GUI display
        }
    
    def _add_empty_meeting_fields(self, files_dict: List[Dict]) -> List[Dict]:
        """Add empty meeting fields to all files."""
        empty_fields = self._create_empty_meeting_fields()
        for file_data in files_dict:
            file_data.update(empty_fields)
        return files_dict
    
    def get_simple_calendar_status(self) -> Dict[str, str]:
        """Get status information for the simple calendar integration."""
        if not SIMPLE_CALENDAR_AVAILABLE:
            return {
                'status': 'Not Available',
                'message': 'Simple calendar integration module not found'
            }
        
        if not self._calendar_integration:
            return {
                'status': 'Not Initialized', 
                'message': 'Calendar integration failed to initialize'
            }
        
        if not self._calendar_integration.is_available():
            return {
                'status': 'No Methods Available',
                'message': 'No calendar access methods found. Install Outlook or export calendar as .ics file.'
            }
        
        status = self._calendar_integration.get_integration_status()
        return {
            'status': 'Available',
            'methods': status['available_methods'],
            'com_available': status['com_available'],
            'export_files': status['export_files_found'],
            'setup': status['recommended_setup']
        }
    
    def get_calendar_status_text_for_gui(self) -> str:
        """Get calendar status text for GUI status bar display."""
        # Ensure calendar is initialized
        self._ensure_calendar_initialized()
        
        if not SIMPLE_CALENDAR_AVAILABLE or not self._calendar_integration:
            return "Calendar: Not Available"
        
        return self._calendar_integration.get_calendar_status_text()
    
    def refresh_calendar_data(self) -> bool:
        """Manually refresh calendar data - for GUI refresh button."""
        # Ensure calendar is initialized
        self._ensure_calendar_initialized()
        
        if not SIMPLE_CALENDAR_AVAILABLE or not self._calendar_integration:
            return False
        
        try:
            # Clear our cache
            if hasattr(self, '_calendar_cache'):
                self._calendar_cache.clear()
                self._calendar_cache_date = None
            
            # Refresh the integration
            success = self._calendar_integration.refresh_calendar_data()
            
            if success:
                logger.info("SimpleCalendar", "refresh_calendar_data", "Calendar data refreshed successfully")
            else:
                logger.warning("SimpleCalendar", "refresh_calendar_data", "Calendar refresh failed")
            
            return success
            
        except Exception as e:
            logger.error("SimpleCalendar", "refresh_calendar_data", f"Error refreshing calendar: {e}")
            return False
