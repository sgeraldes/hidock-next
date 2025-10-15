#!/usr/bin/env python3
"""
Tests for simple_calendar_mixin.py
Covers synchronous calendar functionality, file enhancement, and status reporting.
"""

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

# Add the parent directory to sys.path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

class TestSimpleCalendarMixin(unittest.TestCase):
    """Test the SimpleCalendarMixin functionality."""

    def setUp(self):
        """Set up test fixtures."""
        self.mock_integration = Mock()
        self.mock_integration.is_available.return_value = True
        self.mock_integration.get_calendar_status_text.return_value = "Calendar: Ready"
        
    def test_import_simple_calendar_mixin(self):
        """Test that simple_calendar_mixin can be imported."""
        try:
            import simple_calendar_mixin
            self.assertTrue(hasattr(simple_calendar_mixin, 'SimpleCalendarMixin'))
            self.assertTrue(hasattr(simple_calendar_mixin, 'SIMPLE_CALENDAR_AVAILABLE'))
        except ImportError as e:
            self.fail(f"Failed to import simple_calendar_mixin: {e}")

    def test_simple_calendar_mixin_initialization(self):
        """Test SimpleCalendarMixin initialization."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        self.assertIsNone(mixin._calendar_integration)
        self.assertEqual(mixin._calendar_cache, {})
        self.assertIsNone(mixin._calendar_cache_date)

    @patch('simple_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE', True)
    @patch('simple_calendar_mixin.create_simple_outlook_integration')
    def test_ensure_calendar_initialized_success(self, mock_create_integration):
        """Test successful calendar initialization."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        mock_create_integration.return_value = self.mock_integration
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        mixin._ensure_calendar_initialized()
        
        self.assertIsNotNone(mixin._calendar_integration)
        mock_create_integration.assert_called_once()

    @patch('simple_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE', False)
    def test_ensure_calendar_initialized_not_available(self):
        """Test calendar initialization when not available."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        mixin._ensure_calendar_initialized()
        
        self.assertIsNone(mixin._calendar_integration)

    def test_get_calendar_status_text_for_gui_no_integration(self):
        """Test get_calendar_status_text_for_gui when no integration."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        status = mixin.get_calendar_status_text_for_gui()
        self.assertEqual(status, "Calendar: Not Available")

    def test_get_calendar_status_text_for_gui_with_integration(self):
        """Test get_calendar_status_text_for_gui with integration."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = self.mock_integration
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        status = mixin.get_calendar_status_text_for_gui()
        self.assertEqual(status, "Calendar: Ready")

    def test_enhance_files_with_meeting_data_empty_list(self):
        """Test enhance_files_with_meeting_data with empty list."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        result = mixin.enhance_files_with_meeting_data([])
        self.assertEqual(result, [])

    @patch('simple_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE', False)
    def test_enhance_files_not_available(self):
        """Test enhance_files_with_meeting_data when calendar not available."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        files_dict = [
            {
                'name': 'test.wav',
                'time': datetime.now(),
                'createDate': '2023-01-01',
                'createTime': '10:00:00'
            }
        ]
        
        result = mixin.enhance_files_with_meeting_data(files_dict)
        
        # Should add empty meeting fields
        self.assertEqual(len(result), 1)
        self.assertFalse(result[0]['has_meeting'])
        self.assertEqual(result[0]['meeting_subject'], '')

    def test_enhance_files_integration_not_available(self):
        """Test enhance_files when integration is not available."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        mock_integration = Mock()
        mock_integration.is_available.return_value = False
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = mock_integration
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        files_dict = [{'name': 'test.wav', 'time': datetime.now()}]
        result = mixin.enhance_files_with_meeting_data(files_dict)
        
        self.assertEqual(len(result), 1)
        self.assertFalse(result[0]['has_meeting'])

    def test_parse_file_datetime_with_time_field(self):
        """Test _parse_file_datetime with time field."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        test_time = datetime(2023, 1, 15, 10, 30, 0)
        file_data = {'time': test_time}
        
        result = mixin._parse_file_datetime(file_data)
        self.assertEqual(result, test_time)

    def test_parse_file_datetime_with_date_time_strings(self):
        """Test _parse_file_datetime with date and time strings."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        file_data = {
            'createDate': '2023-01-15',
            'createTime': '10:30:00'
        }
        
        result = mixin._parse_file_datetime(file_data)
        expected = datetime(2023, 1, 15, 10, 30, 0)
        self.assertEqual(result, expected)

    def test_parse_file_datetime_invalid_data(self):
        """Test _parse_file_datetime with invalid data."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        # Test with missing data
        file_data = {'name': 'test.wav'}
        result = mixin._parse_file_datetime(file_data)
        self.assertIsNone(result)
        
        # Test with invalid date format
        file_data = {
            'createDate': 'invalid-date',
            'createTime': '10:30:00'
        }
        result = mixin._parse_file_datetime(file_data)
        self.assertIsNone(result)

    def test_find_meeting_for_file_with_cache(self):
        """Test _find_meeting_for_file with caching."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        # Mock meeting
        mock_meeting = Mock()
        mock_meeting.start_time = datetime(2023, 1, 15, 10, 0, 0)
        mock_meeting.subject = "Test Meeting"
        
        mock_integration = Mock()
        mock_integration.get_meetings_for_date.return_value = [mock_meeting]
        mock_integration.find_meeting_for_recording.return_value = mock_meeting
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = mock_integration
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        file_datetime = datetime(2023, 1, 15, 10, 15, 0)
        result = mixin._find_meeting_for_file(file_datetime)
        
        self.assertEqual(result, mock_meeting)
        mock_integration.get_meetings_for_date.assert_called_once_with(file_datetime)
        mock_integration.find_meeting_for_recording.assert_called_once()

    def test_find_meeting_for_file_exception(self):
        """Test _find_meeting_for_file with exception."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        mock_integration = Mock()
        mock_integration.get_meetings_for_date.side_effect = Exception("Calendar error")
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = mock_integration
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        file_datetime = datetime(2023, 1, 15, 10, 15, 0)
        result = mixin._find_meeting_for_file(file_datetime)
        
        self.assertIsNone(result)

    def test_create_simple_meeting_fields(self):
        """Test _create_simple_meeting_fields."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        # Mock meeting
        mock_meeting = Mock()
        mock_meeting.subject = "Team Meeting"
        mock_meeting.organizer = "john.doe@example.com"
        mock_meeting.location = "Conference Room A"
        mock_meeting.attendees = ["alice@example.com", "bob@example.com"]
        mock_meeting.start_time = datetime(2023, 1, 15, 10, 0, 0)
        mock_meeting.end_time = datetime(2023, 1, 15, 11, 0, 0)
        mock_meeting.duration_minutes = 60
        
        result = mixin._create_simple_meeting_fields(mock_meeting)
        
        self.assertTrue(result['has_meeting'])
        self.assertEqual(result['meeting_subject'], 'Team Meeting')
        self.assertEqual(result['meeting_organizer'], 'John Doe')
        self.assertEqual(result['meeting_location'], 'Conference Room A')
        self.assertEqual(result['meeting_attendees_display'], '2 attendees')
        self.assertEqual(result['meeting_time_display'], '10:00')

    def test_create_simple_meeting_fields_no_subject(self):
        """Test _create_simple_meeting_fields with no subject."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        mock_meeting = Mock()
        mock_meeting.subject = None
        mock_meeting.organizer = "john@example.com"
        mock_meeting.location = ""
        mock_meeting.attendees = []
        mock_meeting.start_time = datetime(2023, 1, 15, 10, 0, 0)
        mock_meeting.end_time = datetime(2023, 1, 15, 11, 0, 0)
        mock_meeting.duration_minutes = 60
        
        result = mixin._create_simple_meeting_fields(mock_meeting)
        
        self.assertEqual(result['meeting_subject'], 'No Subject')
        self.assertEqual(result['meeting_attendees_display'], 'No attendees')
        self.assertEqual(result['meeting_type'], 'Virtual')

    def test_create_simple_meeting_fields_teams_meeting(self):
        """Test _create_simple_meeting_fields for Teams meeting."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        mock_meeting = Mock()
        mock_meeting.subject = "Teams Meeting"
        mock_meeting.organizer = "host@example.com"
        mock_meeting.location = "https://teams.microsoft.com/meeting/join"
        mock_meeting.attendees = ["user@example.com"]
        mock_meeting.start_time = datetime(2023, 1, 15, 10, 0, 0)
        mock_meeting.end_time = datetime(2023, 1, 15, 11, 0, 0)
        mock_meeting.duration_minutes = 60
        
        result = mixin._create_simple_meeting_fields(mock_meeting)
        
        self.assertEqual(result['meeting_type'], 'Teams')
        self.assertEqual(result['meeting_attendees_display'], '1 attendee')

    def test_create_empty_meeting_fields(self):
        """Test _create_empty_meeting_fields."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        result = mixin._create_empty_meeting_fields()
        
        self.assertFalse(result['has_meeting'])
        self.assertEqual(result['meeting_subject'], '')
        self.assertEqual(result['meeting_organizer'], '')
        self.assertEqual(result['meeting_location'], '')
        self.assertEqual(result['meeting_attendees_count'], 0)
        self.assertEqual(result['meeting_display_text'], 'No Meeting')

    def test_add_empty_meeting_fields(self):
        """Test _add_empty_meeting_fields."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        files_dict = [
            {'name': 'test1.wav'},
            {'name': 'test2.wav'}
        ]
        
        result = mixin._add_empty_meeting_fields(files_dict)
        
        self.assertEqual(len(result), 2)
        for file_data in result:
            self.assertFalse(file_data['has_meeting'])
            self.assertEqual(file_data['meeting_subject'], '')

    @patch('simple_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE', False)
    def test_get_simple_calendar_status_not_available(self):
        """Test get_simple_calendar_status when not available."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        result = mixin.get_simple_calendar_status()
        
        self.assertEqual(result['status'], 'Not Available')
        self.assertIn('Simple calendar integration module not found', result['message'])

    def test_get_simple_calendar_status_not_initialized(self):
        """Test get_simple_calendar_status when not initialized."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        result = mixin.get_simple_calendar_status()
        
        self.assertEqual(result['status'], 'Not Initialized')

    def test_get_simple_calendar_status_integration_not_available(self):
        """Test get_simple_calendar_status when integration not available."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        mock_integration = Mock()
        mock_integration.is_available.return_value = False
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = mock_integration
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        result = mixin.get_simple_calendar_status()
        
        self.assertEqual(result['status'], 'No Methods Available')

    def test_enhance_files_with_meeting_data_full_flow(self):
        """Test the complete enhance_files_with_meeting_data flow."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        # Mock meeting
        mock_meeting = Mock()
        mock_meeting.subject = "Daily Standup"
        mock_meeting.organizer = "manager@company.com"
        mock_meeting.location = "Conference Room B"
        mock_meeting.attendees = ["dev1@company.com", "dev2@company.com", "dev3@company.com"]
        mock_meeting.start_time = datetime(2023, 1, 15, 9, 0, 0)
        mock_meeting.end_time = datetime(2023, 1, 15, 9, 30, 0)
        mock_meeting.duration_minutes = 30
        
        # Mock integration
        mock_integration = Mock()
        mock_integration.is_available.return_value = True
        mock_integration.get_meetings_for_date.return_value = [mock_meeting]
        mock_integration.find_meeting_for_recording.return_value = mock_meeting
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = mock_integration
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        with patch('simple_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE', True):
            mixin = TestMixin()
            
            files_dict = [
                {
                    'name': 'standup_recording.wav',
                    'time': datetime(2023, 1, 15, 9, 5, 0),
                    'createDate': '2023-01-15',
                    'createTime': '09:05:00',
                    'length': 1024,
                    'duration': 25.0
                }
            ]
            
            result = mixin.enhance_files_with_meeting_data(files_dict)
            
            self.assertEqual(len(result), 1)
            enhanced_file = result[0]
            
            self.assertTrue(enhanced_file['has_meeting'])
            self.assertEqual(enhanced_file['meeting_subject'], 'Daily Standup')
            self.assertEqual(enhanced_file['meeting_organizer'], 'Manager')
            self.assertEqual(enhanced_file['meeting_location'], 'Conference Room B')
            self.assertEqual(enhanced_file['meeting_attendees_display'], '3 attendees')
            self.assertEqual(enhanced_file['meeting_time_display'], '09:00')


