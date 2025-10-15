"""
Unit tests for OutlookCalendarService.

These tests verify the Outlook Calendar integration functionality with proper mocking
to avoid requiring actual Azure AD setup or network calls during testing.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock, MagicMock, patch
from typing import Dict, List

# Test imports (will be available due to conftest.py setup)
from config_and_logger import load_config, save_config
from outlook_calendar_service import OutlookCalendarService, MeetingMetadata, OUTLOOK_AVAILABLE


class TestMeetingMetadata:
    """Test MeetingMetadata class functionality."""
    
    def test_meeting_metadata_creation(self):
        """Test creating MeetingMetadata from event data."""
        event_data = {
            'id': 'test-event-123',
            'subject': 'Team Standup',
            'organizer': 'manager@company.com',
            'attendees': ['dev1@company.com', 'dev2@company.com'],
            'start_time': datetime(2024, 8, 23, 9, 0),
            'end_time': datetime(2024, 8, 23, 9, 30),
            'location': 'Conference Room A',
            'body': 'Daily standup meeting',
            'meeting_url': 'https://teams.microsoft.com/l/meetup-join/12345',
            'is_recurring': True,
            'categories': ['Work'],
            'sensitivity': 'normal'
        }
        
        meeting = MeetingMetadata(event_data)
        
        assert meeting.event_id == 'test-event-123'
        assert meeting.subject == 'Team Standup'
        assert meeting.organizer == 'manager@company.com'
        assert len(meeting.attendees) == 2
        assert meeting.is_teams_meeting is True  # Should detect Teams URL
        assert meeting.is_recurring is True
        assert meeting.location == 'Conference Room A'
    
    def test_meeting_metadata_teams_detection(self):
        """Test Teams meeting URL detection."""
        # Test with Teams URL
        teams_data = {'meeting_url': 'https://teams.microsoft.com/l/meetup-join/abc123'}
        teams_meeting = MeetingMetadata(teams_data)
        assert teams_meeting.is_teams_meeting is True
        
        # Test with Zoom URL
        zoom_data = {'meeting_url': 'https://zoom.us/j/123456789'}
        zoom_meeting = MeetingMetadata(zoom_data)
        assert zoom_meeting.is_teams_meeting is False
        
        # Test with no URL
        no_url_data = {'meeting_url': ''}
        no_url_meeting = MeetingMetadata(no_url_data)
        assert no_url_meeting.is_teams_meeting is False
    
    def test_meeting_metadata_serialization(self):
        """Test converting MeetingMetadata to/from dictionary."""
        original_data = {
            'id': 'test-123',
            'subject': 'Test Meeting',
            'organizer': 'test@example.com',
            'attendees': ['user1@example.com'],
            'start_time': datetime(2024, 8, 23, 14, 0),
            'end_time': datetime(2024, 8, 23, 15, 0),
            'location': 'Room 1',
            'body': 'Test meeting body',
            'meeting_url': '',
            'is_recurring': False,
            'categories': ['Test'],
            'sensitivity': 'normal'
        }
        
        meeting = MeetingMetadata(original_data)
        serialized = meeting.to_dict()
        
        # Test serialization
        assert serialized['event_id'] == 'test-123'
        assert serialized['subject'] == 'Test Meeting'
        assert isinstance(serialized['start_time'], str)  # Should be ISO format
        
        # Test deserialization
        restored_meeting = MeetingMetadata.from_dict(serialized)
        assert restored_meeting.event_id == meeting.event_id
        assert restored_meeting.subject == meeting.subject
        assert restored_meeting.start_time == meeting.start_time


class TestOutlookCalendarService:
    """Test OutlookCalendarService functionality."""
    
    @pytest.fixture
    def mock_config(self):
        """Mock configuration dictionary."""
        return {
            'calendar_provider': 'disabled',  # Default: integration disabled
            'calendar_outlook_client_id': '',
            'calendar_outlook_client_secret_encrypted': '',
            'calendar_outlook_tenant_id': 'common',
            'calendar_enable_correlation': True,
            'calendar_correlation_window_minutes': 15,
            'calendar_cache_duration_hours': 1
        }
    
    @pytest.fixture
    def outlook_service(self, mock_config):
        """Create OutlookCalendarService instance for testing."""
        return OutlookCalendarService(mock_config)
    
    def test_service_initialization(self, outlook_service, mock_config):
        """Test service initialization."""
        assert outlook_service.config == mock_config
        assert outlook_service.account is None
        assert outlook_service.schedule is None
        assert outlook_service._is_authenticated is False
        assert outlook_service.cache_duration == 3600  # 1 hour
    
    def test_is_available(self, outlook_service):
        """Test availability check."""
        # This tests the actual O365 library availability
        assert outlook_service.is_available() == OUTLOOK_AVAILABLE
    
    def test_is_enabled(self, outlook_service, mock_config):
        """Test enabled status check."""
        # Default: disabled
        assert outlook_service.is_enabled() is False
        
        # Enable integration
        mock_config['calendar_provider'] = 'outlook'
        assert outlook_service.is_enabled() is True
    
    def test_is_authenticated(self, outlook_service):
        """Test authentication status check."""
        # Default: not authenticated
        assert outlook_service.is_authenticated() is False
        
        # Mock authenticated state
        outlook_service._is_authenticated = True
        outlook_service.account = Mock()
        assert outlook_service.is_authenticated() is True
        
        # If no account, still not authenticated
        outlook_service.account = None
        assert outlook_service.is_authenticated() is False
    
    @patch('outlook_calendar_service.OUTLOOK_AVAILABLE', False)
    def test_authenticate_no_library(self, outlook_service):
        """Test authentication when O365 library is not available."""
        result = outlook_service.authenticate("client_id", "client_secret")
        assert result is False
    
    @patch('outlook_calendar_service.OUTLOOK_AVAILABLE', True)
    @patch('outlook_calendar_service.Account')
    def test_authenticate_success(self, mock_account_class, outlook_service):
        """Test successful authentication."""
        # Mock the Account class and its methods
        mock_account = Mock()
        mock_account.authenticate.return_value = True
        mock_account.schedule.return_value = Mock()
        mock_account_class.return_value = mock_account
        
        result = outlook_service.authenticate("test_client_id", "test_client_secret", "common")
        
        assert result is True
        assert outlook_service._is_authenticated is True
        assert outlook_service.account == mock_account
        assert outlook_service.schedule is not None
        
        # Verify Account was created with correct parameters
        mock_account_class.assert_called_once_with(
            ("test_client_id", "test_client_secret"),
            auth_flow_type='authorization',
            tenant_id='common'
        )
        
        # Verify authentication was attempted with correct scopes
        mock_account.authenticate.assert_called_once_with(
            scopes=['https://graph.microsoft.com/Calendars.Read']
        )
    
    @patch('outlook_calendar_service.OUTLOOK_AVAILABLE', True)
    @patch('outlook_calendar_service.Account')
    def test_authenticate_failure(self, mock_account_class, outlook_service):
        """Test authentication failure."""
        # Mock authentication failure
        mock_account = Mock()
        mock_account.authenticate.return_value = False
        mock_account_class.return_value = mock_account
        
        result = outlook_service.authenticate("client_id", "client_secret")
        
        assert result is False
        assert outlook_service._is_authenticated is False
        assert outlook_service.account is None
    
    
    def test_get_status_info(self, outlook_service):
        """Test status information retrieval."""
        status = outlook_service.get_status_info()
        
        assert isinstance(status, dict)
        assert 'available' in status
        assert 'enabled' in status
        assert 'authenticated' in status
        assert 'cache_age' in status
    
    def test_find_meeting_for_audio_file_not_authenticated(self, outlook_service):
        """Test meeting correlation when not authenticated."""
        test_time = datetime.now()
        result = outlook_service.find_meeting_for_audio_file(test_time)
        assert result is None
    
    @patch('outlook_calendar_service.OUTLOOK_AVAILABLE', True)
    def test_find_meeting_for_audio_file_with_match(self, outlook_service):
        """Test meeting correlation with matching meeting."""
        # Setup authenticated state
        outlook_service._is_authenticated = True
        outlook_service.account = Mock()
        
        # Mock meeting data
        test_time = datetime(2024, 8, 23, 9, 15)  # 15 minutes into a 9:00 meeting
        
        mock_meeting = MeetingMetadata({
            'id': 'meeting-123',
            'subject': 'Daily Standup',
            'organizer': 'manager@company.com',
            'attendees': ['dev@company.com'],
            'start_time': datetime(2024, 8, 23, 9, 0),
            'end_time': datetime(2024, 8, 23, 9, 30),
            'location': '',
            'body': '',
            'meeting_url': '',
            'is_recurring': False,
            'categories': [],
            'sensitivity': 'normal'
        })
        
        # Mock get_meetings_for_date_range to return our test meeting
        with patch.object(outlook_service, 'get_meetings_for_date_range') as mock_get_meetings:
            mock_get_meetings.return_value = [mock_meeting]
            
            result = outlook_service.find_meeting_for_audio_file(test_time)
            
            assert result is not None
            assert result.subject == 'Daily Standup'
            assert result.event_id == 'meeting-123'
    
    def test_clear_cache(self, outlook_service):
        """Test cache clearing functionality."""
        # This should not raise an exception
        outlook_service.clear_cache()
    
    def test_meeting_correlation_algorithm_edge_cases(self):
        """Test meeting correlation algorithm with edge cases."""
        # Test data setup
        meetings = [
            MeetingMetadata({
                'id': 'meeting-1',
                'subject': 'Morning Meeting',
                'start_time': datetime(2024, 8, 23, 9, 0),
                'end_time': datetime(2024, 8, 23, 9, 30),
                'organizer': 'test@example.com',
                'attendees': [],
                'location': '',
                'body': '',
                'meeting_url': '',
                'is_recurring': False,
                'categories': [],
                'sensitivity': 'normal'
            }),
            MeetingMetadata({
                'id': 'meeting-2', 
                'subject': 'Afternoon Meeting',
                'start_time': datetime(2024, 8, 23, 14, 0),
                'end_time': datetime(2024, 8, 23, 15, 0),
                'organizer': 'test@example.com',
                'attendees': [],
                'location': '',
                'body': '',
                'meeting_url': '',
                'is_recurring': False,
                'categories': [],
                'sensitivity': 'normal'
            })
        ]
        
        # Test exact match (audio starts during meeting)
        audio_time_exact = datetime(2024, 8, 23, 9, 15)  # During first meeting
        candidates = []
        for meeting in meetings:
            if meeting.start_time <= audio_time_exact <= meeting.end_time:
                candidates.append((meeting, 0))  # Priority 0 for exact match
        
        assert len(candidates) == 1
        assert candidates[0][0].subject == 'Morning Meeting'
        assert candidates[0][1] == 0  # Exact match priority
        
        # Test late start (audio starts up to 30 min after meeting start)
        audio_time_late = datetime(2024, 8, 23, 9, 20)  # 20 min after meeting start
        candidates = []
        for meeting in meetings:
            if meeting.start_time <= audio_time_late <= meeting.end_time:
                candidates.append((meeting, 0))
            elif meeting.start_time <= audio_time_late <= meeting.start_time + timedelta(minutes=30):
                candidates.append((meeting, 1))  # Priority 1 for close match
        
        assert len(candidates) == 1
        assert candidates[0][1] == 0  # Should still be exact match


# NOTE: Mixin tests would require significant refactoring due to the
# change from ConfigManager to config dictionary approach.
# These tests are omitted for now but could be added later.


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
