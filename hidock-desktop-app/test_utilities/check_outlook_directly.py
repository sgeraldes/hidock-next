#!/usr/bin/env python3
"""
Script to directly check Outlook calendar for August 13, 2025
and diagnose why meetings might not be found
"""

import sys
import os
from datetime import datetime, timedelta
import win32com.client
import pythoncom

def check_outlook_calendar():
    """Directly check Outlook calendar for meetings on specific date."""
    
    target_date = datetime(2025, 8, 13)
    
    print("\n" + "="*80)
    print(f"DIRECT OUTLOOK CALENDAR CHECK FOR: {target_date.strftime('%Y/%m/%d (%A)')}")
    print("="*80 + "\n")
    
    try:
        # Initialize COM for this thread
        pythoncom.CoInitialize()
        
        # Connect to Outlook
        print("1. Connecting to Outlook...")
        outlook = win32com.client.Dispatch("Outlook.Application")
        namespace = outlook.GetNamespace("MAPI")
        
        # Get calendar folder
        calendar_folder = namespace.GetDefaultFolder(9)  # 9 = olFolderCalendar
        print(f"   [OK] Connected to Outlook")
        print(f"   Calendar: {calendar_folder.Name}")
        print(f"   Total items in calendar: {calendar_folder.Items.Count}")
        
        # Get calendar items
        items = calendar_folder.Items
        items.Sort("[Start]")
        items.IncludeRecurrences = True  # Important for recurring meetings!
        
        # Method 1: Filter for specific date
        print(f"\n2. METHOD 1: Filtering for {target_date.strftime('%Y-%m-%d')}...")
        
        # Create filter for the specific day
        start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        
        # Format dates for Outlook filter (MM/DD/YYYY HH:MM AM/PM format)
        start_str = start_of_day.strftime("%m/%d/%Y %I:%M %p")
        end_str = end_of_day.strftime("%m/%d/%Y %I:%M %p")
        
        print(f"   Filter range: {start_str} to {end_str}")
        
        # Create restriction filter
        filter_str = f"[Start] >= '{start_str}' AND [Start] < '{end_str}'"
        print(f"   Filter string: {filter_str}")
        
        filtered_items = items.Restrict(filter_str)
        count = filtered_items.Count
        
        print(f"   [RESULT] Found {count} meetings on {target_date.strftime('%Y-%m-%d')}")
        
        if count > 0:
            print("\n   Meetings found:")
            for i in range(1, min(count + 1, 20)):  # Show up to 20
                try:
                    item = filtered_items.Item(i)
                    print(f"\n   Meeting {i}:")
                    print(f"      Subject: {item.Subject}")
                    print(f"      Start: {item.Start}")
                    print(f"      End: {item.End}")
                    print(f"      Organizer: {item.Organizer}")
                    print(f"      Location: {getattr(item, 'Location', 'No location')}")
                    print(f"      Is Recurring: {item.IsRecurring}")
                    
                    # Check attendees
                    try:
                        attendees = item.Recipients
                        print(f"      Attendees: {attendees.Count}")
                    except:
                        print(f"      Attendees: Unable to access")
                        
                except Exception as e:
                    print(f"   Error reading meeting {i}: {e}")
        
        # Method 2: Check week range (like the app does)
        print(f"\n3. METHOD 2: Checking week containing {target_date.strftime('%Y-%m-%d')}...")
        
        # Calculate week range (Monday to Sunday)
        days_since_monday = target_date.weekday()
        week_start = target_date - timedelta(days=days_since_monday)
        week_end = week_start + timedelta(days=6, hours=23, minutes=59, seconds=59)
        
        week_start_str = week_start.strftime("%m/%d/%Y %I:%M %p")
        week_end_str = week_end.strftime("%m/%d/%Y %I:%M %p")
        
        print(f"   Week range: {week_start.strftime('%Y-%m-%d')} to {week_end.strftime('%Y-%m-%d')}")
        print(f"   Filter: {week_start_str} to {week_end_str}")
        
        week_filter = f"[Start] >= '{week_start_str}' AND [Start] <= '{week_end_str}'"
        week_items = items.Restrict(week_filter)
        week_count = week_items.Count
        
        print(f"   [RESULT] Found {week_count} meetings in the week")
        
        # Group by date
        meetings_by_date = {}
        for i in range(1, min(week_count + 1, 100)):  # Process up to 100
            try:
                item = week_items.Item(i)
                meeting_date = item.Start.date()
                
                if meeting_date not in meetings_by_date:
                    meetings_by_date[meeting_date] = []
                    
                meetings_by_date[meeting_date].append({
                    'time': item.Start.strftime('%H:%M'),
                    'subject': item.Subject,
                    'recurring': item.IsRecurring
                })
            except Exception as e:
                print(f"   Error processing meeting: {e}")
        
        # Show summary by date
        print("\n   Meetings by date in the week:")
        for date in sorted(meetings_by_date.keys()):
            date_meetings = meetings_by_date[date]
            marker = " *** TARGET DATE ***" if date == target_date.date() else ""
            print(f"\n      {date.strftime('%Y-%m-%d (%a)')}: {len(date_meetings)} meetings{marker}")
            for meeting in date_meetings[:5]:  # Show first 5
                recurring = " [R]" if meeting['recurring'] else ""
                print(f"         {meeting['time']}: {meeting['subject']}{recurring}")
        
        # Method 3: Direct iteration to find meetings (broader search)
        print(f"\n4. METHOD 3: Direct search in 2-week range around {target_date.strftime('%Y-%m-%d')}...")
        
        search_start = target_date - timedelta(days=7)
        search_end = target_date + timedelta(days=7)
        
        search_filter = f"[Start] >= '{search_start.strftime('%m/%d/%Y')}' AND [Start] <= '{search_end.strftime('%m/%d/%Y')}'"
        search_items = items.Restrict(search_filter)
        
        print(f"   Search range: {search_start.strftime('%Y-%m-%d')} to {search_end.strftime('%Y-%m-%d')}")
        print(f"   [RESULT] Found {search_items.Count} meetings in 2-week range")
        
        # Check for different date formats that might be causing issues
        print("\n5. DIAGNOSTIC: Checking date format handling...")
        
        test_formats = [
            "%m/%d/%Y",           # 08/13/2025
            "%Y-%m-%d",           # 2025-08-13
            "%d/%m/%Y",           # 13/08/2025
            "%Y/%m/%d",           # 2025/08/13
        ]
        
        for fmt in test_formats:
            try:
                test_date_str = target_date.strftime(fmt)
                print(f"   Testing format: {fmt} -> {test_date_str}")
                
                # Try to create a filter with this format
                if fmt == "%m/%d/%Y":
                    test_filter = f"[Start] >= '{test_date_str} 12:00 AM' AND [Start] < '{test_date_str} 11:59 PM'"
                    test_items = items.Restrict(test_filter)
                    print(f"      Filter works: {test_items.Count} items found")
            except Exception as e:
                print(f"      Format failed: {e}")
        
        # Check if there are any recurring meetings that might span this date
        print("\n6. RECURRING MEETINGS CHECK...")
        
        # Get all recurring meetings in a broader range
        year_start = datetime(2025, 1, 1)
        year_end = datetime(2025, 12, 31)
        year_filter = f"[Start] >= '{year_start.strftime('%m/%d/%Y')}' AND [Start] <= '{year_end.strftime('%m/%d/%Y')}'"
        year_items = items.Restrict(year_filter)
        
        recurring_count = 0
        for i in range(1, min(year_items.Count + 1, 500)):
            try:
                item = year_items.Item(i)
                if item.IsRecurring:
                    recurring_count += 1
                    
                    # Check if this recurring meeting occurs on our target date
                    pattern = item.GetRecurrencePattern()
                    occurrences = []
                    
                    # Check if target date falls within recurrence
                    try:
                        occurrence = pattern.GetOccurrence(target_date)
                        print(f"\n   [RECURRING] Found recurring meeting on target date:")
                        print(f"      Subject: {item.Subject}")
                        print(f"      Pattern: {pattern.RecurrenceType}")
                        print(f"      Original Start: {item.Start}")
                    except:
                        pass  # Not on target date
                        
            except Exception as e:
                pass
        
        print(f"\n   Total recurring meetings in 2025: {recurring_count}")
        
    except pythoncom.com_error as e:
        print(f"\n[ERROR] COM Error: {e}")
        print("   This usually means Outlook is not running or not accessible")
        print("   Make sure Outlook is running and try again")
    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Uninitialize COM
        pythoncom.CoUninitialize()
    
    print("\n" + "="*80)
    print("DIAGNOSTIC COMPLETE")
    print("="*80 + "\n")

if __name__ == "__main__":
    check_outlook_calendar()