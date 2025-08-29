#!/usr/bin/env python3
"""
Test script for calendar search functionality.

This tests the calendar filter engine without GUI dependencies.
"""

from calendar_filter_engine import CalendarFilterEngine
from datetime import datetime
import json


def create_test_data():
    """Create test file data with meeting information."""
    return [
        {
            'name': 'REC240101_090000.wav',
            'has_meeting': True,
            'meeting_subject': 'Weekly Team Standup',
            'meeting_organizer': 'john.doe@company.com',
            'meeting_attendees_display': '5 attendees',
            'meeting_attendees_count': 5,
            'meeting_location': 'Microsoft Teams Meeting',
            'meeting_type': 'Teams',
            'meeting_start_time': datetime(2024, 1, 1, 9, 0),
            'meeting_end_time': datetime(2024, 1, 1, 10, 0),
        },
        {
            'name': 'REC240102_140000.wav',
            'has_meeting': True,
            'meeting_subject': 'Product Planning Session',
            'meeting_organizer': 'jane.smith@company.com',
            'meeting_attendees_display': '8 attendees',
            'meeting_attendees_count': 8,
            'meeting_location': 'Conference Room A',
            'meeting_type': 'In-person',
            'meeting_start_time': datetime(2024, 1, 2, 14, 0),
            'meeting_end_time': datetime(2024, 1, 2, 15, 30),
        },
        {
            'name': 'REC240103_100000.wav',
            'has_meeting': True,
            'meeting_subject': 'Client Demo Zoom Call',
            'meeting_organizer': 'sales.team@company.com',
            'meeting_attendees_display': '3 attendees',
            'meeting_attendees_count': 3,
            'meeting_location': 'https://zoom.us/j/1234567890',
            'meeting_type': 'Zoom',
            'meeting_start_time': datetime(2024, 1, 3, 10, 0),
            'meeting_end_time': datetime(2024, 1, 3, 11, 0),
        },
        {
            'name': 'REC240104_160000.wav',
            'has_meeting': False,
            'meeting_subject': '',
            'meeting_organizer': '',
            'meeting_attendees_display': '',
            'meeting_attendees_count': 0,
            'meeting_location': '',
            'meeting_type': '',
            'meeting_start_time': None,
            'meeting_end_time': None,
        }
    ]


def test_filter_by_subject():
    """Test filtering by meeting subject."""
    print("Testing subject filtering...")
    
    engine = CalendarFilterEngine()
    test_data = create_test_data()
    
    # Test exact match
    filters = {'subject': 'standup'}
    results = engine.filter_by_subject(test_data, 'standup')
    print(f"  Subject 'standup': {len(results)} results")
    assert len(results) == 1
    assert 'Weekly Team Standup' in results[0]['meeting_subject']
    
    # Test partial match
    results = engine.filter_by_subject(test_data, 'demo')
    print(f"  Subject 'demo': {len(results)} results")
    assert len(results) == 1
    assert 'Client Demo' in results[0]['meeting_subject']
    
    # Test no match
    results = engine.filter_by_subject(test_data, 'nonexistent')
    print(f"  Subject 'nonexistent': {len(results)} results")
    assert len(results) == 0
    
    print("Subject filtering tests passed")


def test_filter_by_participant():
    """Test filtering by participant."""
    print("Testing participant filtering...")
    
    engine = CalendarFilterEngine()
    test_data = create_test_data()
    
    # Test organizer match
    results = engine.filter_by_participant(test_data, 'john.doe')
    print(f"  Participant 'john.doe': {len(results)} results")
    assert len(results) == 1
    
    # Test organizer match with domain
    results = engine.filter_by_participant(test_data, 'jane.smith@company.com')
    print(f"  Participant 'jane.smith@company.com': {len(results)} results")
    assert len(results) == 1
    
    print("PASS Participant filtering tests passed")


def test_filter_by_meeting_type():
    """Test filtering by meeting type."""
    print("Testing meeting type filtering...")
    
    engine = CalendarFilterEngine()
    test_data = create_test_data()
    
    # Test Teams meetings
    results = engine.filter_by_meeting_type(test_data, ['Teams'])
    print(f"  Meeting type 'Teams': {len(results)} results")
    assert len(results) == 1
    
    # Test multiple types
    results = engine.filter_by_meeting_type(test_data, ['Teams', 'Zoom'])
    print(f"  Meeting types 'Teams, Zoom': {len(results)} results")
    assert len(results) == 2
    
    print("PASS Meeting type filtering tests passed")


def test_filter_by_has_meeting():
    """Test filtering by meeting existence."""
    print("Testing has meeting filtering...")
    
    engine = CalendarFilterEngine()
    test_data = create_test_data()
    
    # Test files with meetings
    results = engine.filter_by_has_meeting(test_data, True)
    print(f"  Has meeting = True: {len(results)} results")
    assert len(results) == 3
    
    # Test files without meetings
    results = engine.filter_by_has_meeting(test_data, False)
    print(f"  Has meeting = False: {len(results)} results")
    assert len(results) == 1
    
    print("PASS Has meeting filtering tests passed")


def test_combined_filters():
    """Test applying multiple filters together."""
    print("Testing combined filters...")
    
    engine = CalendarFilterEngine()
    test_data = create_test_data()
    
    # Test subject + meeting type
    filters = {
        'subject': 'demo',
        'meeting_types': ['Zoom']
    }
    results = engine.apply_filters(test_data, filters)
    print(f"  Combined 'demo' + 'Zoom': {len(results)} results")
    assert len(results) == 1
    assert 'Client Demo' in results[0]['meeting_subject']
    assert results[0]['meeting_type'] == 'Zoom'
    
    print("PASS Combined filtering tests passed")


def test_statistics():
    """Test statistics generation."""
    print("Testing statistics...")
    
    engine = CalendarFilterEngine()
    test_data = create_test_data()
    
    stats = engine.get_statistics(test_data)
    print(f"  Statistics: {json.dumps(stats, indent=2)}")
    
    assert stats['total_files'] == 4
    assert stats['files_with_meetings'] == 3
    assert stats['files_without_meetings'] == 1
    assert stats['unique_organizers'] == 3
    assert stats['unique_subjects'] == 3
    
    print("PASS Statistics tests passed")


def main():
    """Run all tests."""
    print("Testing Calendar Filter Engine")
    print("=" * 50)
    
    try:
        test_filter_by_subject()
        test_filter_by_participant()
        test_filter_by_meeting_type()
        test_filter_by_has_meeting()
        test_combined_filters()
        test_statistics()
        
        print("=" * 50)
        print("All calendar search tests passed!")
        return True
        
    except Exception as e:
        print("=" * 50)
        print(f"Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == '__main__':
    success = main()
    exit(0 if success else 1)