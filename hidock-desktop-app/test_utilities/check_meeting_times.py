#!/usr/bin/env python3
"""
Check exact meeting times on August 13, 2025
"""

import sys
from datetime import datetime
from pathlib import Path

# Add the current directory to the path
sys.path.insert(0, str(Path(__file__).parent))

from simple_outlook_integration import SimpleOutlookIntegration

def check_meeting_times():
    """Check specific meeting times on August 13, 2025."""
    
    target_date = datetime(2025, 8, 13)
    recording_time = datetime(2025, 8, 13, 14, 30, 0)  # 2:30 PM
    
    print(f"\nChecking meeting times on {target_date.strftime('%Y-%m-%d')}")
    print(f"Recording time: {recording_time.strftime('%H:%M')}")
    print("="*60)
    
    calendar = SimpleOutlookIntegration()
    
    if not calendar.is_available():
        print("Calendar not available")
        return
    
    # Get all meetings for the day
    meetings = calendar.get_meetings_for_date(target_date)
    
    if not meetings:
        print("No meetings found for this date")
        return
    
    print(f"\nFound {len(meetings)} meetings on {target_date.strftime('%Y-%m-%d')}:")
    print()
    
    # Sort by time
    meetings.sort(key=lambda m: m.start_time)
    
    for i, meeting in enumerate(meetings, 1):
        start_time = meeting.start_time
        end_time = meeting.end_time
        
        print(f"{i:2d}. {start_time.strftime('%H:%M')} - {end_time.strftime('%H:%M')}: {meeting.subject}")
        
        # Check if recording time (14:30) falls within this meeting
        if start_time <= recording_time <= end_time:
            print(f"    *** RECORDING TIME {recording_time.strftime('%H:%M')} FALLS WITHIN THIS MEETING ***")
        
        # Check tolerance windows around the recording time
        tolerances = [10, 20, 30, 60]
        for tolerance in tolerances:
            from datetime import timedelta
            
            # Check if meeting starts within tolerance of recording time
            time_diff = abs((start_time - recording_time).total_seconds() / 60)
            if time_diff <= tolerance:
                print(f"    -> Within {tolerance}min of recording time (diff: {time_diff:.1f}min)")
                break
    
    print("\n" + "="*60)
    
    # Now test the find_meeting_for_recording function specifically
    print(f"\nTesting find_meeting_for_recording at {recording_time.strftime('%H:%M')}:")
    
    for tolerance in [10, 20, 30, 60, 120]:
        meeting = calendar.find_meeting_for_recording(recording_time, tolerance_minutes=tolerance)
        if meeting:
            print(f"  {tolerance:3d}min tolerance: FOUND -> {meeting.subject}")
            print(f"                      Meeting: {meeting.start_time.strftime('%H:%M')} - {meeting.end_time.strftime('%H:%M')}")
            print(f"                      Confidence: {meeting.confidence_score}")
            break
        else:
            print(f"  {tolerance:3d}min tolerance: No match")
    
    print()

if __name__ == "__main__":
    check_meeting_times()