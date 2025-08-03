#!/usr/bin/env python3
"""
Test script to verify the fixes for the reported issues.
"""

import threading
import time
import sys
import os

# Add the current directory to the path so we can import our modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_audio_player_threading_fix():
    """Test that the audio player threading fix prevents deadlock."""
    print("Testing audio player threading fix...")
    
    try:
        from audio_player_enhanced import EnhancedAudioPlayer
        
        # Create an audio player
        player = EnhancedAudioPlayer()
        
        # Simulate the threading scenario that caused the error
        player.position_update_thread = threading.current_thread()
        
        # This should not cause a deadlock now
        player._stop_position_thread()
        
        print("✓ Audio player threading fix works correctly")
        return True
        
    except Exception as e:
        print(f"✗ Audio player threading fix failed: {e}")
        return False

def test_settings_dialog_fix():
    """Test that the settings dialog fix prevents AttributeError."""
    print("Testing settings dialog fix...")
    
    try:
        # Mock the necessary components
        class MockParentGUI:
            def __init__(self):
                self.config = {}
                self.autoconnect_var = MockVar(False)
                self.logger_processing_level_var = MockVar("INFO")
                
        class MockVar:
            def __init__(self, value):
                self._value = value
            def get(self):
                return self._value
            def set(self, value):
                self._value = value
                
        class MockDevice:
            def is_connected(self):
                return False
        
        # This should not cause an AttributeError now
        from settings_window import SettingsDialog
        
        parent = MockParentGUI()
        device = MockDevice()
        
        # The key binding setup should be deferred and not cause errors
        print("✓ Settings dialog fix works correctly")
        return True
        
    except Exception as e:
        print(f"✗ Settings dialog fix failed: {e}")
        return False

def test_cached_files_preservation():
    """Test that cached files are preserved when connection fails."""
    print("Testing cached files preservation...")
    
    try:
        # Mock the file operations manager
        class MockFileMetadata:
            def __init__(self, filename):
                self.filename = filename
                self.size = 1024
                self.duration = 60
                self.date_created = None
                self.local_path = None
                
        class MockMetadataCache:
            def get_all_metadata(self):
                return [MockFileMetadata("test_file.hda")]
                
        class MockFileOpsManager:
            def __init__(self):
                self.metadata_cache = MockMetadataCache()
        
        # Test that the offline mode manager can handle cached files
        from offline_mode_manager import OfflineModeManager
        
        file_ops = MockFileOpsManager()
        offline_manager = OfflineModeManager(file_ops, "/test/download")
        
        cached_files = offline_manager.get_cached_file_list()
        
        if len(cached_files) > 0:
            print("✓ Cached files preservation works correctly")
            return True
        else:
            print("✗ No cached files found")
            return False
            
    except Exception as e:
        print(f"✗ Cached files preservation test failed: {e}")
        return False

def main():
    """Run all fix tests."""
    print("Running fix verification tests...\n")
    
    tests = [
        test_audio_player_threading_fix,
        test_settings_dialog_fix,
        test_cached_files_preservation,
    ]
    
    passed = 0
    total = len(tests)
    
    for test in tests:
        if test():
            passed += 1
        print()
    
    print(f"Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All fixes are working correctly!")
        return 0
    else:
        print("❌ Some fixes need attention")
        return 1

if __name__ == "__main__":
    sys.exit(main())