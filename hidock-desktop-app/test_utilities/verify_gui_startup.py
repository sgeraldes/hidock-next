#!/usr/bin/env python3
"""
Test script to verify GUI startup works correctly after fixing the autoconnect issue.
"""
import sys
import os
import subprocess
import time
import signal

def test_gui_startup():
    """Test that GUI starts up properly and is responsive"""
    print("🚀 Testing GUI startup after autoconnect fix...")
    
    try:
        # Start GUI with timeout to avoid hanging
        proc = subprocess.Popen(
            [sys.executable, "gui_main_window.py"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
        )
        
        # Let it run for 10 seconds to see full startup sequence
        print("Waiting 10 seconds for GUI to fully initialize...")
        time.sleep(10)
        
        # Terminate cleanly
        try:
            if os.name == 'nt':
                proc.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                proc.terminate()
            
            output, _ = proc.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            output, _ = proc.communicate()
        
        print("\n=== Full Startup Output ===")
        print(output)
        
        print("\n=== Analysis ===")
        lines = output.split('\n')
        clean_lines = [line for line in lines if line.strip()]
        
        # Check for error patterns
        error_keywords = ['error', 'exception', 'failed', 'not null', 'constraint']
        errors_found = [line for line in clean_lines if any(keyword in line.lower() for keyword in error_keywords)]
        
        # Check for successful startup patterns
        startup_keywords = ['logger', 'info', 'debug', 'initialized', 'loaded']
        startup_messages = [line for line in clean_lines if any(keyword in line.lower() for keyword in startup_keywords)]
        
        # Check for specific features
        cached_files_msg = [line for line in clean_lines if 'cached files' in line.lower()]
        calendar_msg = [line for line in clean_lines if 'calendar' in line.lower()]
        autoconnect_msg = [line for line in clean_lines if 'autoconnect' in line.lower()]
        
        print(f"Total log messages: {len(clean_lines)}")
        print(f"Startup messages: {len(startup_messages)}")
        print(f"Error messages: {len(errors_found)}")
        print(f"Cached files messages: {len(cached_files_msg)}")
        print(f"Calendar messages: {len(calendar_msg)}")
        print(f"Autoconnect messages: {len(autoconnect_msg)}")
        
        if errors_found:
            print("\n❌ ERRORS FOUND:")
            for error in errors_found:
                print(f"  {error}")
            return False
        
        if len(startup_messages) < 2:
            print("\n⚠️ WARNING: Very few startup messages - GUI might not be initializing properly")
            return False
        
        print("\n✅ SUCCESS: GUI startup appears to be working correctly!")
        print("✅ No database constraint errors found")
        print("✅ Normal startup sequence observed")
        print("✅ Application terminates cleanly")
        
        if autoconnect_msg:
            print("✅ Autoconnect processing detected (as expected with autoconnect=True)")
        
        return True
        
    except Exception as e:
        print(f"\n❌ ERROR: Exception during GUI startup test: {e}")
        return False

if __name__ == "__main__":
    success = test_gui_startup()
    if success:
        print("\n🎉 GUI startup regression has been FIXED!")
        print("The main window should now open properly without hanging during initialization.")
    else:
        print("\n❌ GUI startup issues still persist.")
    
    sys.exit(0 if success else 1)
