# calendar_oauth_dialog_direct.py
"""
Direct OAuth2 Dialog for Calendar Integration (No HiNotes Backend).

This module provides a CustomTkinter dialog for handling OAuth2 authentication
directly with Microsoft and Google, without using the HiNotes backend.

Features:
- Provider selection (Microsoft/Google)
- Direct OAuth2 flow with PKCE
- Real-time progress updates
- Token storage with encryption
- User-friendly success/error messages
- Automatic token refresh
"""

import threading
from datetime import datetime
from typing import Callable, Optional

import customtkinter as ctk

from config_and_logger import logger
from microsoft_graph_api import MicrosoftGraphAPI
from oauth2_manager import OAuth2Manager
from oauth2_token_manager import OAuth2TokenManager


class DirectCalendarOAuthDialog(ctk.CTkToplevel):
    """
    Dialog window for direct OAuth2 calendar authentication.

    This dialog guides the user through the OAuth2 authentication flow:
    1. User selects provider (Microsoft or Google)
    2. Dialog starts OAuth flow and opens browser
    3. User logs in and grants permissions in browser
    4. Dialog captures tokens and saves them encrypted
    5. Dialog shows success message when connected
    """

    def __init__(self, parent, callback: Optional[Callable] = None):
        """
        Initialize OAuth dialog.

        Args:
            parent: Parent window
            callback: Optional callback function called on success: callback(provider, email)
        """
        super().__init__(parent)

        self.callback = callback
        self.selected_provider = ctk.StringVar(value="microsoft")
        self.oauth_thread = None
        self.token_manager = OAuth2TokenManager()

        # Configure dialog window
        self.title("Connect Calendar")
        self.geometry("500x400")
        self.resizable(False, False)

        # Center on parent
        self.transient(parent)
        self.grab_set()

        self._setup_ui()

        # Check if already connected
        self._check_existing_connection()

        logger.info("CalendarOAuth", "init", "Direct OAuth dialog opened")

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
            command=self._on_provider_changed,
        )
        microsoft_radio.pack(pady=5)

        google_radio = ctk.CTkRadioButton(
            radio_frame,
            text="Google Calendar (Coming Soon)",
            variable=self.selected_provider,
            value="google",
            font=("Segoe UI", 11),
            state="disabled",  # Google not implemented yet
            command=self._on_provider_changed,
        )
        google_radio.pack(pady=5)

        # Connection status frame
        self.status_frame = ctk.CTkFrame(main_frame)
        self.status_frame.pack(fill="x", pady=(0, 10))

        self.status_label = ctk.CTkLabel(self.status_frame, text="", font=("Segoe UI", 10), wraplength=450)
        self.status_label.pack(pady=10)

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

        self.disconnect_button = ctk.CTkButton(
            button_frame,
            text="Disconnect",
            command=self._disconnect,
            width=120,
            height=35,
            fg_color="orange",
            hover_color="darkorange",
        )
        self.disconnect_button.pack(side="left", padx=5)
        self.disconnect_button.pack_forget()  # Hidden initially

        self.cancel_button = ctk.CTkButton(
            button_frame,
            text="Cancel",
            command=self.destroy,
            width=100,
            height=35,
            fg_color="gray",
            hover_color="darkgray",
        )
        self.cancel_button.pack(side="left", padx=5)

        # Info label at bottom
        self.info_label = ctk.CTkLabel(
            main_frame,
            text="Your browser will open for login. Grant calendar access when prompted.",
            font=("Segoe UI", 9),
            text_color="gray",
            wraplength=450,
            justify="center",
        )
        self.info_label.pack(side="bottom", pady=(10, 0))

    def _check_existing_connection(self):
        """Check if user is already connected to a provider."""
        provider = self.selected_provider.get()

        if self.token_manager.is_token_valid(provider):
            # Get user info
            try:
                access_token = self.token_manager.get_access_token(provider)
                api = MicrosoftGraphAPI(access_token)
                profile = api.get_user_profile()
                email = profile.get("email", "Unknown")

                self._show_connected_status(email)
            except Exception as e:
                logger.error("CalendarOAuth", "check_connection", f"Error getting user info: {e}")

    def _on_provider_changed(self):
        """Handle provider selection change."""
        self._check_existing_connection()

    def _show_connected_status(self, email: str):
        """Show that user is already connected."""
        self.status_label.configure(text=f"Already connected as: {email}", text_color="green")
        self.connect_button.pack_forget()
        self.disconnect_button.pack(side="left", padx=5)
        self.info_label.configure(text="You can disconnect and reconnect with a different account if needed.")

    def _start_oauth_flow(self):
        """Start OAuth2 authentication flow."""
        provider = self.selected_provider.get()

        logger.info("CalendarOAuth", "start_flow", f"Starting direct OAuth flow for {provider}")

        # Disable buttons during flow
        self.connect_button.configure(state="disabled")
        self.cancel_button.configure(state="disabled")

        # Update status
        self.status_label.configure(text=f"Starting OAuth flow...", text_color="gray")
        self.progress_label.configure(text="Opening browser...")

        # Start OAuth flow in background thread
        self.oauth_thread = threading.Thread(target=self._run_oauth_flow, args=(provider,), daemon=True)
        self.oauth_thread.start()

        # Start progress animation
        self._animate_progress_dots()

    def _run_oauth_flow(self, provider: str):
        """
        Run OAuth flow in background thread.

        Args:
            provider: 'microsoft' or 'google'
        """
        try:
            # Create OAuth manager
            oauth_manager = OAuth2Manager(provider, port=8080)

            # Update UI
            self.after(0, self._update_progress, "Browser opened. Please log in and grant access...")

            # Run OAuth flow (this will block until user completes login)
            tokens = oauth_manager.authorize(timeout=120)

            # Save tokens
            self.token_manager.save_tokens(provider, tokens)

            # Get user info
            access_token = tokens["access_token"]
            if provider == "microsoft":
                api = MicrosoftGraphAPI(access_token)
                profile = api.get_user_profile()
                email = profile.get("email", "Unknown")
            else:
                email = "Unknown"  # Google not implemented yet

            # Update UI on main thread
            self.after(0, self._on_oauth_success, provider, email)

        except TimeoutError:
            self.after(0, self._on_oauth_error, "Connection timeout. Please try again.")
        except Exception as e:
            logger.error("CalendarOAuth", "oauth_flow", f"OAuth error: {e}")
            self.after(0, self._on_oauth_error, f"Authentication failed: {str(e)}")

    def _update_progress(self, message: str):
        """Update progress message (runs on main thread)."""
        self.progress_label.configure(text=message)

    def _animate_progress_dots(self, dots: int = 0):
        """
        Animate progress indicator with dots.

        Args:
            dots: Current number of dots (0-3)
        """
        if not self.oauth_thread or not self.oauth_thread.is_alive():
            return

        # Cycle through 0-3 dots
        dot_text = "." * (dots % 4)
        current_text = self.progress_label.cget("text")
        if current_text and not current_text.endswith("..."):
            base_text = current_text.rstrip(".")
            self.progress_label.configure(text=f"{base_text}{dot_text}")

        # Continue animation
        self.after(500, self._animate_progress_dots, dots + 1)

    def _on_oauth_success(self, provider: str, email: str):
        """
        Handle successful OAuth (runs on main thread).

        Args:
            provider: Calendar provider
            email: User email
        """
        logger.info("CalendarOAuth", "success", f"Calendar connected: {provider} - {email}")

        # Update UI
        self.progress_label.configure(text="Connected!", text_color="green")
        self.status_label.configure(text=f"Successfully connected as: {email}", text_color="green")

        # Show disconnect button
        self.connect_button.pack_forget()
        self.disconnect_button.pack(side="left", padx=5)
        self.cancel_button.configure(state="normal", text="Close")

        # Call callback if provided
        if self.callback:
            self.callback(provider, email)

        # Update info label
        self.info_label.configure(text="Calendar connected successfully! You can close this dialog.")

    def _on_oauth_error(self, error_message: str):
        """
        Handle OAuth error (runs on main thread).

        Args:
            error_message: Error message to display
        """
        logger.error("CalendarOAuth", "error", error_message)

        self.progress_label.configure(text="Error", text_color="red")
        self.status_label.configure(text=error_message, text_color="red")

        # Re-enable buttons
        self.connect_button.configure(state="normal")
        self.cancel_button.configure(state="normal")

    def _disconnect(self):
        """Disconnect from calendar provider."""
        provider = self.selected_provider.get()

        if self.token_manager.delete_tokens(provider):
            self.status_label.configure(text="Disconnected", text_color="gray")
            self.disconnect_button.pack_forget()
            self.connect_button.pack(side="left", padx=5)
            self.info_label.configure(text="Your browser will open for login. Grant calendar access when prompted.")

            logger.info("CalendarOAuth", "disconnect", f"Disconnected from {provider}")
        else:
            self.status_label.configure(text="Error disconnecting", text_color="red")


# Example usage for testing
if __name__ == "__main__":

    def on_connect_success(provider: str, email: str):
        print(f"[OK] Connected to {provider}: {email}")

    # Create test window
    root = ctk.CTk()
    root.geometry("400x200")
    root.title("Direct Calendar Connection Test")

    def open_dialog():
        dialog = DirectCalendarOAuthDialog(root, callback=on_connect_success)

    button = ctk.CTkButton(root, text="Connect Calendar (Direct OAuth)", command=open_dialog)
    button.pack(expand=True)

    root.mainloop()
