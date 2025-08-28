#!/usr/bin/env python3
"""
Simple GUI startup test to verify the fixes are working
"""
import sys
import time
from gui_main_window import HiDockToolGUI

def test_gui():
    print("🔧 Creating GUI...")
    start = time.time()
    
    try:
        gui = HiDockToolGUI()
        elapsed = time.time() - start
        print(f"✅ GUI created successfully in {elapsed:.2f} seconds")
        
        print("🖥️ Starting GUI mainloop for 3 seconds...")
        gui.after(3000, gui.destroy)
        gui.mainloop()
        print("✅ GUI closed normally")
        
        return True
        
    except Exception as e:
        print(f"❌ GUI error: {e}")
        return False

if __name__ == "__main__":
    success = test_gui()
    if success:
        print("\n🎉 GUI startup test PASSED!")
        print("The fixes are working - GUI opens without hanging!")
    else:
        print("\n❌ GUI startup test FAILED!")
    
    sys.exit(0 if success else 1)
