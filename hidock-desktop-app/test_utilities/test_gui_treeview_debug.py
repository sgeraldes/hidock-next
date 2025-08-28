#!/usr/bin/env python3
"""Test GUI startup and debug TreeView population with meeting data."""

import sys
import os
import time

# Add the project directory to Python path
project_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_dir)

from config_and_logger import logger, Logger
from gui_main_window import HiDockToolGUI

# Override the populate method to debug
original_populate_method = None

def debug_populate_treeview_from_data(self, files_data):
    """Debug wrapper for TreeView population."""
    print(f"\n🔍 DEBUG: _populate_treeview_from_data called with {len(files_data)} files")
    
    # Check first few files for meeting data
    for i, file_info in enumerate(files_data[:3]):
        meeting_text = file_info.get("meeting_display_text", "NOT SET")
        has_meeting = file_info.get("has_meeting", "NOT SET")
        print(f"  File {i+1}: {file_info['name']}")
        print(f"    meeting_display_text: '{meeting_text}'")
        print(f"    has_meeting: {has_meeting}")
    
    # Count files with meeting data
    files_with_meetings = [f for f in files_data if f.get('has_meeting', False)]
    files_with_text = [f for f in files_data if f.get('meeting_display_text') and f.get('meeting_display_text').strip()]
    
    print(f"  📊 {len(files_with_meetings)} files have meetings")
    print(f"  📊 {len(files_with_text)} files have display text")
    
    if files_with_text:
        print(f"  ✅ Files with meeting text:")
        for f in files_with_text[:5]:
            print(f"    - {f['name']}: '{f.get('meeting_display_text', '')}'")
    
    # Call the original method
    return original_populate_method(files_data)

def main():
    print("🔧 Starting GUI with TreeView debug...")
    
    # Set up logging
    logger.set_level("INFO")  # Reduce noise
    
    # Monkey patch the populate method
    global original_populate_method
    original_populate_method = HiDockToolGUI._populate_treeview_from_data
    HiDockToolGUI._populate_treeview_from_data = debug_populate_treeview_from_data
    
    try:
        # Create GUI instance
        print("🖥️ Creating GUI...")
        gui = HiDockToolGUI()
        
        print("✅ GUI created successfully")
        print("🖥️ Starting mainloop for 5 seconds to observe TreeView population...")
        
        # Run for 5 seconds to see what happens
        start_time = time.time()
        while time.time() - start_time < 5.0:
            try:
                gui.update()
                time.sleep(0.01)  # Small delay
            except Exception as e:
                print(f"GUI update error: {e}")
                break
        
        print("⏹️ Stopping GUI...")
        gui.destroy()
        
    except Exception as e:
        print(f"❌ Error during GUI test: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
