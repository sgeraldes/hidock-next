# simple_outlook_integration.py
"""
Simple Outlook Calendar Integration for HiDock Desktop App

This provides EASY calendar integration that regular users can actually use:
- Reads calendar data directly from local Outlook installation
- No Azure AD credentials required
- No enterprise setup needed
- Works with existing Outlook installations

Methods supported:
1. Windows COM API (if Outlook is installed)
2. PST file reading (if available)
3. Export file parsing (.ics files)
"""

import os
import sys
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Try to import Windows COM support
try:
    import win32com.client
    import pythoncom
    WIN32_AVAILABLE = True
except ImportError:
    WIN32_AVAILABLE = False

class SimpleMeeting:
    """Simple meeting representation."""
    
    def __init__(self, subject: str, start_time: datetime, end_time: datetime, 
                 organizer: str = "", location: str = "", attendees: List[str] = None):
        self.subject = subject
        self.start_time = start_time
        self.end_time = end_time
        self.organizer = organizer
        self.location = location
        self.attendees = attendees or []
        
    @property
    def duration_minutes(self) -> int:
        return int((self.end_time - self.start_time).total_seconds() / 60)


class SimpleOutlookIntegration:
    """Simple Outlook integration that works for regular users."""
    
    def __init__(self):
        self.outlook_app = None
        self.last_error = None
        self.last_sync_time = None
        self.cached_meetings = {}
        self.available_methods = self._detect_available_methods()
        
    def _detect_available_methods(self) -> List[str]:
        """Detect which integration methods are available."""
        methods = []
        self.last_error = None
        
        # Check for Windows Outlook COM - THIS IS THE PRIMARY METHOD
        if WIN32_AVAILABLE and sys.platform == "win32":
            try:
                pythoncom.CoInitialize()
                outlook = win32com.client.Dispatch("Outlook.Application")
                # Test that we can actually access the namespace
                namespace = outlook.GetNamespace("MAPI")
                
                # Try to get the default calendar - this will fail if not connected
                calendar = namespace.GetDefaultFolder(9)  # Test calendar access
                
                # Try to access calendar items - this ensures we can actually read data
                items = calendar.Items
                
                methods.append("com")
                logger.info("Simple Outlook: COM interface available and working")
                pythoncom.CoUninitialize()
                
            except Exception as e:
                error_msg = str(e)
                
                # Parse specific Outlook error messages
                if "not connected" in error_msg.lower():
                    self.last_error = "Outlook is not connected to mail server"
                elif "operation failed" in error_msg.lower():
                    self.last_error = "Outlook operation failed - check if Outlook is running"
                elif "0x8007007e" in error_msg:  # Outlook not installed
                    self.last_error = "Outlook application not found"
                else:
                    self.last_error = f"Outlook COM error: {error_msg}"
                    
                logger.warning(f"Simple Outlook: COM interface failed - {self.last_error}")
                try:
                    pythoncom.CoUninitialize()
                except:
                    pass
        else:
            self.last_error = "Windows COM interface not available"
        
        # REMOVED: ICS export file detection - you specified NO ICS!
        # Only use COM interface for Outlook integration
        
        return methods
    
    def _check_for_export_files(self) -> bool:
        """Check if there are any Outlook export files available."""
        common_paths = [
            os.path.expanduser("~/Documents/*.ics"),
            os.path.expanduser("~/Downloads/*.ics"),
            os.path.expanduser("~/Desktop/*.ics"),
        ]
        
        import glob
        for path in common_paths:
            if glob.glob(path):
                return True
        return False
    
    def is_available(self) -> bool:
        """Check if any integration method is available."""
        return len(self.available_methods) > 0
    
    def get_meetings_for_date(self, target_date: datetime) -> List[SimpleMeeting]:
        """Get meetings for a specific date using the best available method."""
        if not self.is_available():
            return []
            
        # Try COM first if available
        if "com" in self.available_methods:
            try:
                return self._get_meetings_via_com(target_date)
            except Exception as e:
                logger.warning(f"COM method failed: {e}")
        
        # Fall back to export files
        if "export" in self.available_methods:
            try:
                return self._get_meetings_via_export(target_date)
            except Exception as e:
                logger.warning(f"Export method failed: {e}")
        
        return []
    
    def _get_meetings_via_com(self, target_date: datetime) -> List[SimpleMeeting]:
        """Get meetings using Windows COM interface with retry logic."""
        if not WIN32_AVAILABLE:
            return []
            
        max_retries = 3
        retry_delay = 1.0  # seconds
        
        for attempt in range(max_retries):
            try:
                # Initialize COM
                pythoncom.CoInitialize()
                
                # Connect to Outlook with timeout consideration
                outlook = win32com.client.Dispatch("Outlook.Application")
                namespace = outlook.GetNamespace("MAPI")
            
                # Get the default calendar folder
                calendar = namespace.GetDefaultFolder(9)  # 9 = olFolderCalendar
            
                # Define date range (24 hours around target date)
                start_date = target_date.replace(hour=0, minute=0, second=0)
                end_date = start_date + timedelta(days=1)
                
                # Create filter for appointments in date range
                filter_string = f"[Start] >= '{start_date.strftime('%m/%d/%Y %H:%M')}' AND [Start] < '{end_date.strftime('%m/%d/%Y %H:%M')}'"
                
                # Get appointments
                appointments = calendar.Items
                # For single day queries, we can safely use IncludeRecurrences
                appointments.IncludeRecurrences = True
                appointments.Sort("[Start]")
                appointments = appointments.Restrict(filter_string)
                
                meetings = []
                for appointment in appointments:
                    try:
                        # Extract meeting details
                        subject = getattr(appointment, 'Subject', 'No Subject')
                        start_time = self._convert_outlook_time(appointment.Start)
                        end_time = self._convert_outlook_time(appointment.End)
                        organizer = getattr(appointment, 'Organizer', '')
                        location = getattr(appointment, 'Location', '')
                        
                        # Get attendees if available
                        attendees = []
                        try:
                            recipients = appointment.Recipients
                            for i in range(recipients.Count):
                                recipient = recipients.Item(i + 1)
                                attendees.append(recipient.Name)
                        except:
                            pass
                        
                        meeting = SimpleMeeting(
                            subject=subject,
                            start_time=start_time,
                            end_time=end_time,
                            organizer=organizer,
                            location=location,
                            attendees=attendees
                        )
                        meetings.append(meeting)
                        
                    except Exception as e:
                        logger.debug(f"Error processing appointment: {e}")
                        continue
                
                logger.info(f"Found {len(meetings)} meetings via COM for {target_date.date()}")
                return meetings
            
            except Exception as e:
                logger.warning(f"Outlook COM attempt {attempt + 1}/{max_retries} failed: {e}")
                try:
                    pythoncom.CoUninitialize()
                except:
                    pass
                
                if attempt < max_retries - 1:
                    # Wait before retry
                    import time
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                    continue
                else:
                    # Final attempt failed
                    logger.error(f"Error accessing Outlook via COM after {max_retries} attempts: {e}")
                    return []
        
        # This should never be reached due to the loop structure, but add for safety
        try:
            pythoncom.CoUninitialize()
        except:
            pass
        return []
    
    def _convert_outlook_time(self, outlook_time) -> datetime:
        """Convert Outlook time to Python datetime."""
        try:
            # Outlook times are usually datetime objects already
            if hasattr(outlook_time, 'year'):
                return datetime(
                    outlook_time.year,
                    outlook_time.month, 
                    outlook_time.day,
                    outlook_time.hour,
                    outlook_time.minute,
                    outlook_time.second
                )
            else:
                # Try parsing as string
                return datetime.strptime(str(outlook_time), '%Y-%m-%d %H:%M:%S')
        except:
            return datetime.now()
    
    def _get_meetings_via_export(self, target_date: datetime) -> List[SimpleMeeting]:
        """Get meetings from exported calendar files (.ics)."""
        meetings = []
        
        # Look for .ics files in common locations
        search_paths = [
            os.path.expanduser("~/Documents"),
            os.path.expanduser("~/Downloads"),
            os.path.expanduser("~/Desktop"),
            "."  # Current directory
        ]
        
        import glob
        ics_files = []
        for path in search_paths:
            ics_files.extend(glob.glob(os.path.join(path, "*.ics")))
        
        if not ics_files:
            return []
        
        # Use the most recent .ics file
        latest_file = max(ics_files, key=os.path.getmtime)
        logger.info(f"Reading calendar from: {latest_file}")
        
        try:
            meetings = self._parse_ics_file(latest_file, target_date)
            logger.info(f"Found {len(meetings)} meetings in {latest_file}")
            return meetings
        except Exception as e:
            logger.error(f"Error parsing ICS file {latest_file}: {e}")
            return []
    
    def _parse_ics_file(self, file_path: str, target_date: datetime) -> List[SimpleMeeting]:
        """Parse ICS calendar file for meetings."""
        meetings = []
        
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except:
            # Try with different encoding
            with open(file_path, 'r', encoding='latin1', errors='ignore') as f:
                content = f.read()
        
        # Simple ICS parser (basic implementation)
        lines = content.split('\n')
        current_event = {}
        in_event = False
        
        for line in lines:
            line = line.strip()
            
            if line == 'BEGIN:VEVENT':
                in_event = True
                current_event = {}
            elif line == 'END:VEVENT':
                if in_event and current_event:
                    meeting = self._create_meeting_from_ics_event(current_event, target_date)
                    if meeting:
                        meetings.append(meeting)
                in_event = False
                current_event = {}
            elif in_event and ':' in line:
                key, value = line.split(':', 1)
                # Handle parameters in key (e.g., DTSTART;TZID=...)
                if ';' in key:
                    key = key.split(';')[0]
                current_event[key] = value
        
        return meetings
    
    def _create_meeting_from_ics_event(self, event: Dict[str, str], target_date: datetime) -> Optional[SimpleMeeting]:
        """Create a SimpleMeeting from ICS event data."""
        try:
            # Parse start and end times
            start_str = event.get('DTSTART', '')
            end_str = event.get('DTEND', '')
            
            if not start_str or not end_str:
                return None
            
            start_time = self._parse_ics_datetime(start_str)
            end_time = self._parse_ics_datetime(end_str)
            
            # Check if meeting is on target date
            if start_time.date() != target_date.date():
                return None
            
            subject = event.get('SUMMARY', 'No Subject')
            location = event.get('LOCATION', '')
            organizer = event.get('ORGANIZER', '')
            
            # Clean up organizer (remove mailto:)
            if organizer.startswith('mailto:'):
                organizer = organizer[7:]
            
            return SimpleMeeting(
                subject=subject,
                start_time=start_time,
                end_time=end_time,
                organizer=organizer,
                location=location
            )
            
        except Exception as e:
            logger.debug(f"Error parsing ICS event: {e}")
            return None
    
    def _parse_ics_datetime(self, datetime_str: str) -> datetime:
        """Parse ICS datetime string."""
        # Remove timezone info for simplicity
        datetime_str = datetime_str.split('T')
        if len(datetime_str) == 2:
            date_part, time_part = datetime_str
            time_part = time_part.split('Z')[0]  # Remove Z suffix
            
            # Parse date: YYYYMMDD
            year = int(date_part[:4])
            month = int(date_part[4:6])
            day = int(date_part[6:8])
            
            # Parse time: HHMMSS
            hour = int(time_part[:2]) if len(time_part) >= 2 else 0
            minute = int(time_part[2:4]) if len(time_part) >= 4 else 0
            second = int(time_part[4:6]) if len(time_part) >= 6 else 0
            
            return datetime(year, month, day, hour, minute, second)
        else:
            # Date only
            date_part = datetime_str[0]
            year = int(date_part[:4])
            month = int(date_part[4:6])
            day = int(date_part[6:8])
            return datetime(year, month, day)
    
    def get_meetings_for_date_range(self, start_date: datetime, end_date: datetime) -> List[SimpleMeeting]:
        """Get meetings for a date range using the best available method.
        
        Args:
            start_date: Start of the date range (inclusive)
            end_date: End of the date range (inclusive)
            
        Returns:
            List of SimpleMeeting objects found in the date range
        """
        if not self.is_available():
            return []
            
        # Try COM first if available
        if "com" in self.available_methods:
            try:
                return self._get_meetings_via_com_range(start_date, end_date)
            except Exception as e:
                logger.warning(f"COM range method failed: {e}")
        
        # Fall back to getting meetings day by day
        if "export" in self.available_methods or "com" in self.available_methods:
            try:
                return self._get_meetings_day_by_day(start_date, end_date)
            except Exception as e:
                logger.warning(f"Day-by-day fallback failed: {e}")
        
        return []
    
    def _get_meetings_via_com_range(self, start_date: datetime, end_date: datetime) -> List[SimpleMeeting]:
        """Get meetings for date range - improved version that handles recurring meetings correctly."""
        if not WIN32_AVAILABLE:
            logger.warning("Outlook COM: WIN32 not available for date range query")
            return []
        
        # For shorter date ranges (up to 14 days), use day-by-day approach for accuracy
        # This properly handles recurring meetings
        days_diff = (end_date - start_date).days
        if days_diff <= 14:
            logger.info(f"Using day-by-day approach for {days_diff} day range")
            return self._get_meetings_day_by_day(start_date, end_date)
        
        # For longer ranges, use the bulk query method below
        logger.info(f"Using bulk query for {days_diff} day range")
            
        try:
            # Initialize COM
            pythoncom.CoInitialize()
            
            # Connect to Outlook
            outlook = win32com.client.Dispatch("Outlook.Application")
            namespace = outlook.GetNamespace("MAPI")
            
            # Get the default calendar folder
            calendar = namespace.GetDefaultFolder(9)  # 9 = olFolderCalendar
            
            # Define date range (ensure we cover full days)
            range_start = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
            range_end = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)
            
            logger.info(f"Outlook COM: Querying meetings for range {range_start.date()} to {range_end.date()}")
            
            # Create filter for appointments in date range with improved format handling
            # Try multiple date formats for different Outlook localizations
            filter_formats = [
                "%m/%d/%Y %H:%M",  # US format
                "%d/%m/%Y %H:%M",  # European format
                "%Y-%m-%d %H:%M",  # ISO format
            ]
            
            filter_string = None
            appointments = None
            filtered_appointments = None
            
            for date_format in filter_formats:
                try:
                    filter_string = f"[Start] >= '{range_start.strftime(date_format)}' AND [Start] <= '{range_end.strftime(date_format)}'"
                    
                    logger.debug(f"Outlook COM: Trying filter format: {filter_string}")
                    
                    # Get appointments
                    appointments = calendar.Items
                    appointments.Sort("[Start]")
                    
                    # For date range queries with recurring meetings, use IncludeRecurrences carefully
                    # Set it AFTER sort but BEFORE restrict
                    appointments.IncludeRecurrences = True
                    
                    filtered_appointments = appointments.Restrict(filter_string)
                    
                    # Test if the filter worked by checking Count
                    count = filtered_appointments.Count
                    
                    # If we get max int, the filter failed with recurrences
                    if count == 2147483647:
                        logger.warning(f"Date filter returned max int, trying without recurrences")
                        # Try again without IncludeRecurrences
                        appointments = calendar.Items
                        appointments.Sort("[Start]")
                        filtered_appointments = appointments.Restrict(filter_string)
                        count = filtered_appointments.Count
                    logger.info(f"Outlook COM: Successfully used date format {date_format}")
                    break
                    
                except Exception as format_error:
                    logger.debug(f"Outlook COM: Date format {date_format} failed: {format_error}")
                    continue
            
            if not filtered_appointments:
                tried_formats = ", ".join(filter_formats)
                raise Exception(f"All date format attempts failed. Tried: {tried_formats}")
            
            meetings = []
            appointment_count = 0
            
            # Outlook COM collections are 1-indexed
            try:
                appointment_count = filtered_appointments.Count
            except:
                # If Count fails, iterate through items
                pass
            
            logger.debug(f"Found {appointment_count} appointments in range")
            
            # Process appointments
            for appointment in filtered_appointments:
                try:
                    # Extract meeting details
                    subject = getattr(appointment, 'Subject', 'No Subject')
                    start_time = self._convert_outlook_time(appointment.Start)
                    end_time = self._convert_outlook_time(appointment.End)
                    organizer = getattr(appointment, 'Organizer', '')
                    location = getattr(appointment, 'Location', '')
                    
                    # Get attendees if available
                    attendees = []
                    try:
                        recipients = appointment.Recipients
                        for i in range(recipients.Count):
                            recipient = recipients.Item(i + 1)
                            attendees.append(recipient.Name)
                    except:
                        pass
                    
                    meeting = SimpleMeeting(
                        subject=subject,
                        start_time=start_time,
                        end_time=end_time,
                        organizer=organizer,
                        location=location,
                        attendees=attendees
                    )
                    meetings.append(meeting)
                    
                except Exception as e:
                    logger.debug(f"Error processing appointment: {e}")
                    continue
            
            logger.info(f"Found {len(meetings)} meetings via COM for range {start_date.date()} to {end_date.date()}")
            return meetings
            
        except Exception as e:
            logger.error(f"Error accessing Outlook via COM for date range: {e}")
            return []
        finally:
            try:
                pythoncom.CoUninitialize()
            except:
                pass
    
    def _get_meetings_day_by_day(self, start_date: datetime, end_date: datetime) -> List[SimpleMeeting]:
        """Fallback method: get meetings day by day and combine results."""
        all_meetings = []
        current_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date_day = end_date.replace(hour=0, minute=0, second=0, microsecond=0)
        
        while current_date <= end_date_day:
            try:
                day_meetings = self.get_meetings_for_date(current_date)
                all_meetings.extend(day_meetings)
                logger.debug(f"Found {len(day_meetings)} meetings for {current_date.date()}")
            except Exception as e:
                logger.warning(f"Error getting meetings for {current_date.date()}: {e}")
            
            current_date += timedelta(days=1)
        
        logger.info(f"Found {len(all_meetings)} total meetings via day-by-day for range {start_date.date()} to {end_date.date()}")
        return all_meetings

    def find_meeting_for_recording(self, recording_time: datetime, tolerance_minutes: int = 15) -> Optional[SimpleMeeting]:
        """Find a meeting that matches a recording time."""
        meetings = self.get_meetings_for_date(recording_time)
        
        best_match = None
        best_score = 0
        
        for meeting in meetings:
            # Calculate how well this meeting matches
            start_diff = abs((recording_time - meeting.start_time).total_seconds() / 60)
            
            # Meeting is a good match if recording started within tolerance of meeting start
            if start_diff <= tolerance_minutes:
                # Score based on proximity to meeting start
                score = max(0, tolerance_minutes - start_diff) / tolerance_minutes
                if score > best_score:
                    best_score = score
                    best_match = meeting
        
        return best_match
    
    def get_integration_status(self) -> Dict[str, str]:
        """Get status of integration methods."""
        status = {
            'available_methods': ', '.join(self.available_methods) if self.available_methods else 'None',
            'com_available': 'Yes' if 'com' in self.available_methods else 'No',
            'export_files_found': 'Yes' if 'export' in self.available_methods else 'No',
            'recommended_setup': self._get_recommended_setup(),
            'last_sync': self.last_sync_time.strftime('%H:%M:%S') if self.last_sync_time else 'Never',
            'last_error': self.last_error or 'None'
        }
        return status
    
    def get_calendar_status_text(self) -> str:
        """Get calendar status text for GUI display with user-friendly messages."""
        if not WIN32_AVAILABLE:
            return "Calendar: Windows COM not available"
        
        if not self.is_available():
            if self.last_error:
                if "not connected" in self.last_error.lower():
                    return "Calendar: Outlook not connected - Check mail setup"
                elif "not found" in self.last_error.lower():
                    return "Calendar: Install Microsoft Outlook for calendar integration"
                elif "operation failed" in self.last_error.lower():
                    return "Calendar: Start Outlook and try again"
                else:
                    return "Calendar: Connection issue - Check Outlook"
            else:
                return "Calendar: Outlook not available"
        
        if 'com' in self.available_methods:
            if self.last_sync_time:
                return f"Calendar: Connected (last sync {self.last_sync_time.strftime('%H:%M')})"
            else:
                return "Calendar: Connected and ready"
        else:
            return "Calendar: Setup required"
    
    def refresh_calendar_data(self) -> bool:
        """Manually refresh calendar data and return success status."""
        try:
            # Clear cache
            self.cached_meetings.clear()
            
            # Re-detect methods
            self.available_methods = self._detect_available_methods()
            
            # Try to get today's meetings to test connection
            today = datetime.now()
            meetings = self.get_meetings_for_date(today)
            
            # Update sync time
            self.last_sync_time = datetime.now()
            self.last_error = None
            
            logger.info(f"Calendar refresh successful - found {len(meetings)} meetings for today")
            return True
            
        except Exception as e:
            self.last_error = str(e)
            logger.error(f"Calendar refresh failed: {e}")
            return False
    
    def get_events(self, start_date: datetime = None, end_date: datetime = None) -> List[SimpleMeeting]:
        """Get calendar events for date range - interface for calendar mixin compatibility."""
        if start_date is None:
            start_date = datetime.now()
        
        # For now, get meetings for the start date
        # Future enhancement: support date ranges
        return self.get_meetings_for_date(start_date)
    
    def _get_recommended_setup(self) -> str:
        """Get recommended setup instructions for the user."""
        if 'com' in self.available_methods:
            return "✅ Outlook integration ready - using installed Outlook"
        elif WIN32_AVAILABLE and sys.platform == "win32":
            return "📧 Install Microsoft Outlook to enable calendar integration"
        else:
            return "🚫 Windows Outlook required for calendar integration"


# Simple integration function for GUI
def create_simple_outlook_integration():
    """Create a simple outlook integration instance."""
    return SimpleOutlookIntegration()


def test_simple_integration():
    """Test the simple integration."""
    integration = create_simple_outlook_integration()
    
    print(f"Integration available: {integration.is_available()}")
    print(f"Available methods: {integration.available_methods}")
    
    if integration.is_available():
        # Test with today's date
        today = datetime.now()
        meetings = integration.get_meetings_for_date(today)
        print(f"Found {len(meetings)} meetings for {today.date()}")
        
        for meeting in meetings[:3]:  # Show first 3
            print(f"- {meeting.subject} at {meeting.start_time.strftime('%H:%M')}")


if __name__ == "__main__":
    test_simple_integration()
