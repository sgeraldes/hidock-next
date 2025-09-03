# outlook_integration_mixin.py
"""
Outlook Integration Mixin for HiDock Desktop App.

This mixin provides methods to enhance audio file data with meeting metadata
from Microsoft Outlook calendar, correlating recordings with scheduled meetings.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional
import threading

from config_and_logger import logger
from outlook_calendar_service import OutlookCalendarService, MeetingMetadata


class OutlookIntegrationMixin:
    """Mixin for integrating Outlook calendar data with audio files."""
    
    def _initialize_outlook_integration(self):
        """Initialize Outlook integration service."""
        if not hasattr(self, 'outlook_service'):
            self.outlook_service = OutlookCalendarService(self.config_manager)
            self._outlook_lock = threading.Lock()
            
            # Auto-authenticate on startup if enabled
            if self.outlook_service.is_enabled():
                threading.Thread(
                    target=self._auto_authenticate_outlook, 
                    daemon=True
                ).start()
    
    def _auto_authenticate_outlook(self):
        """Attempt to auto-authenticate with Outlook in background."""
        try:
            if self.outlook_service.auto_authenticate():
                logger.info("OutlookIntegration", "_auto_authenticate", "Auto-authentication successful")
                # Update status in UI thread
                self.after(0, lambda: logger.info("OutlookIntegration", "UI", "Outlook connected"))
            else:
                logger.info("OutlookIntegration", "_auto_authenticate", "Auto-authentication failed or not configured")
        except Exception as e:
            logger.error("OutlookIntegration", "_auto_authenticate", f"Auto-authentication error: {e}")
    
    def enhance_files_with_meeting_data(self, files_dict: List[Dict]) -> List[Dict]:
        """
        Enhance file data with meeting metadata from Outlook calendar.
        
        Args:
            files_dict: List of file dictionaries from the device
            
        Returns:
            Enhanced list with meeting metadata added
        """
        if not hasattr(self, 'outlook_service'):
            self._initialize_outlook_integration()
            
        if not self.outlook_service.is_enabled() or not self.outlook_service.is_authenticated():
            # Add empty meeting fields to maintain consistent data structure
            return self._add_empty_meeting_fields(files_dict)
        
        try:
            with self._outlook_lock:
                # Process files in batches to avoid overwhelming the API
                enhanced_files = []
                
                for file_data in files_dict:
                    enhanced_file = file_data.copy()
                    
                    # Parse file creation datetime
                    file_datetime = self._parse_file_datetime(file_data)
                    
                    if file_datetime:
                        # Find matching meeting
                        meeting = self.outlook_service.find_meeting_for_audio_file(
                            file_datetime,
                            duration_seconds=file_data.get('duration', 0)
                        )
                        
                        if meeting:
                            enhanced_file.update(self._create_meeting_fields(meeting))
                            logger.debug(
                                "OutlookIntegration", 
                                "enhance_files", 
                                f"Matched '{file_data['name']}' with meeting '{meeting.subject}'"
                            )
                        else:
                            enhanced_file.update(self._create_empty_meeting_fields())
                    else:
                        enhanced_file.update(self._create_empty_meeting_fields())
                    
                    enhanced_files.append(enhanced_file)
                
                return enhanced_files
                
        except Exception as e:
            logger.error("OutlookIntegration", "enhance_files", f"Error enhancing files with meeting data: {e}")
            # Return original data with empty meeting fields on error
            return self._add_empty_meeting_fields(files_dict)
    
    def _parse_file_datetime(self, file_data: Dict) -> Optional[datetime]:
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
            logger.warning("OutlookIntegration", "_parse_file_datetime", f"Error parsing datetime for {file_data.get('name', 'unknown')}: {e}")
            return None
    
    def _create_meeting_fields(self, meeting: MeetingMetadata) -> Dict:
        """Create meeting fields dictionary from MeetingMetadata."""
        # Truncate long fields for display
        subject = meeting.subject[:50] + "..." if len(meeting.subject) > 50 else meeting.subject
        organizer = meeting.organizer.split('@')[0] if meeting.organizer and '@' in meeting.organizer else meeting.organizer
        
        # Format attendees count
        attendees_count = len(meeting.attendees) if meeting.attendees else 0
        attendees_display = f"{attendees_count} attendees" if attendees_count > 1 else f"{attendees_count} attendee" if attendees_count == 1 else "No attendees"
        
        # Determine meeting type
        meeting_type = self._determine_meeting_type(meeting)
        
        return {
            'has_meeting': True,
            'meeting_subject': subject,
            'meeting_organizer': organizer,
            'meeting_attendees_display': attendees_display,
            'meeting_attendees_count': attendees_count,
            'meeting_location': meeting.location,
            'meeting_type': meeting_type,
            'meeting_url': meeting.meeting_url,
            'meeting_start_time': meeting.start_time,
            'meeting_end_time': meeting.end_time,
            'meeting_body': meeting.body,
            'meeting_categories': meeting.categories,
            'meeting_sensitivity': meeting.sensitivity,
            'is_recurring_meeting': meeting.is_recurring,
            'is_teams_meeting': meeting.is_teams_meeting,
            # Full meeting metadata (for detailed view)
            'meeting_full_attendees': meeting.attendees,
            'meeting_event_id': meeting.event_id
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
            'meeting_url': '',
            'meeting_start_time': None,
            'meeting_end_time': None,
            'meeting_body': '',
            'meeting_categories': [],
            'meeting_sensitivity': 'normal',
            'is_recurring_meeting': False,
            'is_teams_meeting': False,
            'meeting_full_attendees': [],
            'meeting_event_id': ''
        }
    
    def _add_empty_meeting_fields(self, files_dict: List[Dict]) -> List[Dict]:
        """Add empty meeting fields to all files."""
        empty_fields = self._create_empty_meeting_fields()
        for file_data in files_dict:
            file_data.update(empty_fields)
        return files_dict
    
    def _determine_meeting_type(self, meeting: MeetingMetadata) -> str:
        """Determine the type of meeting based on metadata."""
        if meeting.is_teams_meeting:
            return "Teams"
        elif "zoom.us" in meeting.meeting_url.lower():
            return "Zoom"
        elif meeting.location:
            return "In-person"
        elif meeting.meeting_url:
            return "Online"
        else:
            return "Meeting"
    
    def get_meeting_details_for_file(self, filename: str) -> Optional[Dict]:
        """Get detailed meeting information for a specific file."""
        # Find the file in displayed_files_details
        file_data = next(
            (f for f in self.displayed_files_details if f.get('name') == filename), 
            None
        )
        
        if not file_data or not file_data.get('has_meeting'):
            return None
        
        return {
            'subject': file_data.get('meeting_subject', ''),
            'organizer': file_data.get('meeting_organizer', ''),
            'attendees': file_data.get('meeting_full_attendees', []),
            'attendees_count': file_data.get('meeting_attendees_count', 0),
            'location': file_data.get('meeting_location', ''),
            'start_time': file_data.get('meeting_start_time'),
            'end_time': file_data.get('meeting_end_time'),
            'meeting_type': file_data.get('meeting_type', ''),
            'meeting_url': file_data.get('meeting_url', ''),
            'body': file_data.get('meeting_body', ''),
            'categories': file_data.get('meeting_categories', []),
            'is_recurring': file_data.get('is_recurring_meeting', False),
            'is_teams_meeting': file_data.get('is_teams_meeting', False),
            'sensitivity': file_data.get('meeting_sensitivity', 'normal')
        }
    
    def refresh_meeting_data(self):
        """Force refresh of meeting data by clearing cache."""
        if hasattr(self, 'outlook_service'):
            self.outlook_service.clear_cache()
            logger.info("OutlookIntegration", "refresh_meeting_data", "Meeting cache cleared")
            
            # Refresh file list to reload meeting data
            if hasattr(self, 'refresh_file_list_gui'):
                self.refresh_file_list_gui()
    
    def configure_outlook_integration(self, client_id: str, client_secret: str, tenant_id: str = 'common') -> bool:
        """
        Configure and authenticate Outlook integration.
        
        Args:
            client_id: Azure AD application client ID
            client_secret: Azure AD application client secret
            tenant_id: Azure AD tenant ID
            
        Returns:
            True if configuration successful, False otherwise
        """
        if not hasattr(self, 'outlook_service'):
            self._initialize_outlook_integration()
        
        try:
            # Enable the integration
            self.config_manager.set("outlook_integration_enabled", True)
            
            # Authenticate
            if self.outlook_service.authenticate(client_id, client_secret, tenant_id):
                logger.info("OutlookIntegration", "configure", "Outlook integration configured successfully")
                
                # Test the connection
                if self.outlook_service.test_connection():
                    # Refresh file list to load meeting data
                    if hasattr(self, 'refresh_file_list_gui'):
                        self.after(1000, self.refresh_file_list_gui)  # Delay to allow UI to update
                    return True
                else:
                    logger.warning("OutlookIntegration", "configure", "Connection test failed")
                    return False
            else:
                logger.error("OutlookIntegration", "configure", "Authentication failed")
                return False
                
        except Exception as e:
            logger.error("OutlookIntegration", "configure", f"Configuration error: {e}")
            return False
    
    def disable_outlook_integration(self):
        """Disable Outlook integration."""
        try:
            self.config_manager.set("outlook_integration_enabled", False)
            
            if hasattr(self, 'outlook_service'):
                self.outlook_service.clear_cache()
            
            logger.info("OutlookIntegration", "disable", "Outlook integration disabled")
            
            # Refresh file list to remove meeting data
            if hasattr(self, 'refresh_file_list_gui'):
                self.refresh_file_list_gui()
                
        except Exception as e:
            logger.error("OutlookIntegration", "disable", f"Error disabling Outlook integration: {e}")
    
    def get_outlook_status(self) -> Dict[str, str]:
        """Get Outlook integration status for display in UI."""
        if not hasattr(self, 'outlook_service'):
            return {
                'available': 'Not initialized',
                'enabled': 'No',
                'authenticated': 'No',
                'cache_age': 'N/A'
            }
        
        return self.outlook_service.get_status_info()
