# calendar_filter_engine.py
"""
Calendar Filter Engine for HiDock Desktop

Core filtering logic for searching and filtering meetings by various criteria.
"""

import re
from datetime import datetime
from typing import List, Dict, Any, Optional
from difflib import SequenceMatcher

from config_and_logger import logger


class CalendarFilterEngine:
    """Engine for filtering calendar meetings based on various criteria."""
    
    def __init__(self):
        self.fuzzy_threshold = 0.6  # Similarity threshold for fuzzy matching
        logger.info("CalendarFilter", "init", "Calendar filter engine initialized")
    
    def apply_filters(self, files_data: List[Dict[str, Any]], filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Apply filters to the files data and return filtered results.
        
        Args:
            files_data: List of file dictionaries with meeting information
            filters: Dictionary of active filters
            
        Returns:
            Filtered list of file dictionaries
        """
        if not filters:
            return files_data
        
        try:
            filtered_files = files_data.copy()
            
            # Apply subject filter
            if 'subject' in filters and filters['subject']:
                filtered_files = self.filter_by_subject(
                    filtered_files, 
                    filters['subject'], 
                    fuzzy=filters.get('fuzzy_match', True)
                )
            
            # Apply participant filter (future enhancement)
            if 'participant' in filters and filters['participant']:
                filtered_files = self.filter_by_participant(
                    filtered_files, 
                    filters['participant']
                )
            
            # Apply date range filter (future enhancement)
            if 'date_range' in filters and filters['date_range']:
                date_range = filters['date_range']
                if isinstance(date_range, dict) and 'start' in date_range and 'end' in date_range:
                    filtered_files = self.filter_by_date_range(
                        filtered_files,
                        date_range['start'],
                        date_range['end']
                    )
            
            # Apply meeting type filter (future enhancement)
            if 'meeting_types' in filters and filters['meeting_types']:
                filtered_files = self.filter_by_meeting_type(
                    filtered_files,
                    filters['meeting_types']
                )
            
            logger.debug("CalendarFilter", "apply_filters", 
                        f"Filtered {len(files_data)} files to {len(filtered_files)} results")
            
            return filtered_files
            
        except Exception as e:
            logger.error("CalendarFilter", "apply_filters", f"Error applying filters: {e}")
            return files_data  # Return original data on error
    
    def filter_by_subject(self, files_data: List[Dict[str, Any]], search_term: str, fuzzy: bool = True) -> List[Dict[str, Any]]:
        """
        Filter files by meeting subject.
        
        Args:
            files_data: List of file dictionaries
            search_term: Text to search for in meeting subjects
            fuzzy: Whether to use fuzzy matching
            
        Returns:
            Filtered list of files
        """
        if not search_term:
            return files_data
        
        search_term = search_term.lower().strip()
        filtered_files = []
        
        for file_data in files_data:
            try:
                # Check if file has meeting data
                meeting_subject = file_data.get('meeting_subject', '')
                
                # Skip files without meetings unless they match the search term
                if not meeting_subject:
                    # For empty meeting subjects, only include if searching for empty string
                    if not search_term:
                        filtered_files.append(file_data)
                    continue
                
                meeting_subject_lower = meeting_subject.lower()
                
                # Exact substring match (most common case)
                if search_term in meeting_subject_lower:
                    filtered_files.append(file_data)
                    continue
                
                # Fuzzy matching if enabled
                if fuzzy and self._is_fuzzy_match(search_term, meeting_subject_lower):
                    filtered_files.append(file_data)
                    continue
                
            except Exception as e:
                logger.warning("CalendarFilter", "filter_by_subject", 
                             f"Error processing file {file_data.get('name', 'unknown')}: {e}")
                continue
        
        return filtered_files
    
    def filter_by_participant(self, files_data: List[Dict[str, Any]], participant_name: str) -> List[Dict[str, Any]]:
        """
        Filter files by meeting participant (organizer or attendees).
        
        Args:
            files_data: List of file dictionaries
            participant_name: Name or email to search for
            
        Returns:
            Filtered list of files
        """
        if not participant_name:
            return files_data
        
        participant_name = participant_name.lower().strip()
        filtered_files = []
        
        for file_data in files_data:
            try:
                # Check organizer
                organizer = file_data.get('meeting_organizer', '').lower()
                if participant_name in organizer:
                    filtered_files.append(file_data)
                    continue
                
                # Check attendees (if available)
                attendees_display = file_data.get('meeting_attendees_display', '').lower()
                if participant_name in attendees_display:
                    filtered_files.append(file_data)
                    continue
                
                # TODO: Check individual attendee list when available
                # attendees = file_data.get('meeting_attendees', [])
                # for attendee in attendees:
                #     if participant_name in attendee.get('name', '').lower():
                #         filtered_files.append(file_data)
                #         break
                
            except Exception as e:
                logger.warning("CalendarFilter", "filter_by_participant", 
                             f"Error processing file {file_data.get('name', 'unknown')}: {e}")
                continue
        
        return filtered_files
    
    def filter_by_date_range(self, files_data: List[Dict[str, Any]], start_date: datetime, end_date: datetime) -> List[Dict[str, Any]]:
        """
        Filter files by meeting date range.
        
        Args:
            files_data: List of file dictionaries
            start_date: Start of date range
            end_date: End of date range
            
        Returns:
            Filtered list of files
        """
        if not start_date or not end_date:
            return files_data
        
        filtered_files = []
        
        for file_data in files_data:
            try:
                # Check meeting start time
                meeting_start = file_data.get('meeting_start_time')
                if meeting_start and isinstance(meeting_start, datetime):
                    if start_date <= meeting_start <= end_date:
                        filtered_files.append(file_data)
                        continue
                
                # Fallback: check file creation time if no meeting time
                file_time = file_data.get('time')
                if file_time and isinstance(file_time, datetime):
                    if start_date <= file_time <= end_date:
                        filtered_files.append(file_data)
                
            except Exception as e:
                logger.warning("CalendarFilter", "filter_by_date_range", 
                             f"Error processing file {file_data.get('name', 'unknown')}: {e}")
                continue
        
        return filtered_files
    
    def filter_by_meeting_type(self, files_data: List[Dict[str, Any]], meeting_types: List[str]) -> List[Dict[str, Any]]:
        """
        Filter files by meeting type (Teams, Zoom, In-person, etc.).
        
        Args:
            files_data: List of file dictionaries
            meeting_types: List of meeting types to include
            
        Returns:
            Filtered list of files
        """
        if not meeting_types:
            return files_data
        
        # Normalize meeting types to lowercase
        meeting_types_lower = [mt.lower() for mt in meeting_types]
        filtered_files = []
        
        for file_data in files_data:
            try:
                meeting_type = file_data.get('meeting_type', '').lower()
                if meeting_type in meeting_types_lower:
                    filtered_files.append(file_data)
                
            except Exception as e:
                logger.warning("CalendarFilter", "filter_by_meeting_type", 
                             f"Error processing file {file_data.get('name', 'unknown')}: {e}")
                continue
        
        return filtered_files
    
    def filter_by_has_meeting(self, files_data: List[Dict[str, Any]], has_meeting: bool) -> List[Dict[str, Any]]:
        """
        Filter files based on whether they have associated meetings.
        
        Args:
            files_data: List of file dictionaries
            has_meeting: True to show only files with meetings, False for files without meetings
            
        Returns:
            Filtered list of files
        """
        filtered_files = []
        
        for file_data in files_data:
            try:
                file_has_meeting = file_data.get('has_meeting', False)
                if file_has_meeting == has_meeting:
                    filtered_files.append(file_data)
                
            except Exception as e:
                logger.warning("CalendarFilter", "filter_by_has_meeting", 
                             f"Error processing file {file_data.get('name', 'unknown')}: {e}")
                continue
        
        return filtered_files
    
    def _is_fuzzy_match(self, search_term: str, target: str) -> bool:
        """
        Check if search term fuzzy matches the target string.
        
        Args:
            search_term: Term to search for
            target: Target string to match against
            
        Returns:
            True if fuzzy match score exceeds threshold
        """
        try:
            # Use sequence matcher for fuzzy matching
            similarity = SequenceMatcher(None, search_term, target).ratio()
            return similarity >= self.fuzzy_threshold
            
        except Exception as e:
            logger.debug("CalendarFilter", "_is_fuzzy_match", f"Error in fuzzy matching: {e}")
            return False
    
    def get_filter_suggestions(self, files_data: List[Dict[str, Any]], filter_type: str) -> List[str]:
        """
        Get filter suggestions based on existing data.
        
        Args:
            files_data: List of file dictionaries
            filter_type: Type of filter ('subject', 'organizer', 'type')
            
        Returns:
            List of suggested filter values
        """
        suggestions = set()
        
        try:
            for file_data in files_data:
                if filter_type == 'subject':
                    subject = file_data.get('meeting_subject', '')
                    if subject:
                        # Extract significant words from subjects
                        words = re.findall(r'\b\w{3,}\b', subject.lower())
                        suggestions.update(words)
                
                elif filter_type == 'organizer':
                    organizer = file_data.get('meeting_organizer', '')
                    if organizer:
                        # Extract names/emails
                        if '@' in organizer:
                            name_part = organizer.split('@')[0]
                            suggestions.add(name_part.replace('.', ' ').title())
                        else:
                            suggestions.add(organizer)
                
                elif filter_type == 'type':
                    meeting_type = file_data.get('meeting_type', '')
                    if meeting_type:
                        suggestions.add(meeting_type)
            
            # Return sorted suggestions, limited to most common
            return sorted(list(suggestions))[:20]
            
        except Exception as e:
            logger.error("CalendarFilter", "get_filter_suggestions", 
                        f"Error generating suggestions: {e}")
            return []
    
    def get_statistics(self, files_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Get statistics about the files and their meetings.
        
        Args:
            files_data: List of file dictionaries
            
        Returns:
            Dictionary with statistics
        """
        stats = {
            'total_files': len(files_data),
            'files_with_meetings': 0,
            'files_without_meetings': 0,
            'meeting_types': {},
            'unique_organizers': set(),
            'unique_subjects': set()
        }
        
        try:
            for file_data in files_data:
                if file_data.get('has_meeting', False):
                    stats['files_with_meetings'] += 1
                    
                    # Count meeting types
                    meeting_type = file_data.get('meeting_type', 'Unknown')
                    stats['meeting_types'][meeting_type] = stats['meeting_types'].get(meeting_type, 0) + 1
                    
                    # Collect unique organizers and subjects
                    organizer = file_data.get('meeting_organizer', '')
                    if organizer:
                        stats['unique_organizers'].add(organizer)
                    
                    subject = file_data.get('meeting_subject', '')
                    if subject:
                        stats['unique_subjects'].add(subject)
                else:
                    stats['files_without_meetings'] += 1
            
            # Convert sets to counts
            stats['unique_organizers'] = len(stats['unique_organizers'])
            stats['unique_subjects'] = len(stats['unique_subjects'])
            
        except Exception as e:
            logger.error("CalendarFilter", "get_statistics", f"Error calculating statistics: {e}")
        
        return stats