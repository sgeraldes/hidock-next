#!/usr/bin/env python3
"""
Test script to capture GUI startup output and check for errors
"""
import subprocess
import time
import signal
import os
import sys

def run_gui_startup_test():
    print("Starting GUI application for 8 seconds to capture startup logs...")
    
    # Start the GUI application
    proc = subprocess.Popen(
        [sys.executable, "gui_main_window.py"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        universal_newlines=True,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    )
    
    # Let it run for 8 seconds
    time.sleep(8)
    
    # Terminate the process
    try:
        if os.name == 'nt':
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            proc.terminate()
        
        # Wait for termination with timeout
        output, _ = proc.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        output, _ = proc.communicate()
    except:
        proc.kill()
        output, _ = proc.communicate()
    
    print("=== Full Output ===")
    print(output)
    
    print("\n=== Filtering for relevant entries ===")
    relevant_keywords = [
        'not null', 'constraint', 'audio_metadata', 'meeting', 
        'cached', 'enhance', 'error', 'exception', 'failed',
        'loading cached files', 'calendar', 'file enhanced'
    ]
    
    found_relevant = False
    for line in output.split('\n'):
        if any(keyword in line.lower() for keyword in relevant_keywords):
            print(f"RELEVANT: {line}")
            found_relevant = True
    
    if not found_relevant:
        print("No relevant log entries found - this suggests the fixes are working!")
    
    return output

if __name__ == "__main__":
    run_gui_startup_test()
