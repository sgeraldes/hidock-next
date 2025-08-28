#!/usr/bin/env python3
"""
Diagnose why calendar isn't finding meetings for August 13, 2025
Uses the same integration the app uses
"""

import sys
import os
from datetime import datetime, timedelta
from pathlib import Path

# Add the current directory to the path
sys.path.insert(0, str(Path(__file__).parent))

from simple_outlook_integration import SimpleOutlookIntegration
from calendar_cache_manager import CalendarCacheManager
from config_and_logger import logger

def diagnose_calendar():
    """Diagnose calendar issues for specific date."""
    
    target_date = datetime(2025, 8, 13, 14, 30, 0)  # Aug 13, 2025 at 2:30 PM
    
    print("\n" + "="*80)
    print(f"CALENDAR DIAGNOSIS FOR: {target_date.strftime('%Y/%m/%d %H:%M (%A)')}")
    print("="*80 + "\n")
    
    # 1. Check calendar integration
    print("1. Testing Calendar Integration...")
    calendar = SimpleOutlookIntegration()
    
    print(f"   Available: {calendar.is_available()}")
    print(f"   Methods: {calendar.available_methods}")
    print(f"   Last error: {calendar.last_error}")
    
    if not calendar.is_available():
        print("\n[ERROR] Calendar not available. Checking why...")
        
        # Check if win32com is available
        try:
            import win32com.client
            print("   [OK] win32com module is installed")
        except ImportError:
            print("   [X] win32com module NOT installed - this is the problem!")
            print("   To fix: pip install pywin32")
            return
            
        # Check if Outlook can be accessed
        try:
            import pythoncom
            pythoncom.CoInitialize()
            outlook = win32com.client.Dispatch("Outlook.Application")
            print("   [OK] Can connect to Outlook")
            pythoncom.CoUninitialize()
        except Exception as e:
            print(f"   [X] Cannot connect to Outlook: {e}")
            print("   Make sure Outlook is running")
            return
    
    # 2. Test different date queries
    print("\n2. Testing Date Queries...")
    
    # Test A: Exact date
    print(f"\n   A. Meetings for exact date {target_date.date()}:")
    meetings_on_date = calendar.get_meetings_for_date(target_date)
    print(f"      Found: {len(meetings_on_date)} meetings")
    for m in meetings_on_date[:3]:
        print(f"      - {m.start_time.strftime('%H:%M')}: {m.subject}")
    
    # Test B: Date range (week)
    week_start = target_date - timedelta(days=target_date.weekday())
    week_end = week_start + timedelta(days=6)
    print(f"\n   B. Meetings for week {week_start.date()} to {week_end.date()}:")
    meetings_in_week = calendar.get_meetings_for_date_range(week_start, week_end)
    print(f"      Found: {len(meetings_in_week)} meetings")
    
    # Group by date
    by_date = {}
    for m in meetings_in_week:
        date_key = m.start_time.date()
        if date_key not in by_date:
            by_date[date_key] = []
        by_date[date_key].append(m)
    
    for date in sorted(by_date.keys()):
        marker = " <-- TARGET" if date == target_date.date() else ""
        print(f"      {date}: {len(by_date[date])} meetings{marker}")
    
    # Test C: Finding meeting for recording time
    print(f"\n   C. Finding meeting for recording at {target_date.strftime('%H:%M')}:")
    
    for tolerance in [10, 20, 30, 60]:
        meeting = calendar.find_meeting_for_recording(target_date, tolerance_minutes=tolerance)
        if meeting:
            print(f"      [OK] Found with {tolerance}min tolerance: {meeting.subject}")
            print(f"           Meeting time: {meeting.start_time.strftime('%H:%M')} - {meeting.end_time.strftime('%H:%M')}")
            print(f"           Confidence: {meeting.confidence_score}")
            break
        else:
            print(f"      [X] No match with {tolerance}min tolerance")
    
    # 3. Check cache
    print("\n3. Checking Calendar Cache...")
    cache_path = os.path.join(os.path.expanduser("~"), ".hidock", "calendar_cache.db")
    
    if os.path.exists(cache_path):
        print(f"   Cache exists at: {cache_path}")
        cache_manager = CalendarCacheManager(cache_path)
        
        # Check if this date is cached
        test_filename = f"REC_{target_date.strftime('%Y%m%d_%H%M%S')}.wav"
        cached = cache_manager.get_cached_meeting_for_file(test_filename, target_date)
        
        if cached:
            print(f"   [OK] Found cached meeting: {cached.subject}")
        else:
            print(f"   [X] No cached meeting for this date/time")
            
        # Check cache statistics
        stats = cache_manager.get_cache_statistics()
        print(f"\n   Cache Statistics:")
        print(f"      Total cached meetings: {stats.get('total_meetings', 0)}")
        print(f"      Total file mappings: {stats.get('total_file_mappings', 0)}")
        print(f"      Cache size: {stats.get('cache_size_kb', 0):.1f} KB")
    else:
        print(f"   [X] No cache exists yet")
    
    # 4. Test with sample filenames
    print("\n4. Testing Sample Filenames...")
    
    test_files = [
        {"name": f"REC_{target_date.strftime('%Y%m%d_%H%M%S')}.wav", 
         "time": target_date},
        {"name": f"REC_{target_date.strftime('%Y%m%d')}_{target_date.strftime('%H%M%S')}.wav",
         "time": target_date},
        {"name": f"Recording_2025_08_13_143000.wav",
         "time": target_date}
    ]
    
    for file_data in test_files:
        print(f"\n   Testing: {file_data['name']}")
        
        # Simulate what the app does
        file_datetime = file_data['time']
        meeting = calendar.find_meeting_for_recording(file_datetime, tolerance_minutes=30)
        
        if meeting:
            print(f"      [OK] Would match: {meeting.subject}")
            print(f"           Start: {meeting.start_time}")
            print(f"           Confidence: {meeting.confidence_score}")
        else:
            print(f"      [X] No meeting match")
    
    # 5. Debug the date parsing/filtering
    print("\n5. Debugging Date Filtering...")
    
    # Check what the app would do for chunking
    from async_calendar_mixin import AsyncCalendarMixin
    
    # Create a mock object with the method we need
    class MockMixin:
        def _get_calendar_chunk_start_date(self, file_date, chunking_period):
            """Get the start date of the chunk this file belongs to."""
            if chunking_period.days == 1:
                # Daily chunks - start of day
                return file_date.replace(hour=0, minute=0, second=0, microsecond=0)
            elif chunking_period.days == 7:
                # Weekly chunks - start of week (Monday)
                days_since_monday = file_date.weekday()
                return file_date - timedelta(days=days_since_monday)
            elif chunking_period.days == 14:
                # 2-week chunks
                epoch = datetime(1970, 1, 5)  # A Monday
                days_since_epoch = (file_date - epoch).days
                chunk_number = days_since_epoch // 14
                return epoch + timedelta(days=chunk_number * 14)
            elif chunking_period.days == 30:
                # Monthly chunks
                return file_date.replace(day=1)
            else:
                # Default to weekly
                days_since_monday = file_date.weekday()
                return file_date - timedelta(days=days_since_monday)
    
    mock = MockMixin()
    
    # Test different chunking periods
    periods = [
        timedelta(days=1),   # Daily
        timedelta(days=7),   # Weekly
        timedelta(days=14),  # Bi-weekly
        timedelta(days=30),  # Monthly
    ]
    
    print(f"   File date: {target_date}")
    for period in periods:
        chunk_start = mock._get_calendar_chunk_start_date(target_date, period)
        chunk_end = chunk_start + period - timedelta(seconds=1)
        print(f"\n   {period.days}-day chunks:")
        print(f"      Chunk: {chunk_start.date()} to {chunk_end.date()}")
        
        # Check if there are meetings in this chunk
        meetings = calendar.get_meetings_for_date_range(chunk_start, chunk_end)
        print(f"      Meetings in chunk: {len(meetings)}")
        
        # Check if target date has meetings
        target_meetings = [m for m in meetings if m.start_time.date() == target_date.date()]
        print(f"      Meetings on target date: {len(target_meetings)}")
    
    print("\n" + "="*80)
    print("DIAGNOSIS COMPLETE")
    print("="*80 + "\n")

if __name__ == "__main__":
    diagnose_calendar()