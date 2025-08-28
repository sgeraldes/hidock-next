#!/usr/bin/env python3
"""
Script to check calendar data for a specific date (2025/08/13)
"""

import sys
import os
import io
from datetime import datetime, timedelta
from pathlib import Path

# Set UTF-8 encoding for Windows console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Add the current directory to the path
sys.path.insert(0, str(Path(__file__).parent))

# Import the calendar integration modules
from simple_outlook_integration import SimpleOutlookIntegration
from calendar_cache_manager import CalendarCacheManager
from config_and_logger import logger

def check_calendar_for_date():
    """Check calendar data for August 13, 2025."""
    
    target_date = datetime(2025, 8, 13)
    print(f"\n{'='*60}")
    print(f"Checking calendar data for: {target_date.strftime('%Y/%m/%d (%A)')}")
    print(f"{'='*60}\n")
    
    # Initialize calendar integration
    print("1. Initializing calendar integration...")
    calendar = SimpleOutlookIntegration()
    
    if not calendar.is_available():
        print("   [X] Calendar integration is not available")
        print(f"   Last error: {calendar.last_error}")
        return
    
    print(f"   [OK] Calendar integration available")
    print(f"   Available methods: {calendar.available_methods}")
    
    # Check cache first
    print("\n2. Checking calendar cache...")
    cache_path = os.path.join(os.path.expanduser("~"), ".hidock", "calendar_cache.db")
    cache_manager = CalendarCacheManager(cache_path)
    
    # Check for cached meetings in the date range
    print(f"   Cache location: {cache_path}")
    
    # Get meetings for the specific date
    print(f"\n3. Fetching meetings for {target_date.strftime('%Y-%m-%d')}...")
    try:
        meetings = calendar.get_meetings_for_date(target_date)
        
        if meetings:
            print(f"   [OK] Found {len(meetings)} meeting(s):\n")
            for i, meeting in enumerate(meetings, 1):
                print(f"   Meeting {i}:")
                print(f"      Subject: {meeting.subject}")
                print(f"      Start: {meeting.start_time}")
                print(f"      End: {meeting.end_time}")
                print(f"      Organizer: {meeting.organizer}")
                print(f"      Location: {meeting.location or 'No location'}")
                print(f"      Attendees: {meeting.attendee_count}")
                print()
        else:
            print(f"   [INFO] No meetings found for {target_date.strftime('%Y-%m-%d')}")
    except Exception as e:
        print(f"   [ERROR] Error fetching meetings: {e}")
    
    # Also check a wider range around that date
    print(f"\n4. Checking week around {target_date.strftime('%Y-%m-%d')}...")
    start_of_week = target_date - timedelta(days=target_date.weekday())  # Monday
    end_of_week = start_of_week + timedelta(days=6)  # Sunday
    
    try:
        print(f"   Date range: {start_of_week.strftime('%Y-%m-%d')} to {end_of_week.strftime('%Y-%m-%d')}")
        
        meetings = calendar.get_meetings_for_date_range(start_of_week, end_of_week)
        
        if meetings:
            print(f"   [OK] Found {len(meetings)} meeting(s) in the week:")
            
            # Group by date
            meetings_by_date = {}
            for meeting in meetings:
                meeting_date = meeting.start_time.date()
                if meeting_date not in meetings_by_date:
                    meetings_by_date[meeting_date] = []
                meetings_by_date[meeting_date].append(meeting)
            
            for date in sorted(meetings_by_date.keys()):
                date_meetings = meetings_by_date[date]
                if date == target_date.date():
                    print(f"\n   [DATE] {date.strftime('%Y-%m-%d (%A)')} ** TARGET DATE **:")
                else:
                    print(f"\n   [DATE] {date.strftime('%Y-%m-%d (%A)')}:")
                
                for meeting in date_meetings:
                    print(f"      - {meeting.start_time.strftime('%H:%M')}: {meeting.subject}")
        else:
            print(f"   [INFO] No meetings found in the week")
            
    except Exception as e:
        print(f"   [ERROR] Error fetching week meetings: {e}")
    
    # Check for test recordings that might match this date
    print(f"\n5. Checking for recordings that might match this date...")
    
    # Example filenames that would match this date
    test_filenames = [
        "REC_20250813_143000.wav",
        "REC_2025-08-13_14-30-00.wav",
        "Recording_2025_08_13_143000.wav"
    ]
    
    print("   Test filenames that would match:")
    for filename in test_filenames:
        print(f"      - {filename}")
    
    # Test finding a meeting for a recording at this time
    test_time = datetime(2025, 8, 13, 14, 30, 0)  # 2:30 PM
    print(f"\n6. Testing meeting lookup for recording at {test_time.strftime('%Y-%m-%d %H:%M')}...")
    
    try:
        meeting = calendar.find_meeting_for_recording(test_time, tolerance_minutes=30)
        if meeting:
            print(f"   [OK] Found matching meeting:")
            print(f"      Subject: {meeting.subject}")
            print(f"      Start: {meeting.start_time}")
            print(f"      Confidence: {meeting.confidence_score}")
        else:
            print(f"   [INFO] No matching meeting found within 30 minute tolerance")
    except Exception as e:
        print(f"   [ERROR] Error finding meeting: {e}")
    
    print(f"\n{'='*60}")
    print("Check complete!")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    check_calendar_for_date()