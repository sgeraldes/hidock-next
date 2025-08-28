#!/usr/bin/env python3
"""
Simple debug script to examine cache contents directly
"""
import sys
import os
import json

# Look at cache files directly
cache_dir = os.path.join(os.path.expanduser("~"), ".hidock", "calendar_cache")
meetings_file = os.path.join(cache_dir, "meetings_cache.json")
file_mappings_file = os.path.join(cache_dir, "file_meetings_cache.json")

print(f"🔍 Looking at cache files in: {cache_dir}")
print(f"Meetings cache file: {meetings_file}")
print(f"File mappings file: {file_mappings_file}")
print()

# Check if files exist
if not os.path.exists(meetings_file):
    print("❌ Meetings cache file not found!")
else:
    print("✅ Meetings cache file found")
    
if not os.path.exists(file_mappings_file):
    print("❌ File mappings cache file not found!")
else:
    print("✅ File mappings cache file found")
    
print()

# Load and examine file mappings
if os.path.exists(file_mappings_file):
    try:
        with open(file_mappings_file, 'r', encoding='utf-8') as f:
            file_mappings = json.load(f)
            
        print(f"📁 File mappings count: {len(file_mappings)}")
        
        # Show first 20 mappings
        print("\nFirst 20 file mappings:")
        for i, (filename, meeting_key) in enumerate(list(file_mappings.items())[:20]):
            print(f"  {i+1:2d}. {filename} -> {meeting_key}")
            
        # Look for files with actual meeting keys (not NO_MEETING)
        meeting_files = [(f, k) for f, k in file_mappings.items() if not k.startswith("NO_MEETING_")]
        print(f"\nFiles with meeting keys: {len(meeting_files)}")
        
        if meeting_files:
            print("\nFirst 10 files with meeting keys:")
            for i, (filename, meeting_key) in enumerate(meeting_files[:10]):
                print(f"  {i+1:2d}. {filename} -> {meeting_key}")
        
    except Exception as e:
        print(f"❌ Error loading file mappings: {e}")

print()

# Load and examine meetings cache
if os.path.exists(meetings_file):
    try:
        with open(meetings_file, 'r', encoding='utf-8') as f:
            meetings = json.load(f)
            
        print(f"📅 Meetings count: {len(meetings)}")
        
        # Look for meetings with actual subjects (not empty)
        real_meetings = [(k, v) for k, v in meetings.items() 
                        if v.get('subject', '').strip() and v.get('display_text', '').strip()]
        
        print(f"Real meetings with subjects: {len(real_meetings)}")
        
        if real_meetings:
            print("\nFirst 10 real meetings:")
            for i, (meeting_key, meeting_data) in enumerate(real_meetings[:10]):
                subject = meeting_data.get('subject', 'NO SUBJECT')
                display_text = meeting_data.get('display_text', 'NO DISPLAY TEXT')
                print(f"  {i+1:2d}. {meeting_key}: '{subject}' (display: '{display_text}')")
                
    except Exception as e:
        print(f"❌ Error loading meetings: {e}")
