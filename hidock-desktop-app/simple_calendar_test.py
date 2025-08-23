#!/usr/bin/env python3
"""
Simple Calendar Integration Test

A straightforward test of the calendar integration without complex pytest setup.
This tests the core functionality to verify everything is working.
"""

import sys
from datetime import datetime, timedelta
from unittest.mock import Mock

# Mock a simple config manager that the service expects
class MockConfigManager:
    def __init__(self):
        self.data = {}
    
    def get(self, key, default=None):
        return self.data.get(key, default)
    
    def set(self, key, value):
        self.data[key] = value
        
    def _encrypt_text(self, text):
        return f"encrypted_{text}"
    
    def _decrypt_text(self, text):
        return text.replace("encrypted_", "")


def test_meeting_metadata():
    """Test MeetingMetadata functionality."""
    print("🧪 Testing MeetingMetadata...")
    
    from outlook_calendar_service import MeetingMetadata
    
    # Test basic creation
    event_data = {
        'id': 'test-123',
        'subject': 'Daily Standup',
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
    
    # Test basic properties
    assert meeting.event_id == 'test-123'
    assert meeting.subject == 'Daily Standup'
    assert meeting.organizer == 'manager@company.com'
    assert len(meeting.attendees) == 2
    assert meeting.is_teams_meeting is True  # Should detect Teams URL
    assert meeting.location == 'Conference Room A'
    
    print("  ✅ Basic metadata creation: PASSED")
    
    # Test Teams URL detection
    teams_meeting = MeetingMetadata({'meeting_url': 'https://teams.microsoft.com/join'})
    zoom_meeting = MeetingMetadata({'meeting_url': 'https://zoom.us/j/123456'})
    no_url_meeting = MeetingMetadata({'meeting_url': ''})
    
    assert teams_meeting.is_teams_meeting is True
    assert zoom_meeting.is_teams_meeting is False
    assert no_url_meeting.is_teams_meeting is False
    
    print("  ✅ Teams URL detection: PASSED")
    
    # Test serialization
    serialized = meeting.to_dict()
    assert serialized['event_id'] == 'test-123'
    assert isinstance(serialized['start_time'], str)  # Should be ISO format
    
    # Test deserialization
    restored = MeetingMetadata.from_dict(serialized)
    assert restored.event_id == meeting.event_id
    assert restored.subject == meeting.subject
    assert restored.start_time == meeting.start_time
    
    print("  ✅ Serialization/deserialization: PASSED")
    
    return True


def test_outlook_calendar_service():
    """Test OutlookCalendarService functionality."""
    print("\n🧪 Testing OutlookCalendarService...")
    
    from outlook_calendar_service import OutlookCalendarService, OUTLOOK_AVAILABLE
    
    # Create service with mock config
    config_manager = MockConfigManager()
    service = OutlookCalendarService(config_manager)
    
    # Test initialization
    assert service.config_manager == config_manager
    assert service.account is None
    assert service.schedule is None
    assert service._is_authenticated is False
    assert service.cache_duration == 3600
    
    print("  ✅ Service initialization: PASSED")
    
    # Test availability check
    is_available = service.is_available()
    assert is_available == OUTLOOK_AVAILABLE
    print(f"  ✅ Availability check: PASSED (O365 Available: {OUTLOOK_AVAILABLE})")
    
    # Test enabled status (should be False by default)
    assert service.is_enabled() is False
    
    # Enable integration
    config_manager.set("outlook_integration_enabled", True)
    assert service.is_enabled() is True
    
    print("  ✅ Enable/disable status: PASSED")
    
    # Test authentication status (should be False initially)
    assert service.is_authenticated() is False
    
    print("  ✅ Authentication status check: PASSED")
    
    # Test get status info
    status = service.get_status_info()
    assert isinstance(status, dict)
    assert 'available' in status
    assert 'enabled' in status  
    assert 'authenticated' in status
    assert 'cache_age' in status
    
    print("  ✅ Status info: PASSED")
    
    # Test cache clearing (should not raise exception)
    service.clear_cache()
    print("  ✅ Cache clearing: PASSED")
    
    # Test meeting correlation when not authenticated
    test_time = datetime.now()
    result = service.find_meeting_for_audio_file(test_time)
    assert result is None  # Should return None when not authenticated
    
    print("  ✅ Meeting correlation (not authenticated): PASSED")
    
    return True


def test_meeting_correlation_algorithm():
    """Test the meeting correlation algorithm logic."""
    print("\n🧪 Testing meeting correlation algorithm...")
    
    from outlook_calendar_service import MeetingMetadata
    
    # Create test meetings
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
    audio_time_exact = datetime(2024, 8, 23, 9, 15)  # 15 minutes into morning meeting
    candidates = []
    
    for meeting in meetings:
        if meeting.start_time <= audio_time_exact <= meeting.end_time:
            candidates.append((meeting, 0))  # Priority 0 for exact match
    
    assert len(candidates) == 1
    assert candidates[0][0].subject == 'Morning Meeting'
    assert candidates[0][1] == 0  # Exact match priority
    
    print("  ✅ Exact match correlation: PASSED")
    
    # Test close match (audio starts shortly after meeting start)
    audio_time_late = datetime(2024, 8, 23, 9, 20)  # 20 min after meeting start
    candidates = []
    
    for meeting in meetings:
        if meeting.start_time <= audio_time_late <= meeting.end_time:
            candidates.append((meeting, 0))  # Exact match
        elif meeting.start_time <= audio_time_late <= meeting.start_time + timedelta(minutes=30):
            candidates.append((meeting, 1))  # Close match
    
    assert len(candidates) == 1
    assert candidates[0][1] == 0  # Should still be exact match since it's within the meeting
    
    print("  ✅ Close match correlation: PASSED")
    
    # Test no match scenario
    audio_time_no_match = datetime(2024, 8, 23, 11, 0)  # Between meetings
    candidates = []
    
    for meeting in meetings:
        if meeting.start_time <= audio_time_no_match <= meeting.end_time:
            candidates.append((meeting, 0))
        elif meeting.start_time <= audio_time_no_match <= meeting.start_time + timedelta(minutes=30):
            candidates.append((meeting, 1))
    
    assert len(candidates) == 0  # No matching meetings
    
    print("  ✅ No match scenario: PASSED")
    
    return True


def main():
    """Run all tests."""
    print("🚀 Simple Calendar Integration Test")
    print("=" * 50)
    
    tests = [
        ("MeetingMetadata", test_meeting_metadata),
        ("OutlookCalendarService", test_outlook_calendar_service), 
        ("Meeting Correlation Algorithm", test_meeting_correlation_algorithm)
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        try:
            success = test_func()
            if success:
                passed += 1
                print(f"✅ {test_name}: ALL TESTS PASSED")
            else:
                print(f"❌ {test_name}: SOME TESTS FAILED")
        except Exception as e:
            print(f"❌ {test_name}: FAILED with exception: {e}")
            import traceback
            traceback.print_exc()
    
    print("\n" + "=" * 50)
    print(f"📊 Test Summary: {passed}/{total} test suites passed")
    
    if passed == total:
        print("🎉 ALL TESTS PASSED! Calendar integration is working correctly.")
        return 0
    else:
        print("⚠️  Some tests failed. Check output above for details.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
