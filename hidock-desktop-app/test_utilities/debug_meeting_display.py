#!/usr/bin/env python3
"""Debug script to check what meeting data is actually in the file dictionaries."""

import sys
import os

# Add the project directory to Python path
project_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_dir)

# Import required modules
from config_and_logger import logger, Logger
from async_calendar_mixin import AsyncCalendarMixin
from file_operations_manager import FileOperationsManager
from desktop_device_adapter import DesktopDeviceAdapter
from device_interface import DeviceManager

# Set debug logging
logger.set_level("DEBUG")

# Create minimal test class
class DebugCalendarGUI(AsyncCalendarMixin):
    def __init__(self):
        # Initialize minimal required attributes for calendar system
        self.device_manager = None
        self.download_directory = os.getcwd()
        
        # Initialize calendar system
        self.after_calls = []  # Mock after() calls
        self._ensure_async_calendar_initialized()
    
    def after(self, delay, callback, *args, **kwargs):
        """Mock after method - just execute immediately for testing"""
        self.after_calls.append((delay, callback, args, kwargs))
        if callable(callback):
            try:
                callback(*args, **kwargs)
            except Exception as e:
                print(f"Error in callback: {e}")

def main():
    print("🔍 Debugging meeting display data...")
    
    # Create debug GUI instance
    debug_gui = DebugCalendarGUI()
    
    # Load some sample cached files (simulate what the GUI gets)
    try:
        # Access the file operations manager's metadata cache directly
        script_dir = os.path.dirname(os.path.abspath(__file__))
        cache_dir = os.path.join(os.path.expanduser("~"), ".hidock", "cache")
        
        if not os.path.exists(cache_dir):
            print(f"❌ Cache directory not found: {cache_dir}")
            return
        
        # Create a minimal device manager for metadata cache
        usb_backend = None
        try:
            import usb.backend.libusb1
            usb_backend = usb.backend.libusb1.get_backend()
        except:
            pass
        
        device_adapter = DesktopDeviceAdapter(usb_backend)
        device_manager = DeviceManager(device_adapter)
        
        file_ops_manager = FileOperationsManager(
            device_manager,
            debug_gui.download_directory,
            cache_dir
        )
        
        # Get cached files
        cached_files = file_ops_manager.metadata_cache.get_all_metadata()
        print(f"📁 Found {len(cached_files)} cached files")
        
        if not cached_files:
            print("❌ No cached files found")
            return
        
        # Convert to GUI format (first 5 files only)
        sample_files = cached_files[:5]
        files_dict = []
        
        for i, f_info in enumerate(sample_files):
            files_dict.append({
                "name": f_info.filename,
                "length": f_info.size,
                "duration": f_info.duration,
                "createDate": (f_info.date_created.strftime("%Y/%m/%d") if f_info.date_created else "---"),
                "createTime": (f_info.date_created.strftime("%H:%M:%S") if f_info.date_created else "---"),
                "time": f_info.date_created,
                "version": "0",
                "original_index": i + 1,
                "gui_status": "On Device",
                "local_path": f_info.local_path,
                "checksum": f_info.checksum,
            })
        
        print(f"📝 Converted {len(files_dict)} files to GUI format")
        
        # Print before enhancement
        print("\n🔴 BEFORE calendar enhancement:")
        for i, file_data in enumerate(files_dict[:3]):
            print(f"  File {i+1}: {file_data['name']}")
            print(f"    meeting_display_text: {file_data.get('meeting_display_text', 'NOT SET')}")
            print(f"    has_meeting: {file_data.get('has_meeting', 'NOT SET')}")
        
        # Enhance with calendar data (synchronous)
        print(f"\n🟡 Enhancing with synchronous calendar data...")
        enhanced_files = debug_gui.enhance_files_with_meeting_data_sync(files_dict)
        
        # Print after enhancement
        print("\n🟢 AFTER calendar enhancement:")
        for i, file_data in enumerate(enhanced_files[:3]):
            print(f"  File {i+1}: {file_data['name']}")
            print(f"    meeting_display_text: '{file_data.get('meeting_display_text', 'NOT SET')}'")
            print(f"    has_meeting: {file_data.get('has_meeting', 'NOT SET')}")
            print(f"    meeting_subject: '{file_data.get('meeting_subject', 'NOT SET')}'")
        
        # Check if any files have meeting data
        files_with_meetings = [f for f in enhanced_files if f.get('has_meeting', False)]
        files_with_display_text = [f for f in enhanced_files if f.get('meeting_display_text') and f.get('meeting_display_text').strip()]
        
        print(f"\n📊 SUMMARY:")
        print(f"  Total files: {len(enhanced_files)}")
        print(f"  Files with has_meeting=True: {len(files_with_meetings)}")
        print(f"  Files with meeting_display_text: {len(files_with_display_text)}")
        
        if files_with_display_text:
            print(f"\n✅ Found files with meeting display text:")
            for f in files_with_display_text[:5]:
                print(f"  - {f['name']}: '{f['meeting_display_text']}'")
        else:
            print(f"\n❌ No files have meeting_display_text set")
        
    except Exception as e:
        print(f"❌ Error during debug: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
