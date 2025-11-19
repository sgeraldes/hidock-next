# calendar_oauth_dialog.py
"""
OAuth2 Dialog for Calendar Integration.

This module provides a CustomTkinter dialog for handling OAuth2 authentication
for Microsoft Outlook and Google Calendar via the HiNotes backend.

Features:
- Provider selection (Microsoft/Google)
- Opens OAuth URL in browser automatically
- Polls backend for connection status
- Shows real-time progress with animated dots
- User-friendly success/error messages
- Cancellable operation
"""

import threading
from datetime import datetime
from typing import Callable, Optional, Tuple

import customtkinter as ctk

from config_and_logger import logger
from hinotes_calendar_service import HiNotesCalendarService


class CalendarOAuthDialog(ctk.CTkToplevel):
    """
    Dialog window for OAuth2 calendar authentication.

    This dialog guides the user through the OAuth2 authentication flow:
    1. User selects provider (Microsoft or Google)
    2. Dialog opens browser to OAuth URL
    3. User logs in and grants permissions in browser
    4. Dialog polls backend for connection status
    5. Dialog shows success message when connected
    """

    def __init__(self, parent, access_token: str, callback: Optional[Callable] = None):
        """
        Initialize OAuth dialog.

        Args:
            parent: Parent window
            access_token: HiDock user session token
            callback: Optional callback function called on success: callback(provider, email)
        """
        super().__init__(parent)

        self.access_token = access_token
        self.callback = callback
        self.calendar_service = None
        self.selected_provider = ctk.StringVar(value="microsoft")
        self.is_polling = False
        self.poll_thread = None

        # Configure dialog window
        self.title("Connect Calendar")
        self.geometry("500x350")
        self.resizable(False, False)

        # Center on parent
        self.transient(parent)
        self.grab_set()

        self._setup_ui()

        logger.info("CalendarOAuth", "init", "OAuth dialog opened")

    def _setup_ui(self):
        """Setup dialog UI components."""

        # Main container with padding
        main_frame = ctk.CTkFrame(self, fg_color="transparent")
        main_frame.pack(fill="both", expand=True, padx=20, pady=20)

        # Title
        title_label = ctk.CTkLabel(main_frame, text="Connect Your Calendar", font=("Segoe UI", 18, "bold"))
        title_label.pack(pady=(0, 10))

        # Description
        desc_label = ctk.CTkLabel(
            main_frame,
            text="Link your calendar to automatically match recordings with meetings.",
            font=("Segoe UI", 11),
            wraplength=450,
            justify="center",
        )
        desc_label.pack(pady=(0, 20))

        # Provider selection frame
        provider_frame = ctk.CTkFrame(main_frame)
        provider_frame.pack(fill="x", pady=(0, 20))

        provider_label = ctk.CTkLabel(provider_frame, text="Select Calendar Provider:", font=("Segoe UI", 12, "bold"))
        provider_label.pack(pady=(10, 5))

        # Radio buttons for provider selection
        radio_frame = ctk.CTkFrame(provider_frame, fg_color="transparent")
        radio_frame.pack(pady=(5, 10))

        microsoft_radio = ctk.CTkRadioButton(
            radio_frame,
            text="Microsoft Outlook / Office 365",
            variable=self.selected_provider,
            value="microsoft",
            font=("Segoe UI", 11),
        )
        microsoft_radio.pack(pady=5)

        google_radio = ctk.CTkRadioButton(
            radio_frame, text="Google Calendar", variable=self.selected_provider, value="google", font=("Segoe UI", 11)
        )
        google_radio.pack(pady=5)

        # Status label (for showing progress)
        self.status_label = ctk.CTkLabel(main_frame, text="", font=("Segoe UI", 10), text_color="gray")
        self.status_label.pack(pady=(0, 10))

        # Progress indicator (hidden initially)
        self.progress_label = ctk.CTkLabel(main_frame, text="", font=("Segoe UI", 10, "bold"))
        self.progress_label.pack(pady=(0, 10))

        # Buttons frame
        button_frame = ctk.CTkFrame(main_frame, fg_color="transparent")
        button_frame.pack(pady=(10, 0))

        self.connect_button = ctk.CTkButton(
            button_frame,
            text="Connect Calendar",
            command=self._start_oauth_flow,
            width=150,
            height=35,
            font=("Segoe UI", 12, "bold"),
        )
        self.connect_button.pack(side="left", padx=5)

        self.cancel_button = ctk.CTkButton(
            button_frame,
            text="Cancel",
            command=self._cancel_and_close,
            width=100,
            height=35,
            fg_color="gray",
            hover_color="darkgray",
        )
        self.cancel_button.pack(side="left", padx=5)

        # Info label at bottom
        info_label = ctk.CTkLabel(
            main_frame,
            text="Your browser will open for login. Grant calendar access when prompted.",
            font=("Segoe UI", 9),
            text_color="gray",
            wraplength=450,
            justify="center",
        )
        info_label.pack(side="bottom", pady=(10, 0))

    def _start_oauth_flow(self):
        """Start OAuth2 authentication flow."""
        provider = self.selected_provider.get()

        logger.info("CalendarOAuth", "start_flow", f"Starting OAuth flow for {provider}")

        # Create calendar service
        from config_and_logger import config

        self.calendar_service = HiNotesCalendarService(config, self.access_token)

        # Check if already connected
        is_connected, email = self.calendar_service.check_connection_status(provider)

        if is_connected:
            self._show_success(f"Already connected as {email}", provider, email)
            return

        # Disable connect button during flow
        self.connect_button.configure(state="disabled")

        # Update status
        self.status_label.configure(text=f"Opening {provider.title()} login in browser...")

        # Open OAuth URL in browser
        if not self.calendar_service.open_oauth_in_browser(provider):
            self._show_error("Failed to open browser. Please try again.")
            self.connect_button.configure(state="normal")
            return

        # Start polling for connection status
        self._start_polling(provider)

    def _start_polling(self, provider: str):
        """
        Start polling backend for connection status.

        Args:
            provider: 'microsoft' or 'google'
        """
        self.is_polling = True

        # Update UI to show polling state
        self.status_label.configure(text=f"Waiting for you to complete login in browser...")
        self.progress_label.configure(text="⏳ Checking connection")

        # Start polling in background thread
        self.poll_thread = threading.Thread(target=self._poll_connection_status, args=(provider,), daemon=True)
        self.poll_thread.start()

        # Start progress animation
        self._animate_progress_dots()

    def _poll_connection_status(self, provider: str):
        """
        Poll backend for connection status (runs in background thread).

        Args:
            provider: 'microsoft' or 'google'
        """
        timeout_seconds = 120  # 2 minutes
        poll_interval = 2.0  # 2 seconds

        success, email = self.calendar_service.wait_for_oauth_completion(
            provider, timeout_seconds=timeout_seconds, poll_interval=poll_interval
        )

        # Update UI on main thread
        self.after(0, self._on_poll_complete, success, email, provider)

    def _animate_progress_dots(self, dots: int = 0):
        """
        Animate progress indicator with dots.

        Args:
            dots: Current number of dots (0-3)
        """
        if not self.is_polling:
            self.progress_label.configure(text="")
            return

        # Cycle through 0-3 dots
        dot_text = "." * (dots % 4)
        self.progress_label.configure(text=f"⏳ Checking connection{dot_text}")

        # Continue animation
        self.after(500, self._animate_progress_dots, dots + 1)

    def _on_poll_complete(self, success: bool, email: Optional[str], provider: str):
        """
        Handle polling completion (runs on main thread).

        Args:
            success: Whether connection succeeded
            email: User email if connected
            provider: Calendar provider
        """
        self.is_polling = False

        if success:
            self._show_success(f"Successfully connected as {email}", provider, email)
        else:
            self._show_error("Connection timeout. Please try again or check your internet connection.")
            self.connect_button.configure(state="normal")

    def _show_success(self, message: str, provider: str, email: str):
        """
        Show success message and close dialog.

        Args:
            message: Success message to display
            provider: Calendar provider
            email: User email
        """
        logger.info("CalendarOAuth", "success", f"Calendar connected: {provider} - {email}")

        # Update UI
        self.progress_label.configure(text="✓ Connected!", text_color="green")
        self.status_label.configure(text=message, text_color="green")

        # Call callback if provided
        if self.callback:
            self.callback(provider, email)

        # Close dialog after short delay
        self.after(2000, self.destroy)

    def _show_error(self, message: str):
        """
        Show error message in dialog.

        Args:
            message: Error message to display
        """
        logger.error("CalendarOAuth", "error", message)

        self.progress_label.configure(text="✗ Error", text_color="red")
        self.status_label.configure(text=message, text_color="red")

    def _cancel_and_close(self):
        """Cancel OAuth flow and close dialog."""
        self.is_polling = False

        if self.poll_thread and self.poll_thread.is_alive():
            # Thread will stop on next iteration due to is_polling flag
            pass

        logger.info("CalendarOAuth", "cancel", "OAuth dialog cancelled by user")
        self.destroy()


