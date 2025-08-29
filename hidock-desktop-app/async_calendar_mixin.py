# async_calendar_mixin.py
"""
Async Calendar Integration Mixin for HiDock Desktop

Replaces the synchronous calendar operations with async background processing.
Eliminates 10+ minute startup delays by processing calendar data in background.
"""

import asyncio
import os
import threading
import queue
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable, Any
import time
from collections import defaultdict

from config_and_logger import logger, load_config
from calendar_cache_manager import CalendarCacheManager

try:
    from simple_outlook_integration import create_simple_outlook_integration
    SIMPLE_CALENDAR_AVAILABLE = True
except ImportError:
    SIMPLE_CALENDAR_AVAILABLE = False


class AsyncCalendarMixin:
    """Async calendar integration mixin for the main GUI."""
    
    def _ensure_async_calendar_initialized(self):
        """Initialize async calendar system (lazy initialization)."""
        if not hasattr(self, '_async_calendar_initialized'):
            self._async_calendar_initialized = False
            self._calendar_integration = None
            self._calendar_cache_manager = None
            self._calendar_worker_thread = None
            self._calendar_work_queue = queue.Queue()
            self._calendar_sync_status = "idle"
            self._calendar_sync_progress = 0.0
            self._calendar_total_files = 0
            self._calendar_processed_files = 0
            
            # Initialize components
            self._initialize_async_calendar_components()
            self._async_calendar_initialized = True
    
    def _initialize_async_calendar_components(self):
        """Initialize calendar cache and integration."""
        if not SIMPLE_CALENDAR_AVAILABLE:
            logger.debug("AsyncCalendar", "init", "Simple calendar integration not available")
            return
        
        try:
            # Initialize cache manager
            cache_dir = os.path.join(os.path.expanduser("~"), ".hidock", "calendar_cache")
            self._calendar_cache_manager = CalendarCacheManager(cache_dir)
            
            # Initialize calendar integration
            self._calendar_integration = create_simple_outlook_integration()
            
            # Start worker thread
            self._calendar_worker_thread = threading.Thread(
                target=self._calendar_worker_loop, 
                daemon=True, 
                name="CalendarWorker"
            )
            self._calendar_worker_thread.start()
            
            logger.info("AsyncCalendar", "init", "Async calendar system initialized")
            
        except Exception as e:
            logger.error("AsyncCalendar", "init", f"Failed to initialize async calendar: {e}")
    
    def _calendar_worker_loop(self):
        """Background worker thread for processing calendar requests."""
        logger.info("AsyncCalendar", "worker", "Calendar worker thread started")
        
        while True:
            try:
                # Get work item from queue (blocking)
                work_item = self._calendar_work_queue.get(timeout=30.0)
                
                if work_item is None:  # Shutdown signal
                    break
                
                # Process work item
                self._process_calendar_work_item(work_item)
                
                # Mark work as done
                self._calendar_work_queue.task_done()
                
            except queue.Empty:
                # Periodic cleanup and maintenance (configurable interval)
                self._perform_calendar_maintenance()
                continue
            except Exception as e:
                logger.error("AsyncCalendar", "worker", f"Error in calendar worker: {e}")
                continue
        
        logger.info("AsyncCalendar", "worker", "Calendar worker thread stopped")
    
    def _process_calendar_work_item(self, work_item: Dict[str, Any]):
        """Process a single calendar work item."""
        work_type = work_item.get('type')
        
        try:
            if work_type == 'sync_files':
                self._process_files_sync_request(work_item)
            elif work_type == 'sync_single_file':
                self._process_single_file_sync_request(work_item)
            elif work_type == 'force_refresh':
                self._process_force_refresh_request(work_item)
            else:
                logger.warning("AsyncCalendar", "worker", f"Unknown work type: {work_type}")
                
        except Exception as e:
            logger.error("AsyncCalendar", "worker", f"Error processing work item {work_type}: {e}")
    
    def _process_files_sync_request(self, work_item: Dict[str, Any]):
        """Process batch file sync request using calendar chunking."""
        files_dict = work_item.get('files', [])
        callback = work_item.get('callback')
        
        self._calendar_sync_status = "syncing"
        self._calendar_total_files = len(files_dict)
        self._calendar_processed_files = 0
        
        # Update GUI status
        self.after(0, self._update_calendar_sync_gui_status, "Syncing calendar data...", 0.0)
        
        logger.info("AsyncCalendar", "sync", f"Starting batch async sync for {len(files_dict)} files")
        
        # Use batch processing with calendar chunking
        enhanced_files = self._enhance_files_with_batch_calendar_data(files_dict)
        
        self._calendar_sync_status = "complete"
        
        # Clear sync status after a delay to prevent "Syncing..." from sticking
        self.after(2000, self._clear_sync_status)
        
        # Callback to GUI with results
        if callback:
            self.after(0, callback, enhanced_files)
        
        # Update GUI status
        self.after(0, self._update_calendar_sync_gui_status, 
                  f"Calendar sync complete ({len(enhanced_files)} files)", 1.0)
        
        logger.info("AsyncCalendar", "sync", f"Completed batch async sync for {len(enhanced_files)} files")
    
    def _process_single_file_sync_request(self, work_item: Dict[str, Any]):
        """Process single file sync request (fallback for individual file updates)."""
        file_data = work_item.get('file', {})
        callback = work_item.get('callback')
        
        if not file_data:
            logger.warning("AsyncCalendar", "single_file_sync", "No file data provided for single file sync")
            return
        
        self._calendar_sync_status = "syncing"
        self._calendar_total_files = 1
        self._calendar_processed_files = 0
        
        # Update GUI status
        self.after(0, self._update_calendar_sync_gui_status, "Syncing single file...", 0.0)
        
        logger.info("AsyncCalendar", "single_file_sync", f"Starting single file sync for {file_data.get('name', 'unknown')}")
        
        try:
            # Process single file using the old method for compatibility
            enhanced_file = self._enhance_single_file_with_calendar_data(file_data)
            self._calendar_processed_files = 1
            
            # Update GUI status
            self.after(0, self._update_calendar_sync_gui_status, "Single file sync complete", 1.0)
            
            # Callback with single file result
            if callback:
                self.after(0, callback, [enhanced_file])
                
            logger.info("AsyncCalendar", "single_file_sync", f"Completed single file sync for {enhanced_file.get('name', 'unknown')}")
            
        except Exception as e:
            logger.error("AsyncCalendar", "single_file_sync", f"Error in single file sync: {e}")
            # Create empty meeting fields on error
            enhanced_file = file_data.copy()
            enhanced_file.update(self._create_empty_meeting_fields())
            
            if callback:
                self.after(0, callback, [enhanced_file])
        
        self._calendar_sync_status = "complete"
        
        # Clear sync status after a delay to prevent "Syncing..." from sticking
        self.after(2000, self._clear_sync_status)
    
    def _clear_sync_status(self):
        """Clear sync status to ensure 'Syncing...' doesn't stick around."""
        try:
            if hasattr(self, '_calendar_sync_status'):
                self._calendar_sync_status = "idle"
            if hasattr(self, '_calendar_processed_files'):
                self._calendar_processed_files = 0
            if hasattr(self, '_calendar_total_files'):
                self._calendar_total_files = 0
            logger.debug("AsyncCalendar", "_clear_sync_status", "Sync status cleared")
        except Exception as e:
            logger.debug("AsyncCalendar", "_clear_sync_status", f"Error clearing sync status: {e}")
    
    def _enhance_single_file_with_calendar_data(self, file_data: Dict[str, Any]) -> Dict[str, Any]:
        """Enhance a single file with calendar data using aggressive caching."""
        enhanced_file = file_data.copy()
        filename = file_data['name']
        
        try:
            # Parse file creation datetime
            file_datetime = self._parse_file_datetime(file_data)
            if not file_datetime:
                enhanced_file.update(self._create_empty_meeting_fields())
                return enhanced_file
            
            # Check cache first - AGGRESSIVE CACHING
            cached_meeting = self._calendar_cache_manager.get_cached_meeting_for_file(filename, file_datetime)
            if cached_meeting:
                # Use cached data
                enhanced_file.update(self._create_meeting_fields_from_cached(cached_meeting))
                return enhanced_file
            
            # Not in cache - fetch from calendar (only if calendar is available)
            if not self._calendar_integration or not self._calendar_integration.is_available():
                # Cache "no meeting" to avoid future lookups
                self._calendar_cache_manager.cache_no_meeting_for_file(filename, file_datetime)
                enhanced_file.update(self._create_empty_meeting_fields())
                return enhanced_file
            
            # Find meeting from calendar
            meeting = self._calendar_integration.find_meeting_for_recording(file_datetime, tolerance_minutes=20)
            
            if meeting:
                # Cache the found meeting
                cached_meeting = self._calendar_cache_manager.cache_meeting_for_file(filename, file_datetime, meeting)
                enhanced_file.update(self._create_meeting_fields_from_cached(cached_meeting))
            else:
                # Cache "no meeting" result
                self._calendar_cache_manager.cache_no_meeting_for_file(filename, file_datetime)
                enhanced_file.update(self._create_empty_meeting_fields())
            
            return enhanced_file
            
        except Exception as e:
            logger.warning("AsyncCalendar", "enhance_file", f"Error enhancing {filename} with calendar data: {e}")
            enhanced_file.update(self._create_empty_meeting_fields())
            return enhanced_file
    
    def _create_meeting_fields_from_cached(self, cached_meeting) -> Dict[str, Any]:
        """Create meeting fields from cached meeting data."""
        try:
            # If this is a "no meeting" cache entry (empty subject), return empty fields
            if not cached_meeting.subject:
                return self._create_empty_meeting_fields()
            
            start_time = datetime.fromisoformat(cached_meeting.start_time) if cached_meeting.start_time else None
            end_time = datetime.fromisoformat(cached_meeting.end_time) if cached_meeting.end_time else None
            
            # Determine meeting type
            meeting_type = "Virtual"
            if cached_meeting.location:
                location_lower = cached_meeting.location.lower()
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
                        elif hostname and (hostname.endswith("zoom.us") or hostname.endswith("zoom.com")):
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
                elif cached_meeting.location and not any(url in location_lower for url in ["http", ".com", ".net"]):
                    meeting_type = "In-person"
            
            return {
                'has_meeting': True,  # Only true if we have a real meeting
                'meeting_subject': cached_meeting.subject,
                'meeting_organizer': cached_meeting.organizer or '',
                'meeting_attendees_display': f"{cached_meeting.attendee_count} attendees" if cached_meeting.attendee_count > 0 else "No attendees",
                'meeting_attendees_count': cached_meeting.attendee_count,
                'meeting_location': cached_meeting.location or '',
                'meeting_type': meeting_type,
                'meeting_start_time': start_time,
                'meeting_end_time': end_time,
                'meeting_duration_minutes': int((end_time - start_time).total_seconds() / 60) if start_time and end_time else 0,
                'meeting_time_display': start_time.strftime("%H:%M") if start_time else '',
                'meeting_date_display': start_time.strftime("%Y-%m-%d") if start_time else '',
                'meeting_display_text': cached_meeting.display_text or '',  # Use cached display text or empty
                'meeting_confidence_score': cached_meeting.confidence_score,
            }
        except Exception as e:
            logger.warning("AsyncCalendar", "create_meeting_fields", f"Error creating meeting fields: {e}")
            return self._create_empty_meeting_fields()
    
    def _create_empty_meeting_fields(self) -> Dict[str, Any]:
        """Create empty meeting fields for files without meetings."""
        # Only show "Syncing..." if we're actively syncing AND this is during initial sync
        # After completion, always show empty string
        display_text = ''
        
        # During force refresh, NEVER show "Syncing..." for files without meetings
        if hasattr(self, '_force_refresh_mode') and self._force_refresh_mode:
            display_text = ''
        elif (hasattr(self, '_calendar_sync_status') and 
              self._calendar_sync_status == 'syncing' and 
              hasattr(self, '_calendar_processed_files') and
              hasattr(self, '_calendar_total_files') and
              self._calendar_processed_files < self._calendar_total_files):
            display_text = 'Syncing...'
        
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
            'meeting_display_text': display_text,
            'meeting_confidence_score': 0.0,
        }
    
    def _parse_file_datetime(self, file_data: Dict) -> Optional[datetime]:
        """Parse datetime from file data - uses the device's existing datetime parsing."""
        try:
            # The device already provides a proper 'time' datetime object
            # This is populated by hidock_device._parse_filename_datetime()
            if 'time' in file_data and file_data['time']:
                if isinstance(file_data['time'], datetime):
                    logger.debug("AsyncCalendar", "_parse_file_datetime", 
                               f"Using device-parsed datetime for {file_data.get('name', 'unknown')}: {file_data['time']}")
                    return file_data['time']
            
            # Fallback: combine createDate and createTime (also provided by device)
            create_date = file_data.get('createDate', '')
            create_time = file_data.get('createTime', '')
            
            if create_date and create_time and create_date != '---' and create_time != '---':
                datetime_str = f"{create_date} {create_time}"
                # The device uses "%Y/%m/%d %H:%M:%S" format
                try:
                    parsed_dt = datetime.strptime(datetime_str, "%Y/%m/%d %H:%M:%S")
                    logger.debug("AsyncCalendar", "_parse_file_datetime", 
                               f"Parsed from createDate/createTime for {file_data.get('name', 'unknown')}: {parsed_dt}")
                    return parsed_dt
                except ValueError as e:
                    logger.debug("AsyncCalendar", "_parse_file_datetime", 
                               f"Date format error for {file_data.get('name', 'unknown')}: {e}")
            
            # If we get here, the device failed to parse the filename
            logger.warning("AsyncCalendar", "_parse_file_datetime", 
                         f"No valid datetime found for {file_data.get('name', 'unknown')} - device parsing may have failed")
            return None
            
        except Exception as e:
            logger.error("AsyncCalendar", "_parse_file_datetime", 
                        f"Error parsing datetime for {file_data.get('name', 'unknown')}: {e}")
            return None
    
    def _get_calendar_chunking_period(self) -> timedelta:
        """Get the calendar chunking period setting as a timedelta."""
        try:
            config = load_config()
            period_str = config.get('calendar_chunking_period', '1 Week')
            
            # Parse the period string
            if period_str == '1 Day':
                return timedelta(days=1)
            elif period_str == '1 Week':
                return timedelta(weeks=1)
            elif period_str == '2 Weeks':
                return timedelta(weeks=2)
            elif period_str == '1 Month':
                return timedelta(days=30)  # Approximate month
            elif period_str == '3 Months':
                return timedelta(days=90)  # Approximate quarter
            else:
                logger.warning("AsyncCalendar", "chunking_period", 
                             f"Unknown calendar chunking period: {period_str}, using default '1 Week'")
                return timedelta(weeks=1)
                
        except Exception as e:
            logger.warning("AsyncCalendar", "chunking_period", 
                         f"Error getting calendar chunking period: {e}, using default '1 Week'")
            return timedelta(weeks=1)
    
    def _enhance_files_with_batch_calendar_data(self, files_dict: List[Dict]) -> List[Dict]:
        """Enhance files with calendar data using batch processing and chunking optimization."""
        if not self._calendar_integration or not self._calendar_integration.is_available():
            # No calendar available - return files with empty meeting fields
            enhanced_files = []
            for file_data in files_dict:
                enhanced_file = file_data.copy()
                enhanced_file.update(self._create_empty_meeting_fields())
                enhanced_files.append(enhanced_file)
            return enhanced_files
        
        logger.info("AsyncCalendar", "batch_enhance", f"Starting batch enhancement for {len(files_dict)} files")
        
        # Group files by date chunks based on calendar_chunking_period
        date_chunks = self._group_files_by_date_chunks(files_dict)
        logger.info("AsyncCalendar", "batch_enhance", f"Grouped files into {len(date_chunks)} date chunks")
        
        enhanced_files = []
        
        for chunk_start_date, chunk_files in date_chunks.items():
            try:
                # Process this chunk of files
                chunk_enhanced = self._process_date_chunk(chunk_start_date, chunk_files)
                enhanced_files.extend(chunk_enhanced)
                
                # Update progress
                self._calendar_processed_files += len(chunk_files)
                progress = self._calendar_processed_files / max(1, self._calendar_total_files) if self._calendar_total_files > 0 else 1.0
                
                # Update GUI status
                self.after(0, self._update_calendar_sync_gui_status, 
                          f"Processed {self._calendar_processed_files}/{self._calendar_total_files} files", 
                          progress)
                
                # Check for cancellation
                if hasattr(self, '_calendar_sync_cancelled') and self._calendar_sync_cancelled:
                    logger.info("AsyncCalendar", "batch_enhance", "Batch calendar sync cancelled by user")
                    break
                    
            except Exception as e:
                logger.warning("AsyncCalendar", "batch_enhance", f"Error processing date chunk {chunk_start_date}: {e}")
                # Add files without meeting data on chunk error
                for file_data in chunk_files:
                    enhanced_file = file_data.copy()
                    enhanced_file.update(self._create_empty_meeting_fields())
                    enhanced_files.append(enhanced_file)
                
                self._calendar_processed_files += len(chunk_files)
        
        logger.info("AsyncCalendar", "batch_enhance", f"Completed batch enhancement for {len(enhanced_files)} files")
        return enhanced_files
    
    def _group_files_by_date_chunks(self, files_dict: List[Dict]) -> Dict[datetime, List[Dict]]:
        """Group files into date chunks based on the calendar chunking period."""
        chunking_period = self._get_calendar_chunking_period()
        date_chunks = defaultdict(list)
        
        for file_data in files_dict:
            file_datetime = self._parse_file_datetime(file_data)
            if not file_datetime:
                # Files without valid dates go into a special "no date" chunk
                date_chunks[datetime.min].append(file_data)
                continue
            
            # Calculate which chunk this file belongs to
            chunk_start = self._get_chunk_start_date(file_datetime, chunking_period)
            date_chunks[chunk_start].append(file_data)
        
        return date_chunks
    
    def _get_chunk_start_date(self, file_datetime: datetime, chunking_period: timedelta) -> datetime:
        """Get the start date of the chunk that contains the given file datetime."""
        # Normalize to start of day for consistent chunking
        file_date = file_datetime.replace(hour=0, minute=0, second=0, microsecond=0)
        
        if chunking_period.days == 1:  # 1 Day
            return file_date
        elif chunking_period.days == 7:  # 1 Week
            # Start of week (Monday)
            days_since_monday = file_date.weekday()
            return file_date - timedelta(days=days_since_monday)
        elif chunking_period.days == 14:  # 2 Weeks
            # Bi-weekly chunks starting from a reference date
            # Use epoch as reference and calculate 2-week periods from there
            epoch = datetime(1970, 1, 5)  # A Monday for consistent week alignment
            days_since_epoch = (file_date - epoch).days
            chunk_number = days_since_epoch // 14
            return epoch + timedelta(days=chunk_number * 14)
        elif chunking_period.days == 30:  # 1 Month (approximate)
            # Start of month
            return file_date.replace(day=1)
        elif chunking_period.days == 90:  # 3 Months (approximate)
            # Start of quarter (Jan, Apr, Jul, Oct)
            quarter_month = ((file_date.month - 1) // 3) * 3 + 1
            return file_date.replace(month=quarter_month, day=1)
        else:
            # Fallback to 1-week chunks
            days_since_monday = file_date.weekday()
            return file_date - timedelta(days=days_since_monday)
    
    def _process_date_chunk(self, chunk_start_date: datetime, chunk_files: List[Dict]) -> List[Dict]:
        """Process a date chunk using batch calendar queries and optimized caching."""
        if chunk_start_date == datetime.min:
            # Special case: files without valid dates
            enhanced_files = []
            for file_data in chunk_files:
                enhanced_file = file_data.copy()
                enhanced_file.update(self._create_empty_meeting_fields())
                enhanced_files.append(enhanced_file)
            return enhanced_files
        
        chunking_period = self._get_calendar_chunking_period()
        chunk_end_date = chunk_start_date + chunking_period - timedelta(seconds=1)
        
        logger.debug("AsyncCalendar", "process_chunk", 
                    f"Processing chunk {chunk_start_date.date()} to {chunk_end_date.date()} with {len(chunk_files)} files")
        
        # Check which files already have cached data
        files_needing_data = []
        enhanced_files = []
        cached_empty_count = 0  # Count files with "no meeting" cached
        
        for file_data in chunk_files:
            enhanced_file = file_data.copy()
            filename = file_data['name']
            file_datetime = self._parse_file_datetime(file_data)
            
            if not file_datetime:
                enhanced_file.update(self._create_empty_meeting_fields())
                enhanced_files.append(enhanced_file)
                continue
            
            # Check cache first
            cached_meeting = self._calendar_cache_manager.get_cached_meeting_for_file(filename, file_datetime)
            if cached_meeting:
                # Check if this is a "no meeting" cache entry
                if not cached_meeting.subject or cached_meeting.subject == "No meeting":
                    cached_empty_count += 1
                
                # Use cached data
                enhanced_file.update(self._create_meeting_fields_from_cached(cached_meeting))
                enhanced_files.append(enhanced_file)
            else:
                # Need to fetch calendar data for this file
                files_needing_data.append((file_data, enhanced_file))
        
        # SMART CACHE INVALIDATION: If most cached entries are "no meeting" but we suspect there should be meetings,
        # force a refresh by treating some cached files as needing data
        total_cached = len(chunk_files) - len(files_needing_data)
        if total_cached > 0 and cached_empty_count > (total_cached * 0.8):  # 80% of cached entries are empty
            logger.info("AsyncCalendar", "process_chunk", 
                       f"Suspicious cache pattern: {cached_empty_count}/{total_cached} cached entries are empty. "
                       f"Forcing refresh for this date chunk.")
            
            # Move all files to "needs data" to force fresh fetch
            files_needing_data = []
            enhanced_files = []
            for file_data in chunk_files:
                enhanced_file = file_data.copy()
                file_datetime = self._parse_file_datetime(file_data)
                if file_datetime:
                    files_needing_data.append((file_data, enhanced_file))
                else:
                    enhanced_file.update(self._create_empty_meeting_fields())
                    enhanced_files.append(enhanced_file)
        
        if not files_needing_data:
            logger.debug("AsyncCalendar", "process_chunk", "All files in chunk found in cache")
            return enhanced_files
        
        logger.debug("AsyncCalendar", "process_chunk", 
                    f"Fetching calendar data for chunk, {len(files_needing_data)} files need data")
        
        # Fetch meetings for the entire date range in one batch call
        try:
            logger.info("AsyncCalendar", "process_chunk", 
                       f"Fetching calendar data for date range {chunk_start_date.date()} to {chunk_end_date.date()}")
            
            chunk_meetings = self._calendar_integration.get_meetings_for_date_range(chunk_start_date, chunk_end_date)
            
            logger.info("AsyncCalendar", "process_chunk", 
                       f"Successfully fetched {len(chunk_meetings)} meetings for date range")
            
            # Log detailed meeting info for debugging
            if chunk_meetings:
                for i, meeting in enumerate(chunk_meetings[:3]):  # Log first 3 meetings
                    logger.debug("AsyncCalendar", "process_chunk", 
                               f"Meeting {i+1}: '{meeting.subject}' at {meeting.start_time}")
                if len(chunk_meetings) > 3:
                    logger.debug("AsyncCalendar", "process_chunk", 
                               f"... and {len(chunk_meetings) - 3} more meetings")
            else:
                logger.warning("AsyncCalendar", "process_chunk", 
                             f"No meetings found for date range {chunk_start_date.date()} to {chunk_end_date.date()}")
            
        except Exception as e:
            logger.error("AsyncCalendar", "process_chunk", 
                        f"Error fetching meetings for chunk {chunk_start_date.date()} to {chunk_end_date.date()}: {e}")
            chunk_meetings = []
        
        # Match files with meetings and cache results
        for file_data, enhanced_file in files_needing_data:
            filename = file_data['name']
            file_datetime = self._parse_file_datetime(file_data)
            
            if not file_datetime:
                enhanced_file.update(self._create_empty_meeting_fields())
                enhanced_files.append(enhanced_file)
                continue
            
            # Find best matching meeting within tolerance
            best_meeting = self._find_best_meeting_match(file_datetime, chunk_meetings)
            
            if best_meeting:
                # Cache the found meeting
                cached_meeting = self._calendar_cache_manager.cache_meeting_for_file(
                    filename, file_datetime, best_meeting)
                enhanced_file.update(self._create_meeting_fields_from_cached(cached_meeting))
            else:
                # Cache "no meeting" result
                self._calendar_cache_manager.cache_no_meeting_for_file(filename, file_datetime)
                enhanced_file.update(self._create_empty_meeting_fields())
            
            enhanced_files.append(enhanced_file)
        
        return enhanced_files
    
    def _find_best_meeting_match(self, file_datetime: datetime, meetings: List) -> Optional[object]:
        """Find the best matching meeting for a file datetime from a list of meetings."""
        if not meetings:
            return None
        
        best_match = None
        best_score = 0
        tolerance_minutes = 20  # Same as the original single-file method
        
        for meeting in meetings:
            # Calculate how well this meeting matches
            start_diff = abs((file_datetime - meeting.start_time).total_seconds() / 60)
            
            # Meeting is a good match if recording started within tolerance of meeting start
            if start_diff <= tolerance_minutes:
                # Score based on proximity to meeting start
                score = max(0, tolerance_minutes - start_diff) / tolerance_minutes
                if score > best_score:
                    best_score = score
                    best_match = meeting
        
        return best_match
    
    def enhance_files_with_meeting_data_async(self, files_dict: List[Dict], callback: Optional[Callable] = None) -> List[Dict]:
        """
        NON-BLOCKING calendar enhancement - returns immediately, processes in background.
        
        Args:
            files_dict: List of file dictionaries from the device
            callback: Optional callback function to call when enhancement is complete
            
        Returns:
            Enhanced list with meeting metadata (initially empty meeting fields, updated later)
        """
        # Ensure calendar system is initialized
        self._ensure_async_calendar_initialized()
        
        # Return files immediately with empty meeting fields
        immediate_files = []
        for file_data in files_dict:
            enhanced_file = file_data.copy()
            enhanced_file.update(self._create_empty_meeting_fields())
            immediate_files.append(enhanced_file)
        
        # Queue background work to enhance with real calendar data
        if SIMPLE_CALENDAR_AVAILABLE and self._calendar_cache_manager:
            work_item = {
                'type': 'sync_files',
                'files': files_dict,
                'callback': callback
            }
            self._calendar_work_queue.put(work_item)
            
            logger.info("AsyncCalendar", "enhance_files_async", 
                       f"Queued {len(files_dict)} files for background calendar sync")
        else:
            logger.debug("AsyncCalendar", "enhance_files_async", 
                        "Calendar integration not available, returning files without meeting data")
        
        return immediate_files
    
    def _update_calendar_sync_gui_status(self, status_text: str, progress: float):
        """Update GUI with calendar sync status."""
        try:
            # Update calendar status indicator
            if hasattr(self, 'calendar_status_label_header') and self.calendar_status_label_header.winfo_exists():
                self.calendar_status_label_header.configure(text=f"Calendar: {status_text}")
            
            # Update progress bar if it exists
            if hasattr(self, 'calendar_sync_progress_bar') and self.calendar_sync_progress_bar.winfo_exists():
                self.calendar_sync_progress_bar.set(progress)
                if progress >= 1.0:
                    # Hide progress bar when complete - use safer method
                    def hide_progress_bar():
                        try:
                            if hasattr(self, 'calendar_sync_progress_bar') and self.calendar_sync_progress_bar.winfo_exists():
                                self.calendar_sync_progress_bar.pack_forget()
                        except:
                            pass  # Ignore errors if widget is destroyed
                    
                    self.after(2000, hide_progress_bar)
        except Exception as e:
            logger.debug("AsyncCalendar", "update_gui_status", f"Error updating GUI status: {e}")
    
    def _perform_calendar_maintenance(self):
        """Periodic maintenance tasks for calendar cache with configurable intervals."""
        try:
            if self._calendar_cache_manager:
                # Check if enough time has passed since last maintenance
                current_time = time.time()
                if not hasattr(self, '_last_maintenance_time'):
                    self._last_maintenance_time = 0
                
                # Configurable maintenance interval (default: 5 minutes)
                maintenance_interval = 300  # 5 minutes in seconds
                
                if current_time - self._last_maintenance_time >= maintenance_interval:
                    # Clean up expired entries
                    removed = self._calendar_cache_manager.cleanup_expired_entries()
                    if removed > 0:
                        logger.info("AsyncCalendar", "maintenance", f"Cleaned up {removed} expired cache entries")
                    
                    # Update last maintenance time
                    self._last_maintenance_time = current_time
                    
                    # Log memory usage for monitoring
                    import psutil
                    import os
                    try:
                        process = psutil.Process(os.getpid())
                        memory_mb = process.memory_info().rss / 1024 / 1024
                        logger.debug("AsyncCalendar", "maintenance", f"Process memory usage: {memory_mb:.1f} MB")
                    except ImportError:
                        pass  # psutil not available
        except Exception as e:
            logger.warning("AsyncCalendar", "maintenance", f"Error during calendar maintenance: {e}")
    
    def get_calendar_status_text_for_gui_async(self) -> str:
        """Get calendar status text for GUI display (async version)."""
        self._ensure_async_calendar_initialized()
        
        if not SIMPLE_CALENDAR_AVAILABLE:
            return "Calendar: Not Available"
        
        if not self._calendar_integration:
            return "Calendar: Not Initialized"
        
        # Check integration availability
        if not self._calendar_integration.is_available():
            return self._calendar_integration.get_calendar_status_text()
        
        # Show sync status if actively syncing
        if self._calendar_sync_status == "syncing":
            return f"Calendar: Syncing ({self._calendar_processed_files}/{self._calendar_total_files})"
        elif self._calendar_sync_status == "complete":
            return "Calendar: Ready"
        else:
            return "Calendar: Ready"
    
    def refresh_calendar_data_async(self, callback: Optional[Callable] = None, current_files: List[Dict] = None) -> bool:
        """Manually refresh calendar data - async version for GUI refresh button.
        
        Args:
            callback: Optional callback to call when refresh is complete
            current_files: Current files list to repopulate cache for after clearing
        """
        self._ensure_async_calendar_initialized()
        
        if not SIMPLE_CALENDAR_AVAILABLE or not self._calendar_cache_manager:
            return False
        
        try:
            # Queue force refresh work with current files for repopulation
            work_item = {
                'type': 'force_refresh',
                'callback': callback,
                'current_files': current_files or []  # Include current files for repopulation
            }
            self._calendar_work_queue.put(work_item)
            
            logger.info("AsyncCalendar", "refresh_async", 
                       f"Queued calendar force refresh with {len(current_files or [])} files for repopulation")
            return True
            
        except Exception as e:
            logger.error("AsyncCalendar", "refresh_async", f"Error queuing calendar refresh: {e}")
            return False
    
    def _force_refresh_complete_callback(self, original_callback, enhanced_files):
        """Wrapper callback to clear force refresh flag after completion."""
        try:
            # Clear the force refresh flag
            if hasattr(self, '_force_refresh_mode'):
                self._force_refresh_mode = False
                logger.debug("AsyncCalendar", "force_refresh_complete", "Cleared force refresh mode flag")
            
            # Call the original callback
            if original_callback:
                original_callback(enhanced_files)
        except Exception as e:
            logger.error("AsyncCalendar", "force_refresh_complete", f"Error in callback: {e}")
    
    def _process_force_refresh_request(self, work_item: Dict[str, Any]):
        """Process force refresh request with cache repopulation."""
        try:
            logger.info("AsyncCalendar", "force_refresh", "Starting force refresh - clearing cache and repopulating")
            
            # Set a flag to indicate we're doing a force refresh (not regular sync)
            self._force_refresh_mode = True
            
            # Clear all caches
            if self._calendar_cache_manager:
                self._calendar_cache_manager.force_refresh_all()
                logger.info("AsyncCalendar", "force_refresh", "Cache cleared")
            
            # Refresh the integration (reconnect to Outlook if needed)
            if self._calendar_integration:
                success = self._calendar_integration.refresh_calendar_data()
                if success:
                    logger.info("AsyncCalendar", "force_refresh", "Calendar integration refreshed successfully")
                else:
                    logger.warning("AsyncCalendar", "force_refresh", "Calendar integration refresh failed")
            
            # CRITICAL FIX: Trigger repopulation of cache for current files
            # We need to get the current files from the GUI and re-sync them
            callback = work_item.get('callback')
            current_files = work_item.get('current_files', [])
            
            if current_files:
                logger.info("AsyncCalendar", "force_refresh", 
                          f"Repopulating cache for {len(current_files)} current files")
                
                # Queue a new sync request for all current files to repopulate cache
                repopulate_work_item = {
                    'type': 'sync_files',
                    'files': current_files,
                    'callback': lambda files: self._force_refresh_complete_callback(callback, files)  # Wrap callback to clear flag
                }
                self._calendar_work_queue.put(repopulate_work_item)
                logger.info("AsyncCalendar", "force_refresh", "Queued repopulation sync")
            else:
                # No current files provided, just call callback with empty list
                logger.warning("AsyncCalendar", "force_refresh", 
                             "No current files provided for repopulation")
                
                # Clear force refresh flag
                if hasattr(self, '_force_refresh_mode'):
                    self._force_refresh_mode = False
                
                if callback:
                    # Call callback with empty list to indicate no files
                    self.after(0, callback, [])
                
        except Exception as e:
            logger.error("AsyncCalendar", "force_refresh", f"Error during force refresh: {e}")
            
            # Clear force refresh flag on error
            if hasattr(self, '_force_refresh_mode'):
                self._force_refresh_mode = False
            
            # On error, still call callback with empty list to unblock GUI
            callback = work_item.get('callback')
            if callback:
                self.after(0, callback, [])
    
    def get_calendar_cache_statistics(self) -> Dict[str, Any]:
        """Get calendar cache statistics for monitoring."""
        self._ensure_async_calendar_initialized()
        
        if self._calendar_cache_manager:
            return self._calendar_cache_manager.get_cache_statistics()
        else:
            return {"error": "Calendar cache not available"}
    
    def shutdown_async_calendar(self):
        """Shutdown async calendar system."""
        try:
            if hasattr(self, '_calendar_work_queue'):
                # Signal worker thread to stop
                self._calendar_work_queue.put(None)
            
            if hasattr(self, '_calendar_worker_thread') and self._calendar_worker_thread.is_alive():
                self._calendar_worker_thread.join(timeout=5.0)
            
            if hasattr(self, '_calendar_cache_manager') and self._calendar_cache_manager:
                self._calendar_cache_manager.shutdown()
            
            logger.info("AsyncCalendar", "shutdown", "Async calendar system shut down")
        except Exception as e:
            logger.error("AsyncCalendar", "shutdown", f"Error during calendar shutdown: {e}")
    
    # Compatibility wrapper methods for existing GUI code
    def get_calendar_status_text_for_gui(self) -> str:
        """Compatibility wrapper for existing GUI code."""
        return self.get_calendar_status_text_for_gui_async()
    
    def enhance_files_with_meeting_data(self, files_dict: List[Dict]) -> List[Dict]:
        """Compatibility wrapper for existing GUI code - returns immediately with async processing."""
        return self.enhance_files_with_meeting_data_async(files_dict)
    
    def enhance_files_with_meeting_data_sync(self, files_dict: List[Dict]) -> List[Dict]:
        """Synchronous calendar enhancement for cached files - applies cached data immediately.
        
        IMPORTANT: This method ONLY uses cached data and never makes live API calls
        to avoid blocking the GUI thread during startup.
        """
        self._ensure_async_calendar_initialized()
        
        if not SIMPLE_CALENDAR_AVAILABLE or not self._calendar_cache_manager:
            # No calendar available - return files with empty meeting fields
            enhanced_files = []
            for file_data in files_dict:
                enhanced_file = file_data.copy()
                enhanced_file.update(self._create_empty_meeting_fields())
                enhanced_files.append(enhanced_file)
            return enhanced_files
        
        logger.info("AsyncCalendar", "enhance_sync", f"Synchronously enhancing {len(files_dict)} files with cached meeting data")
        
        enhanced_files = []
        meetings_found = 0
        
        for file_data in files_dict:
            try:
                enhanced_file = self._enhance_single_file_with_cached_data_only(file_data)
                enhanced_files.append(enhanced_file)
                
                # Count files with meetings for logging
                if enhanced_file.get('has_meeting', False):
                    meetings_found += 1
                    
            except Exception as e:
                logger.warning("AsyncCalendar", "enhance_sync", f"Error enhancing {file_data.get('name', 'unknown')}: {e}")
                # Add file without meeting data on error
                enhanced_file = file_data.copy()
                enhanced_file.update(self._create_empty_meeting_fields())
                enhanced_files.append(enhanced_file)
        
        logger.info("AsyncCalendar", "enhance_sync", 
                   f"Completed sync enhancement: {meetings_found} files with meetings out of {len(enhanced_files)} total")
        
        return enhanced_files
    
    def _enhance_single_file_with_cached_data_only(self, file_data: Dict[str, Any]) -> Dict[str, Any]:
        """Enhance a single file ONLY using cached calendar data - never makes API calls.
        
        This is used for synchronous operations like startup cached files display
        to avoid blocking the GUI thread with slow Outlook API calls.
        """
        enhanced_file = file_data.copy()
        filename = file_data['name']
        
        try:
            # Parse file creation datetime
            file_datetime = self._parse_file_datetime(file_data)
            if not file_datetime:
                enhanced_file.update(self._create_empty_meeting_fields())
                return enhanced_file
            
            # Check cache ONLY - never make API calls
            cached_meeting = self._calendar_cache_manager.get_cached_meeting_for_file(filename, file_datetime)
            if cached_meeting:
                # Use cached data
                enhanced_file.update(self._create_meeting_fields_from_cached(cached_meeting))
                logger.debug("AsyncCalendar", "enhance_cached_only", 
                           f"Applied cached meeting data for {filename}: {cached_meeting.subject or 'No meeting'}")
            else:
                # No cached data - return empty meeting fields (don't cache "no meeting" here)
                enhanced_file.update(self._create_empty_meeting_fields())
                logger.debug("AsyncCalendar", "enhance_cached_only", 
                           f"No cached meeting data for {filename}")
            
            return enhanced_file
            
        except Exception as e:
            logger.warning("AsyncCalendar", "enhance_cached_only", f"Error enhancing {filename} with cached data: {e}")
            enhanced_file.update(self._create_empty_meeting_fields())
            return enhanced_file
