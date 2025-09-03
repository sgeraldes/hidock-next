"""
Main entry point for the HiDock Tool application.


This script initializes and runs the main graphical user interface (GUI)
for the HiDock Tool, built using customtkinter. It sets up initial
appearance modes and themes for the GUI.

The script includes a top-level exception handler that logs critical errors
and attempts to display a user-friendly error message using tkinter
as a fallback if the main customtkinter application fails to initialize
or encounters a severe runtime issue.
"""

# main.py

import sys
import os
import tkinter  # For tkinter.Menu and messagebox
import traceback

# Add the src directory to Python path so all existing imports work
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src'))

import customtkinter as ctk  # For CTkInputDialog in settings, and CTk itself

from config_and_logger import logger  # For the top-level exception handler
from scripts.runtime_deps_check import check_and_handle_runtime_deps  # Runtime dependency checker

# Import the main GUI class and the logger
from gui_main_window import HiDockToolGUI


def main() -> None:
    """Initializes and runs the HiDock Tool application."""
    # Check runtime dependencies before starting the GUI
    print("HiDock Desktop - Checking runtime dependencies...")
    if not check_and_handle_runtime_deps():
        print("Runtime dependencies check failed or was cancelled.")
        sys.exit(1)
    
    # It's good practice to set the appearance mode and theme early,
    # though HiDockToolGUI also does this. This ensures CTk is initialized
    # with a theme before any widgets might be created, even implicitly.
    # These could also be loaded from config here if preferred, but the GUI class handles it.
    ctk.set_appearance_mode("System")  # Modes: "System" (standard), "Dark", "Light"
    ctk.set_default_color_theme("blue")  # Themes: "blue" (standard), "green", "dark-blue"

    app = None  # pylint: disable=invalid-name # Initialize app to None for the except block
    try:
        app = HiDockToolGUI()
        app.mainloop()
    except Exception as e:  # pylint: disable=broad-except
        # Log the critical error using the logger
        logger.error(
            "MainApp",
            "CriticalRuntimeError",
            f"CRITICAL ERROR DURING GUI INITIALIZATION OR RUNTIME:\n{traceback.format_exc()}",
        )

        # Fallback to basic tkinter for error message if customtkinter itself is the problem
        # or if the app object isn't fully formed.
        temp_root_for_error = None  # pylint: disable=invalid-name
        try:
            # Attempt to hide the main app window if it exists and is broken
            if app and hasattr(app, "winfo_exists") and app.winfo_exists():
                app.withdraw()

            temp_root_for_error = tkinter.Tk()
            temp_root_for_error.withdraw()  # Hide the empty root window
            tkinter.messagebox.showerror(
                "Fatal Error",
                f"A critical error occurred:\n\n{e}\n\n"
                "The application will now close. Please check the console output "
                "and any log files for more details.",
                parent=temp_root_for_error,  # Make messagebox modal to this hidden root
            )
        except Exception as e_diag:  # pylint: disable=broad-except
            # If even basic tkinter fails, print to console
            print(f"Could not display Tkinter error dialog: {e_diag}")
            print(f"Original critical error was: {e}")  # Ensure original error is still printed
        finally:
            if (
                temp_root_for_error
                and hasattr(temp_root_for_error, "winfo_exists")
                and temp_root_for_error.winfo_exists()
            ):
                temp_root_for_error.destroy()
        sys.exit(1)  # Exit the application after a critical error


if __name__ == "__main__":
    main()
