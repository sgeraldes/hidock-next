#!/usr/bin/env python3
"""
Test different date formats for Outlook filtering
"""

import sys
import os
from datetime import datetime, timedelta
from pathlib import Path

# Add the current directory to the path
sys.path.insert(0, str(Path(__file__).parent))

def test_outlook_date_formats():
    """Test which date format works for Outlook filters."""
    
    try:
        import win32com.client
        import pythoncom
    except ImportError:
        print("win32com not available")
        return
    
    print("\n" + "="*80)
    print("TESTING OUTLOOK DATE FILTER FORMATS")
    print("="*80 + "\n")
    
    # Initialize COM
    pythoncom.CoInitialize()
    
    try:
        # Connect to Outlook
        outlook = win32com.client.Dispatch("Outlook.Application")
        namespace = outlook.GetNamespace("MAPI")
        calendar = namespace.GetDefaultFolder(9)  # olFolderCalendar
        
        # Test date: Aug 13, 2025 (week from Aug 11 to Aug 17)
        week_start = datetime(2025, 8, 11, 0, 0, 0)
        week_end = datetime(2025, 8, 17, 23, 59, 59)
        
        print(f"Testing week: {week_start.date()} to {week_end.date()}\n")
        
        # Different date formats to test
        test_formats = [
            # Format 1: MM/DD/YYYY HH:MM
            {
                'name': 'US Format (MM/DD/YYYY HH:MM)',
                'start': week_start.strftime('%m/%d/%Y %H:%M'),
                'end': week_end.strftime('%m/%d/%Y %H:%M')
            },
            # Format 2: MM/DD/YYYY HH:MM AM/PM
            {
                'name': 'US Format with AM/PM',
                'start': week_start.strftime('%m/%d/%Y %I:%M %p'),
                'end': week_end.strftime('%m/%d/%Y %I:%M %p')
            },
            # Format 3: YYYY-MM-DD HH:MM
            {
                'name': 'ISO Format',
                'start': week_start.strftime('%Y-%m-%d %H:%M'),
                'end': week_end.strftime('%Y-%m-%d %H:%M')
            },
            # Format 4: MM/DD/YYYY only
            {
                'name': 'Date only (US)',
                'start': week_start.strftime('%m/%d/%Y'),
                'end': week_end.strftime('%m/%d/%Y')
            },
            # Format 5: Using single quotes
            {
                'name': 'Single quotes with time',
                'start': week_start.strftime("'%m/%d/%Y %H:%M'"),
                'end': week_end.strftime("'%m/%d/%Y %H:%M'")
            },
            # Format 6: Using double quotes  
            {
                'name': 'Double quotes',
                'start': f'"{week_start.strftime("%m/%d/%Y %H:%M")}"',
                'end': f'"{week_end.strftime("%m/%d/%Y %H:%M")}"'
            }
        ]
        
        for fmt in test_formats:
            print(f"Testing: {fmt['name']}")
            print(f"  Start: {fmt['start']}")
            print(f"  End: {fmt['end']}")
            
            try:
                # Build filter string
                filter_string = f"[Start] >= '{fmt['start']}' AND [Start] <= '{fmt['end']}'"
                print(f"  Filter: {filter_string}")
                
                # Get items
                items = calendar.Items
                items.Sort("[Start]")
                items.IncludeRecurrences = True
                
                # Apply filter
                filtered = items.Restrict(filter_string)
                count = filtered.Count
                
                print(f"  RESULT: Found {count} meetings")
                
                # Show first few meetings if any found
                if count > 0:
                    shown = 0
                    for item in filtered:
                        if shown >= 3:
                            break
                        try:
                            print(f"    - {item.Start}: {item.Subject}")
                            shown += 1
                        except:
                            pass
                
            except Exception as e:
                print(f"  ERROR: {e}")
            
            print()
        
        # Now test specifically what's happening with the date comparison
        print("\n" + "="*40)
        print("DEBUGGING DATE COMPARISON")
        print("="*40 + "\n")
        
        # Get ALL meetings and check their dates
        print("Getting all meetings to check date parsing...")
        items = calendar.Items
        items.Sort("[Start]")
        items.IncludeRecurrences = True
        
        # Use a very broad filter to get many items
        broad_start = datetime(2025, 1, 1)
        broad_end = datetime(2025, 12, 31)
        broad_filter = f"[Start] >= '{broad_start.strftime('%m/%d/%Y')}' AND [Start] <= '{broad_end.strftime('%m/%d/%Y')}'"
        
        all_items = items.Restrict(broad_filter)
        print(f"Found {all_items.Count} meetings in all of 2025")
        
        # Check meetings in August 2025
        august_meetings = []
        for item in all_items:
            try:
                if item.Start.month == 8 and item.Start.year == 2025:
                    august_meetings.append({
                        'date': item.Start,
                        'subject': item.Subject
                    })
            except:
                pass
        
        print(f"\nFound {len(august_meetings)} meetings in August 2025")
        
        # Group by week
        week_of_13th = []
        for meeting in august_meetings:
            if week_start <= meeting['date'] <= week_end:
                week_of_13th.append(meeting)
        
        print(f"Meetings in week of Aug 13: {len(week_of_13th)}")
        if week_of_13th:
            print("\nMeetings in target week:")
            for m in week_of_13th[:10]:
                print(f"  {m['date']}: {m['subject']}")
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        pythoncom.CoUninitialize()
    
    print("\n" + "="*80)
    print("TEST COMPLETE")
    print("="*80 + "\n")

if __name__ == "__main__":
    test_outlook_date_formats()