class CalendarConnectionManager:
    """
    Manages calendar connections for the desktop app.

    Provides high-level methods for checking connection status, connecting,
    and disconnecting calendar providers.
    """

    def __init__(self, config, access_token: str):
        """
        Initialize connection manager.

        Args:
            config: Application configuration
            access_token: HiDock user session token
        """
        self.config = config
        self.access_token = access_token
        self.calendar_service = HiNotesCalendarService(config, access_token)

    def is_connected(self, provider: str = "microsoft") -> Tuple[bool, Optional[str]]:
        """
        Check if calendar is connected.

        Args:
            provider: 'microsoft' or 'google'

        Returns:
            Tuple of (is_connected, user_email)
        """
        return self.calendar_service.check_connection_status(provider)

    def get_connected_providers(self) -> Dict[str, str]:
        """
        Get all connected calendar providers.

        Returns:
            Dictionary of {provider: email} for connected providers
        """
        connected = {}

        for provider in ["microsoft", "google"]:
            is_connected, email = self.is_connected(provider)
            if is_connected and email:
                connected[provider] = email

        return connected

    def show_connection_dialog(self, parent, callback: Optional[Callable] = None):
        """
        Show OAuth connection dialog.

        Args:
            parent: Parent window
            callback: Optional callback function called on success
        """
        dialog = CalendarOAuthDialog(parent, self.access_token, callback)
        return dialog

    def disconnect(self, provider: str = "microsoft") -> bool:
        """
        Disconnect calendar provider.

        Args:
            provider: 'microsoft' or 'google'

        Returns:
            True if disconnected successfully
        """
        return self.calendar_service.disconnect(provider)

    def get_events(self, start_date: datetime, end_date: datetime, provider: str = "microsoft"):
        """
        Get calendar events for date range.

        Args:
            start_date: Start date
            end_date: End date
            provider: 'microsoft' or 'google'

        Returns:
            List of CalendarEvent objects
        """
        return self.calendar_service.get_events(start_date, end_date, provider)

    def find_event_for_recording(
        self, recording_time: datetime, duration_seconds: int = None, provider: str = "microsoft"
    ) -> Optional:
        """
        Find calendar event matching a recording.

        Args:
            recording_time: Recording start time
            duration_seconds: Recording duration
            provider: 'microsoft' or 'google'

        Returns:
            CalendarEvent if found, None otherwise
        """
        return self.calendar_service.find_event_for_recording(recording_time, duration_seconds, provider)


# Example usage for testing
if __name__ == "__main__":
    import tkinter as tk

    def on_connect_success(provider: str, email: str):
        print(f"✓ Connected to {provider}: {email}")

    # Create test window
    root = ctk.CTk()
    root.geometry("400x200")
    root.title("Calendar Connection Test")

    # Note: You need a valid HiDock access token to test
    # Get it from https://hinotes.hidock.com (login and extract from dev tools)
    test_access_token = "your_access_token_here"

    def open_dialog():
        dialog = CalendarOAuthDialog(root, test_access_token, callback=on_connect_success)

    button = ctk.CTkButton(root, text="Connect Calendar", command=open_dialog)
    button.pack(expand=True)

    root.mainloop()
