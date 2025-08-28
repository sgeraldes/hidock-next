#!/usr/bin/env python3
"""
Test the full sync enhancement process with realistic file data
"""
import sys
import os
from datetime import datetime

# Add the current directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from async_calendar_mixin import AsyncCalendarMixin

# Create test class
class TestGUI(AsyncCalendarMixin):
    def __init__(self):
        pass
    
    def after(self, delay, callback, *args):
        # Dummy implementation of tkinter's after method
        callback(*args)

test_gui = TestGUI()

print("🔍 Testing full sync enhancement process...")

# Create realistic file data like the GUI would have
test_files = [
    {
        "name": "2025May30-095945-Rec34.hda",
        "length": 12345678,
        "duration": 3600,
        "createDate": "2025/05/30",
        "createTime": "09:59:45",
        "time": datetime(2025, 5, 30, 9, 59, 45),
        "version": "1.0",
        "gui_status": "On Device"
    },
    {
        "name": "2025May13-100040-Rec52.hda", 
        "length": 9876543,
        "duration": 2400,
        "createDate": "2025/05/13",
        "createTime": "10:00:40", 
        "time": datetime(2025, 5, 13, 10, 0, 40),
        "version": "1.0",
        "gui_status": "On Device"
    },
    {
        "name": "2025May13-171205-Rec60.hda", 
        "length": 5555555,
        "duration": 1800,
        "createDate": "2025/05/13",
        "createTime": "17:12:05",
        "time": datetime(2025, 5, 13, 17, 12, 5),
        "version": "1.0", 
        "gui_status": "On Device"
    }
]

print(f"Input files: {[f['name'] for f in test_files]}")

# Run the sync enhancement
enhanced_files = test_gui.enhance_files_with_meeting_data_sync(test_files)

print(f"\n✅ Enhanced {len(enhanced_files)} files")

# Check results
for enhanced_file in enhanced_files:
    filename = enhanced_file['name']
    has_meeting = enhanced_file.get('has_meeting', False)
    meeting_subject = enhanced_file.get('meeting_subject', '')
    meeting_display_text = enhanced_file.get('meeting_display_text', '')
    
    print(f"\n📁 {filename}:")
    print(f"  has_meeting: {has_meeting}")
    print(f"  meeting_subject: '{meeting_subject}'")
    print(f"  meeting_display_text: '{meeting_display_text}'")
    
    if has_meeting and meeting_display_text:
        print(f"  ✅ SUCCESS - This file has meeting data!")
    elif not has_meeting:
        print(f"  ⚠️  No meeting data for this file")
    else:
        print(f"  ❌ Problem: has_meeting={has_meeting} but meeting_display_text='{meeting_display_text}'")

# Count files with meetings
files_with_meetings = sum(1 for f in enhanced_files if f.get('has_meeting', False))
print(f"\n📊 Summary:")
print(f"  Total files processed: {len(enhanced_files)}")
print(f"  Files with meetings: {files_with_meetings}")

if files_with_meetings > 0:
    print(f"\n🎉 SUCCESS: Meeting data is working correctly!")
    print(f"If you're not seeing meetings in the GUI, the issue is likely:")
    print(f"  1. TreeView 'Meeting' column is not visible")
    print(f"  2. TreeView 'Meeting' column is collapsed/too narrow")
    print(f"  3. TreeView column order puts Meeting column outside visible area")
else:
    print(f"\n❌ Issue found in the sync enhancement process")
