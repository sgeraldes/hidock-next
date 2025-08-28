#!/usr/bin/env python3
"""
Test script to verify calendar refresh functionality works correctly.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def test_calendar_integration():
    """Test if calendar integration is available and functional."""
    print("Testing calendar integration availability...")
    
    try:
        from simple_outlook_integration import create_simple_outlook_integration
        print("✓ Calendar integration module imported successfully")
        
        calendar_integration = create_simple_outlook_integration()
        print("✓ Calendar integration instance created")
        
        if calendar_integration.is_available():
            print(f"✓ Calendar integration is available with methods: {calendar_integration.available_methods}")
            print("✓ Calendar should work when refreshed from GUI")
            return True
        else:
            print(f"✗ Calendar integration not available: {calendar_integration.last_error}")
            print("✗ Possible issues:")
            print("  - Outlook not installed or not running")
            print("  - Not connected to mail server") 
            print("  - Calendar permissions not enabled")
            return False
            
    except ImportError as e:
        print(f"✗ Calendar integration module not available: {e}")
        return False
    except Exception as e:
        print(f"✗ Error testing calendar integration: {e}")
        return False

def main():
    """Main test function."""
    print("HiDock Calendar Integration Test")
    print("=" * 40)
    
    available = test_calendar_integration()
    
    print("\n" + "=" * 40)
    
    if available:
        print("SOLUTION:")
        print("Your calendar integration is working properly!")
        print("\nTo populate the Meeting column in the GUI:")
        print("1. Open the HiDock Desktop app")
        print("2. Go to View menu → 'Force Refresh Calendar'")
        print("3. Wait for the refresh to complete")
        print("4. The Meeting column should populate with calendar data")
        print("\nAlternatively:")
        print("1. Select some files in the file list")
        print("2. Go to View menu → 'Check Selected Files for Meetings'")
        print("3. This will check just the selected files")
    else:
        print("ISSUE FOUND:")
        print("Calendar integration is not properly available.")
        print("\nTo fix this:")
        print("1. Ensure Outlook is installed and running")
        print("2. Make sure you're connected to your mail server")
        print("3. Check that calendar permissions are enabled")
        print("4. Restart the HiDock app after fixing the above")

if __name__ == "__main__":
    main()