class TestSimpleCalendarMixinEdgeCases(unittest.TestCase):
    """Test edge cases and error handling in SimpleCalendarMixin."""

    def test_enhance_files_with_exception_handling(self):
        """Test enhance_files_with_meeting_data exception handling."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        # Mock integration that raises exception
        mock_integration = Mock()
        mock_integration.is_available.return_value = True
        mock_integration.get_meetings_for_date.side_effect = Exception("Network error")
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = mock_integration
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        with patch('simple_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE', True):
            mixin = TestMixin()
            
            files_dict = [{'name': 'test.wav', 'time': datetime.now()}]
            result = mixin.enhance_files_with_meeting_data(files_dict)
            
            # Should return files with empty meeting fields
            self.assertEqual(len(result), 1)
            self.assertFalse(result[0]['has_meeting'])

    def test_long_meeting_subject_truncation(self):
        """Test that long meeting subjects are truncated."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = None
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        mock_meeting = Mock()
        mock_meeting.subject = "This is a very long meeting subject that should be truncated because it exceeds the display limit"
        mock_meeting.organizer = "organizer@example.com"
        mock_meeting.location = ""
        mock_meeting.attendees = []
        mock_meeting.start_time = datetime(2023, 1, 15, 10, 0, 0)
        mock_meeting.end_time = datetime(2023, 1, 15, 11, 0, 0)
        mock_meeting.duration_minutes = 60
        
        result = mixin._create_simple_meeting_fields(mock_meeting)
        
        # Should be truncated with ellipsis
        self.assertTrue(result['meeting_display_text'].endswith('...'))
        self.assertTrue(len(result['meeting_display_text']) <= 60)

    def test_cache_behavior_different_dates(self):
        """Test calendar cache behavior with different dates."""
        from simple_calendar_mixin import SimpleCalendarMixin
        
        mock_meeting1 = Mock()
        mock_meeting1.start_time = datetime(2023, 1, 15, 10, 0, 0)
        
        mock_meeting2 = Mock() 
        mock_meeting2.start_time = datetime(2023, 1, 16, 10, 0, 0)
        
        mock_integration = Mock()
        mock_integration.get_meetings_for_date.side_effect = [
            [mock_meeting1],  # First call for Jan 15
            [mock_meeting2]   # Second call for Jan 16
        ]
        mock_integration.find_meeting_for_recording.return_value = None
        
        class TestMixin(SimpleCalendarMixin):
            def __init__(self):
                self._calendar_integration = mock_integration
                self._calendar_cache = {}
                self._calendar_cache_date = None
        
        mixin = TestMixin()
        
        # First request for Jan 15
        file_datetime1 = datetime(2023, 1, 15, 10, 15, 0)
        mixin._find_meeting_for_file(file_datetime1)
        
        # Second request for Jan 16 (should refresh cache)
        file_datetime2 = datetime(2023, 1, 16, 10, 15, 0)
        mixin._find_meeting_for_file(file_datetime2)
        
        # Should have called get_meetings_for_date twice (cache refresh)
        self.assertEqual(mock_integration.get_meetings_for_date.call_count, 2)


if __name__ == '__main__':
    unittest.main()
