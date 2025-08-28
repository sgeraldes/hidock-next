#!/usr/bin/env python3
"""
Debug script to check datetime parsing issue
"""
import sys
import os
import json
from datetime import datetime

# Add the current directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from async_calendar_mixin import AsyncCalendarMixin
from calendar_cache_manager import CalendarCacheManager

# Create test instance and cache manager
class TestCalendar(AsyncCalendarMixin):
    def __init__(self):
        pass

test_calendar = TestCalendar()

# Initialize cache
cache_dir = os.path.join(os.path.expanduser("~"), ".hidock", "calendar_cache")
cache_manager = CalendarCacheManager(cache_dir)

print("🔍 Testing datetime parsing for cached files...")

# Create test files with different datetime formats like the real GUI would have
test_files = [
    {
        "name": "2025May30-095945-Rec34.hda",
        "createDate": "2025/05/30",
        "createTime": "09:59:45",
        "time": None  # This might be the problem - no datetime object
    },
    {
        "name": "2025May13-100040-Rec52.hda", 
        "createDate": "2025/05/13",
        "createTime": "10:00:40",
        "time": None
    }
]

for file_data in test_files:
    filename = file_data['name']
    print(f"\n📁 Testing file: {filename}")
    
    # Test datetime parsing (the method from AsyncCalendarMixin)
    parsed_datetime = test_calendar._parse_file_datetime(file_data)
    print(f"  Parsed datetime: {parsed_datetime}")
    
    if parsed_datetime:
        # Test cache lookup
        cached_meeting = cache_manager.get_cached_meeting_for_file(filename, parsed_datetime)
        if cached_meeting:
            print(f"  ✅ Cache hit: '{cached_meeting.subject}' -> display: '{cached_meeting.display_text}'")
        else:
            print(f"  ❌ No cache hit")
            
        # Check if file mapping exists
        if filename in cache_manager._file_meetings_cache:
            meeting_key = cache_manager._file_meetings_cache[filename]
            print(f"  File mapping exists: {filename} -> {meeting_key}")
            
            if meeting_key in cache_manager._meetings_cache:
                meeting = cache_manager._meetings_cache[meeting_key]
                print(f"  Meeting in cache: '{meeting.subject}' (expires: {meeting.expires_at})")
                
                # Check if cache is valid
                is_valid = cache_manager._is_cache_valid(meeting, parsed_datetime)
                print(f"  Cache valid: {is_valid}")
            else:
                print(f"  ⚠️  Meeting key {meeting_key} not found in meetings cache")
        else:
            print(f"  ⚠️  No file mapping for {filename}")
    else:
        print(f"  ❌ Failed to parse datetime from file data")

print(f"\n🔧 Adding time field to test files (like real GUI has)...")

# Now test with the actual time field that the GUI provides
for file_data in test_files:
    # Add the time field based on createDate/createTime (like the GUI does)
    create_date = file_data['createDate']  # "2025/05/30"
    create_time = file_data['createTime']  # "09:59:45"
    
    # Convert to datetime object (like the GUI would)
    if create_date and create_time:
        datetime_str = f"{create_date} {create_time}"
        try:
            file_data['time'] = datetime.strptime(datetime_str, "%Y/%m/%d %H:%M:%S")
            print(f"  Added time field: {file_data['time']}")
        except ValueError as e:
            print(f"  ❌ Failed to parse datetime: {e}")

print(f"\n🔄 Re-testing with time field...")

for file_data in test_files:
    filename = file_data['name']
    print(f"\n📁 Testing file: {filename}")
    
    # Test datetime parsing again
    parsed_datetime = test_calendar._parse_file_datetime(file_data)
    print(f"  Parsed datetime: {parsed_datetime}")
    
    if parsed_datetime:
        cached_meeting = cache_manager.get_cached_meeting_for_file(filename, parsed_datetime)
        if cached_meeting:
            print(f"  ✅ Cache hit: '{cached_meeting.subject}' -> display: '{cached_meeting.display_text}'")
        else:
            print(f"  ❌ Still no cache hit")
