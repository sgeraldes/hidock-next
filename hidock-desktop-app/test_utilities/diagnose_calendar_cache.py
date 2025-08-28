#!/usr/bin/env python3
"""
Diagnostic script to analyze calendar cache behavior and identify issues.
"""

import json
import os
from datetime import datetime
from pathlib import Path

def analyze_cache():
    """Analyze the calendar cache to understand the issues."""
    print("🔍 CALENDAR CACHE DIAGNOSTIC")
    print("=" * 60)
    
    cache_dir = Path.home() / ".hidock" / "calendar_cache"
    meetings_file = cache_dir / "meetings_cache.json"
    file_mappings_file = cache_dir / "file_meetings_cache.json"
    
    if not cache_dir.exists():
        print("❌ Cache directory does not exist!")
        return
    
    print(f"📁 Cache directory: {cache_dir}")
    print(f"📄 Meetings file: {meetings_file} ({'exists' if meetings_file.exists() else 'missing'})")
    print(f"📄 File mappings: {file_mappings_file} ({'exists' if file_mappings_file.exists() else 'missing'})")
    
    if not meetings_file.exists() or not file_mappings_file.exists():
        print("❌ Cache files missing!")
        return
    
    # Load and analyze cache data
    try:
        # Load file mappings
        with open(file_mappings_file, 'r') as f:
            file_mappings = json.load(f)
        
        # Load meetings
        with open(meetings_file, 'r') as f:
            meetings = json.load(f)
        
        print(f"\n📊 CACHE STATISTICS:")
        print(f"  Total file mappings: {len(file_mappings)}")
        print(f"  Total meetings cached: {len(meetings)}")
        
        # Analyze meeting types
        real_meetings = 0
        no_meeting_entries = 0
        expired_entries = 0
        
        now = datetime.now()
        
        for meeting_key, meeting_data in meetings.items():
            if meeting_key.startswith("NO_MEETING_"):
                no_meeting_entries += 1
            else:
                if meeting_data.get('subject'):
                    real_meetings += 1
                else:
                    no_meeting_entries += 1
            
            # Check expiration
            try:
                expires_at = datetime.fromisoformat(meeting_data.get('expires_at', ''))
                if now > expires_at:
                    expired_entries += 1
            except:
                pass
        
        print(f"  Real meetings: {real_meetings}")
        print(f"  'No meeting' entries: {no_meeting_entries}")
        print(f"  Expired entries: {expired_entries}")
        
        # Sample real meetings
        print(f"\n📋 SAMPLE REAL MEETINGS:")
        count = 0
        for meeting_key, meeting_data in meetings.items():
            if meeting_data.get('subject') and count < 5:
                subject = meeting_data['subject']
                organizer = meeting_data.get('organizer', '')
                display_text = meeting_data.get('display_text', '')
                print(f"  {count+1}. {subject[:50]}{'...' if len(subject) > 50 else ''}")
                print(f"     Organizer: {organizer}")
                print(f"     Display: '{display_text}'")
                count += 1
        
        # Sample file mappings
        print(f"\n📋 SAMPLE FILE MAPPINGS:")
        count = 0
        for filename, meeting_key in file_mappings.items():
            if count < 10:
                meeting_data = meetings.get(meeting_key, {})
                subject = meeting_data.get('subject', '')
                display_text = meeting_data.get('display_text', '')
                
                if subject:
                    status = f"HAS MEETING: {subject[:30]}{'...' if len(subject) > 30 else ''}"
                elif meeting_key.startswith("NO_MEETING_"):
                    status = f"NO MEETING (cached)"
                else:
                    status = "UNKNOWN"
                
                print(f"  {filename} -> {status}")
                print(f"     Display text: '{display_text}'")
                count += 1
        
        # Check for specific patterns
        print(f"\n🔍 ISSUE ANALYSIS:")
        
        # Check if display_text is "No Meeting" for no-meeting entries
        no_meeting_with_text = 0
        for meeting_key, meeting_data in meetings.items():
            if (not meeting_data.get('subject') and 
                meeting_data.get('display_text') == 'No Meeting'):
                no_meeting_with_text += 1
        
        print(f"  Entries with 'No Meeting' display text: {no_meeting_with_text}")
        
        # Check if real meetings have proper display text
        real_meetings_no_display = 0
        for meeting_key, meeting_data in meetings.items():
            if (meeting_data.get('subject') and 
                not meeting_data.get('display_text')):
                real_meetings_no_display += 1
        
        print(f"  Real meetings with empty display text: {real_meetings_no_display}")
        
        # Recommendations
        print(f"\n💡 RECOMMENDATIONS:")
        if no_meeting_with_text > 0:
            print(f"  ⚠️ {no_meeting_with_text} entries have 'No Meeting' display text - should be empty")
        if real_meetings_no_display > 0:
            print(f"  ⚠️ {real_meetings_no_display} real meetings have empty display text - should be populated")
        
        if no_meeting_with_text == 0:
            print("  ✅ Display text handling looks correct")
        
    except Exception as e:
        print(f"❌ Error analyzing cache: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    analyze_cache()
