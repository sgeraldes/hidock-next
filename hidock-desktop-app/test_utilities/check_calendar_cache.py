#!/usr/bin/env python3
"""
Script to check calendar cache database for a specific date
"""

import sqlite3
import os
from datetime import datetime
import json

def check_calendar_cache():
    """Check calendar cache database for meetings."""
    
    print("\n" + "="*60)
    print("Calendar Cache Database Check")
    print("="*60 + "\n")
    
    # Path to calendar cache
    cache_path = os.path.join(os.path.expanduser("~"), ".hidock", "calendar_cache.db")
    
    if not os.path.exists(cache_path):
        print(f"[ERROR] Calendar cache not found at: {cache_path}")
        return
    
    print(f"[OK] Found calendar cache at: {cache_path}")
    print(f"     File size: {os.path.getsize(cache_path):,} bytes")
    
    # Connect to database
    conn = sqlite3.connect(cache_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    try:
        # Check tables
        print("\n1. Database Tables:")
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        for table in tables:
            print(f"   - {table['name']}")
            
            # Count rows in each table
            cursor.execute(f"SELECT COUNT(*) as count FROM {table['name']}")
            count = cursor.fetchone()['count']
            print(f"     ({count} rows)")
        
        # Check meeting_cache table
        print("\n2. Meeting Cache Contents:")
        cursor.execute("""
            SELECT * FROM meeting_cache 
            ORDER BY start_time DESC 
            LIMIT 20
        """)
        meetings = cursor.fetchall()
        
        if meetings:
            print(f"   Found {len(meetings)} recent meetings (showing up to 20):\n")
            
            # Group by date
            meetings_by_date = {}
            for meeting in meetings:
                try:
                    start_time = datetime.fromisoformat(meeting['start_time'])
                    date_key = start_time.date()
                    
                    if date_key not in meetings_by_date:
                        meetings_by_date[date_key] = []
                    
                    meetings_by_date[date_key].append({
                        'time': start_time.strftime('%H:%M'),
                        'subject': meeting['subject'],
                        'organizer': meeting['organizer'],
                        'location': meeting['location'],
                        'attendees': meeting['attendee_count']
                    })
                except Exception as e:
                    print(f"   [WARNING] Error parsing meeting: {e}")
            
            # Display meetings by date
            for date in sorted(meetings_by_date.keys(), reverse=True):
                print(f"\n   Date: {date.strftime('%Y-%m-%d (%A)')}")
                
                # Check if this is August 13, 2025
                if date == datetime(2025, 8, 13).date():
                    print("   *** THIS IS YOUR TARGET DATE ***")
                
                for meeting in meetings_by_date[date]:
                    print(f"      {meeting['time']}: {meeting['subject']}")
                    if meeting['organizer']:
                        print(f"              Organizer: {meeting['organizer']}")
                    if meeting['location']:
                        print(f"              Location: {meeting['location']}")
                    if meeting['attendees']:
                        print(f"              Attendees: {meeting['attendees']}")
        else:
            print("   No meetings in cache")
        
        # Check specifically for August 13, 2025
        print("\n3. Checking specifically for 2025-08-13:")
        cursor.execute("""
            SELECT * FROM meeting_cache 
            WHERE DATE(start_time) = '2025-08-13'
            ORDER BY start_time
        """)
        aug_meetings = cursor.fetchall()
        
        if aug_meetings:
            print(f"   [OK] Found {len(aug_meetings)} meeting(s) on 2025-08-13:\n")
            for meeting in aug_meetings:
                start_time = datetime.fromisoformat(meeting['start_time'])
                end_time = datetime.fromisoformat(meeting['end_time']) if meeting['end_time'] else None
                
                print(f"   Meeting: {meeting['subject']}")
                print(f"      Start: {start_time}")
                if end_time:
                    print(f"      End: {end_time}")
                print(f"      ID: {meeting['meeting_id']}")
                print(f"      Cached at: {meeting['cached_at']}")
                print()
        else:
            print("   [INFO] No meetings found for 2025-08-13")
        
        # Check file_meeting_cache
        print("\n4. File-Meeting Cache Entries:")
        cursor.execute("""
            SELECT * FROM file_meeting_cache
            WHERE meeting_data LIKE '%2025-08-13%' OR meeting_data LIKE '%2025/08/13%'
            LIMIT 10
        """)
        file_meetings = cursor.fetchall()
        
        if file_meetings:
            print(f"   Found {len(file_meetings)} file-meeting cache entries mentioning this date:")
            for fm in file_meetings:
                print(f"      File: {fm['filename']}")
                # Parse meeting data
                try:
                    meeting_data = json.loads(fm['meeting_data'])
                    if 'subject' in meeting_data:
                        print(f"         Meeting: {meeting_data.get('subject', 'No subject')}")
                except:
                    pass
        else:
            print("   No file-meeting cache entries for this date")
        
        # Show date range of cached meetings
        print("\n5. Date Range of Cached Meetings:")
        cursor.execute("""
            SELECT 
                MIN(DATE(start_time)) as earliest,
                MAX(DATE(start_time)) as latest,
                COUNT(*) as total
            FROM meeting_cache
            WHERE start_time IS NOT NULL
        """)
        range_info = cursor.fetchone()
        
        if range_info and range_info['earliest']:
            print(f"   Earliest meeting: {range_info['earliest']}")
            print(f"   Latest meeting: {range_info['latest']}")
            print(f"   Total meetings: {range_info['total']}")
        else:
            print("   No dated meetings in cache")
            
    except Exception as e:
        print(f"\n[ERROR] Database error: {e}")
    finally:
        conn.close()
    
    print("\n" + "="*60)
    print("Cache check complete!")
    print("="*60 + "\n")

if __name__ == "__main__":
    check_calendar_cache()