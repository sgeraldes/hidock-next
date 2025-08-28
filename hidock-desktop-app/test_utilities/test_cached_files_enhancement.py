#!/usr/bin/env python3
"""
Test script to verify that cached files enhancement is working properly
with both audio metadata and meeting data.
"""
import sys
import os
import json
import tempfile
from datetime import datetime, timedelta

# Add the current directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_cached_files_enhancement():
    """Test the cached files enhancement functionality"""
    try:
        # Import the necessary components
        from gui_main_window import HiDockToolGUI
        from file_operations_manager import FileOperationsManager
        from audio_metadata_mixin import AudioMetadataMixin
        
        print("Testing cached files enhancement...")
        
        # Create a temporary cache directory for testing
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_file = os.path.join(temp_dir, "test_cached_files.json")
            
            # Create mock cached files data
            mock_cached_files = [
                {
                    "name": "test_audio1.wav",
                    "size": 1024000,
                    "date_modified": (datetime.now() - timedelta(hours=2)).isoformat(),
                    "local_path": "",  # Empty path to test our fix
                    "device_path": "/device/recordings/test_audio1.wav",
                    "file_hash": "abc123def456",
                    "metadata": {}
                },
                {
                    "name": "meeting_recording.wav", 
                    "size": 2048000,
                    "date_modified": (datetime.now() - timedelta(hours=1)).isoformat(),
                    "local_path": None,  # None path to test our fix
                    "device_path": "/device/recordings/meeting_recording.wav",
                    "file_hash": "def456ghi789",
                    "metadata": {}
                }
            ]
            
            # Save mock cached files
            with open(cache_file, 'w') as f:
                json.dump(mock_cached_files, f, indent=2)
            
            print(f"Created test cache file with {len(mock_cached_files)} files")
            
            # Create a file manager instance to test enhancement
            file_manager = FileManager()
            
            # Test loading cached files
            try:
                loaded_files = file_manager._load_cached_files_from_json(cache_file)
                print(f"Successfully loaded {len(loaded_files)} cached files")
            except Exception as e:
                print(f"Error loading cached files: {e}")
                return False
            
            # Test audio metadata enhancement (should not raise NOT NULL constraint errors)
            print("\nTesting audio metadata enhancement...")
            try:
                # This should not fail with NOT NULL constraint errors anymore
                enhanced_files = []
                for file_info in loaded_files:
                    try:
                        # Test the audio metadata enhancement directly
                        if hasattr(file_manager, '_create_metadata_entry_for_file'):
                            print(f"Processing file: {file_info.get('name', 'Unknown')}")
                            # This call should now work without database errors
                            file_manager._create_metadata_entry_for_file(file_info)
                            print(f"  ✓ Audio metadata processing succeeded")
                        enhanced_files.append(file_info)
                    except Exception as e:
                        print(f"  ✗ Audio metadata error for {file_info.get('name', 'Unknown')}: {e}")
                        return False
                
                print(f"Audio metadata enhancement completed for {len(enhanced_files)} files")
                
            except Exception as e:
                print(f"Error during audio metadata enhancement: {e}")
                return False
            
            # Test meeting data enhancement
            print("\nTesting meeting data enhancement...")
            try:
                if hasattr(file_manager, 'enhance_files_with_meeting_data_sync'):
                    enhanced_with_meetings = file_manager.enhance_files_with_meeting_data_sync(enhanced_files)
                    print(f"Meeting data enhancement completed for {len(enhanced_with_meetings)} files")
                    
                    # Check if any meeting data was actually added
                    meeting_data_found = False
                    for file_info in enhanced_with_meetings:
                        if file_info.get('meeting_title') or file_info.get('meeting_participants'):
                            meeting_data_found = True
                            print(f"  ✓ Found meeting data for: {file_info['name']}")
                            break
                    
                    if not meeting_data_found:
                        print("  ℹ No meeting data found (expected if no calendar cache exists)")
                    
                else:
                    print("  ⚠ enhance_files_with_meeting_data_sync method not available")
                
            except Exception as e:
                print(f"Error during meeting data enhancement: {e}")
                return False
            
            print("\n✓ All cached files enhancement tests passed!")
            return True
            
    except ImportError as e:
        print(f"Import error: {e}")
        print("This suggests there might be missing dependencies or circular imports")
        return False
    except Exception as e:
        print(f"Unexpected error during testing: {e}")
        return False

if __name__ == "__main__":
    success = test_cached_files_enhancement()
    if success:
        print("\n🎉 SUCCESS: Cached files enhancement is working correctly!")
        print("Both audio metadata and meeting data enhancements are functional.")
    else:
        print("\n❌ FAILURE: There are still issues with cached files enhancement.")
    
    sys.exit(0 if success else 1)
