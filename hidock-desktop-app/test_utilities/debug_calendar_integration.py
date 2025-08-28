#!/usr/bin/env python3
"""
Debug Calendar Integration
Test script to diagnose calendar integration issues
"""

import sys
from datetime import datetime, timedelta
from simple_outlook_integration import create_simple_outlook_integration

def test_calendar_integration():
    """Test and debug calendar integration"""
    print("=" * 60)
    print("DEBUGGING HIDOCK CALENDAR INTEGRATION")
    print("=" * 60)
    
    # Create integration instance
    print("\n1. Creating integration instance...")
    integration = create_simple_outlook_integration()
    
    # Check availability
    print(f"\n2. Integration available: {integration.is_available()}")
    print(f"   Available methods: {integration.available_methods}")
    print(f"   Last error: {integration.last_error}")
    
    if not integration.is_available():
        print("\n❌ ISSUE FOUND: Calendar integration not available!")
        print(f"   Error: {integration.last_error}")
        return False
    
    # Test for May 15, 2025 (the date with the selected files)
    print("\n3. Testing calendar access for May 15, 2025...")
    test_date = datetime(2025, 5, 15)
    
    try:
        meetings = integration.get_meetings_for_date(test_date)
        print(f"   Found {len(meetings)} meetings for {test_date.date()}")
        
        if meetings:
            print("\n   Meetings found:")
            for i, meeting in enumerate(meetings):
                print(f"   {i+1}. {meeting.subject}")
                print(f"      Time: {meeting.start_time.strftime('%H:%M')} - {meeting.end_time.strftime('%H:%M')}")
                print(f"      Organizer: {meeting.organizer}")
                print()
        else:
            print("   ❌ NO MEETINGS FOUND for May 15, 2025")
            print("   This could explain why files show 'No meeting'")
            
    except Exception as e:
        print(f"   ❌ ERROR accessing calendar: {e}")
        return False
    
    # Test matching logic for the specific files
    print("\n4. Testing meeting matching for selected audio files...")
    file_times = [
        datetime(2025, 5, 15, 18, 14, 35),  # 2025May15-181435-Rec75.hda
        datetime(2025, 5, 15, 17, 34, 11),  # 2025May15-173411-Rec74.hda
        datetime(2025, 5, 15, 17, 8, 35),   # 2025May15-170835-Rec73.hda
        datetime(2025, 5, 15, 16, 2, 30),   # 2025May15-160230-Rec72.hda
        datetime(2025, 5, 15, 15, 30, 30),  # 2025May15-153030-Rec71.hda
        datetime(2025, 5, 15, 14, 7, 10),   # 2025May15-140710-Rec70.hda
        datetime(2025, 5, 15, 12, 34, 41),  # 2025May15-123441-Rec69.hda
        datetime(2025, 5, 15, 12, 0, 55),   # 2025May15-120055-Rec68.hda
        datetime(2025, 5, 15, 11, 8, 1),    # 2025May15-110801-Rec67.hda
    ]
    
    matches_found = 0
    for file_time in file_times:
        meeting = integration.find_meeting_for_recording(file_time, tolerance_minutes=20)
        if meeting:
            print(f"   ✅ {file_time.strftime('%H:%M')} -> {meeting.subject}")
            matches_found += 1
        else:
            print(f"   ❌ {file_time.strftime('%H:%M')} -> No meeting found")
    
    print(f"\n   Summary: {matches_found}/{len(file_times)} files matched with meetings")
    
    if matches_found == 0:
        print("\n   ❌ ISSUE FOUND: No meetings matched!")
        print("   This explains why calendar integration shows 'found 0 with meetings'")
        
        # Check if the problem is with tolerance or date mismatch
        print("\n5. Debugging potential issues...")
        if meetings:
            print("   Available meetings that day:")
            for meeting in meetings:
                print(f"   - {meeting.subject}: {meeting.start_time.strftime('%H:%M')} - {meeting.end_time.strftime('%H:%M')}")
            
            print("\n   Checking if tolerance is too strict...")
            for file_time in file_times[:3]:  # Check first 3 files
                for meeting in meetings:
                    diff_minutes = abs((file_time - meeting.start_time).total_seconds() / 60)
                    print(f"   File {file_time.strftime('%H:%M')} vs Meeting {meeting.start_time.strftime('%H:%M')}: {diff_minutes:.1f} min difference")
    
    return matches_found > 0

def main():
    success = test_calendar_integration()
    
    print("\n" + "=" * 60)
    if success:
        print("✅ Calendar integration is working - check cache invalidation")
    else:
        print("❌ Calendar integration has issues - needs fixing")
    print("=" * 60)

if __name__ == "__main__":
    main()
