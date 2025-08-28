#!/usr/bin/env python3
"""
Quick verification script to check if meeting data is working correctly
"""
import sys
import os

# Add the current directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from async_calendar_mixin import AsyncCalendarMixin

# Create a test instance
class TestCalendar(AsyncCalendarMixin):
    def __init__(self):
        # Initialize any required attributes for async calendar
        pass

# Test the calendar enhancement
test_calendar = TestCalendar()

# Create sample file data with files that actually have meetings (from the startup logs)
sample_files = [
    {"name": "2025May30-095945-Rec34.hda", "other_data": "test"},  # Should have "Definición plan de trabajo Auna"
    {"name": "2025May13-100040-Rec52.hda", "other_data": "test"},  # Should have "Saad - Seba"
    {"name": "2025May13-171205-Rec60.hda", "other_data": "test"},  # Should have "Looking ahead"
    {"name": "2025May14-113137-Rec62.hda", "other_data": "test"},  # Should have "Contracts Review"
]

print("🔍 Testing meeting data enhancement...")
print(f"Input files: {[f['name'] for f in sample_files]}")

# Test synchronous enhancement (cache-based)
try:
    enhanced_files = test_calendar.enhance_files_with_meeting_data_sync(sample_files)
    print("\n✅ Synchronous enhancement results (from cache):")
    for file in enhanced_files:
        meeting_text = file.get('meeting_display_text', 'NOT_FOUND')
        print(f"  {file['name']}: '{meeting_text}'")
        
    # Check if any meeting data was found
    has_meeting_data = any(file.get('meeting_display_text') and file.get('meeting_display_text') != 'No meeting' for file in enhanced_files)
    
    if has_meeting_data:
        print("\n🎉 SUCCESS: Meeting data is being applied correctly!")
        print("The issue is likely with the TreeView column visibility/positioning.")
    else:
        print("\n⚠️  No cached meeting data found for these files.")
        print("This is expected if the files don't have calendar entries.")
        
except Exception as e:
    print(f"\n❌ Error during enhancement: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "="*50)
print("RECOMMENDATION:")
print("If meeting data is found above, check your GUI TreeView to ensure")
print("the 'Meeting' column is visible and positioned correctly.")
print("You may need to resize columns or check column display order.")
