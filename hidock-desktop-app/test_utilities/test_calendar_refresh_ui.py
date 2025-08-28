#!/usr/bin/env python3
"""
Test script to verify calendar refresh UI improvements
"""

import sys
import tkinter as tk
from pathlib import Path

# Add the current directory to the path
sys.path.insert(0, str(Path(__file__).parent))

def test_refresh_overlay():
    """Test the calendar refresh overlay UI."""
    
    # Mock GUI methods to test overlay
    class MockGUI:
        def __init__(self):
            self.root = tk.Tk()
            self.root.title("Test Calendar Refresh Overlay")
            self.root.geometry("800x600")
            
            # Test button
            test_btn = tk.Button(
                self.root,
                text="Test Force Refresh Overlay",
                command=self.test_overlay,
                font=('Arial', 12),
                bg='#4CAF50',
                fg='white'
            )
            test_btn.pack(pady=50)
            
        def test_overlay(self):
            """Test the overlay functionality."""
            self._show_calendar_refresh_overlay(25)  # Simulate 25 files
            
            # Auto-hide after 5 seconds for testing
            self.root.after(5000, self._hide_calendar_refresh_overlay)
        
        def _show_calendar_refresh_overlay(self, file_count):
            """Show visual overlay during calendar refresh."""
            try:
                # Create overlay frame
                self.calendar_refresh_overlay = tk.Frame(self.root, bg='black')
                self.calendar_refresh_overlay.place(x=0, y=0, relwidth=1, relheight=1)
                self.calendar_refresh_overlay.configure(bg='#000000')
                # Note: alpha transparency doesn't work with place() in tkinter
                
                # Create content frame
                content_frame = tk.Frame(self.calendar_refresh_overlay, bg='#2b2b2b', relief='raised', bd=3)
                content_frame.place(relx=0.5, rely=0.5, anchor='center')
                
                # Title
                title_label = tk.Label(
                    content_frame,
                    text="Refreshing Calendar Data",
                    font=('Arial', 18, 'bold'),
                    fg='white',
                    bg='#2b2b2b'
                )
                title_label.pack(pady=30, padx=60)
                
                # Progress info
                self.refresh_progress_label = tk.Label(
                    content_frame,
                    text=f"Processing {file_count} files...",
                    font=('Arial', 14),
                    fg='#cccccc',
                    bg='#2b2b2b'
                )
                self.refresh_progress_label.pack(pady=(0, 15))
                
                # Status
                status_label = tk.Label(
                    content_frame,
                    text="• Clearing cache\n• Fetching fresh calendar data\n• Updating file metadata",
                    font=('Arial', 11),
                    fg='#aaaaaa',
                    bg='#2b2b2b',
                    justify='left'
                )
                status_label.pack(pady=(0, 15))
                
                # Animated dots
                self.refresh_dots_label = tk.Label(
                    content_frame,
                    text="...",
                    font=('Arial', 14, 'bold'),
                    fg='#4CAF50',
                    bg='#2b2b2b'
                )
                self.refresh_dots_label.pack(pady=(0, 30))
                
                # Start dots animation
                self._animate_refresh_dots()
                
                # Update display
                self.root.update()
                
                print(f"✓ Overlay shown for {file_count} files")
                
            except Exception as e:
                print(f"✗ Error showing overlay: {e}")
        
        def _hide_calendar_refresh_overlay(self):
            """Hide the calendar refresh overlay."""
            try:
                if hasattr(self, 'calendar_refresh_overlay'):
                    self.calendar_refresh_overlay.destroy()
                    delattr(self, 'calendar_refresh_overlay')
                
                print("✓ Overlay hidden")
                
            except Exception as e:
                print(f"✗ Error hiding overlay: {e}")
        
        def _animate_refresh_dots(self):
            """Animate the dots in the refresh overlay."""
            try:
                if hasattr(self, 'refresh_dots_label') and self.refresh_dots_label.winfo_exists():
                    current_text = self.refresh_dots_label.cget('text')
                    if current_text == '...':
                        new_text = '   '
                    elif current_text == '   ':
                        new_text = '.  '
                    elif current_text == '.  ':
                        new_text = '.. '
                    else:
                        new_text = '...'
                    
                    self.refresh_dots_label.config(text=new_text)
                    
                    # Schedule next animation frame
                    self.root.after(400, self._animate_refresh_dots)
            except:
                pass  # Animation will stop if overlay is destroyed
        
        def run(self):
            """Start the test GUI."""
            print("Calendar Refresh Overlay Test")
            print("=============================")
            print("Click the button to test the overlay")
            print("The overlay will auto-hide after 5 seconds")
            print()
            
            self.root.mainloop()
    
    # Run the test
    test_gui = MockGUI()
    test_gui.run()

if __name__ == "__main__":
    test_refresh_overlay()