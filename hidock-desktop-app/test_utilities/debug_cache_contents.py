#!/usr/bin/env python3
"""
Debug script to examine actual cache contents
"""
import sys
import os

# Add the current directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from calendar_cache_manager import CalendarCacheManager
import os

# Initialize cache with the correct cache directory
cache_dir = os.path.join(os.path.expanduser("~"), ".hidock", "calendar_cache")
cache = CalendarCacheManager(cache_dir)

print("🔍 Examining calendar cache contents...\n")

# Get all file mappings
print("📁 File mappings in cache:")
mappings = cache.get_all_file_mappings()
print(f"Total mappings: {len(mappings)}")

# Show first 20 mappings to see the pattern
print("\nFirst 20 file mappings:")
for i, (filename, meeting_id) in enumerate(list(mappings.items())[:20]):
    print(f"  {i+1:2d}. {filename} -> {meeting_id}")

# Look for specific files that had meeting data in logs
test_files = [
    "2025May30-095945-Rec34.hda",
    "2025May13-100040-Rec52.hda", 
    "2025May13-171205-Rec60.hda",
    "2025May14-113137-Rec62.hda"
]

print(f"\n🎯 Checking specific files from logs:")
for filename in test_files:
    mapping = cache.get_file_mapping(filename)
    if mapping:
        meeting = cache.get_cached_meeting(mapping)
        print(f"  {filename} -> meeting_id: {mapping} -> '{meeting}'")
    else:
        print(f"  {filename} -> NO MAPPING")

# Let's look for any files that DO have meetings
print(f"\n✅ Files that DO have meetings (first 10):")
count = 0
for filename, meeting_id in mappings.items():
    if meeting_id:  # Has a meeting ID
        meeting = cache.get_cached_meeting(meeting_id)
        if meeting and meeting.strip() and meeting != "No meeting":
            print(f"  {filename} -> '{meeting}'")
            count += 1
            if count >= 10:
                break

if count == 0:
    print("  No files found with meeting data!")

print(f"\n📊 Cache summary:")
print(f"  Total meetings: {len(cache._meetings_cache)}")
print(f"  Total file mappings: {len(mappings)}")
print(f"  Files with actual meetings: {count}")
