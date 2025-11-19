# hidock_login_dialog.py
"""
HiDock Login Dialog.

Provides a user-friendly login interface for authenticating with HiDock/HiNotes backend.

Features:
- Username/email and password inputs
- "Remember me" checkbox
- Show/hide password toggle
- Loading indicator during login
- Error message display
- Success callback
"""

import threading
from typing import Callable, Optional

import customtkinter as ctk

from config_and_logger import logger
from hidock_auth_service import HiDockAuthService


class HiDockLoginDialog(ctk.CTkToplevel):
    """
    Dialog window for HiDock account login.

    This dialog handles user authentication and token management.
    """

    def __init__(self, parent, callback: Optional[Callable] = None):
        """
        Initialize login dialog.

        Args:
            parent: Parent window
            callback: Optional callback function called on success: callback(access_token, user_info)
        """
        super().__init__(parent)

        self.callback = callback
        self.auth_service = HiDockAuthService()
        self.is_logging_in = False

        # Configure dialog window
        self.title("Login to HiDock")
        self.geometry("450x400")
        self.resizable(False, False)

        # Center on parent
        self.transient(parent)
        self.grab_set()

        self._setup_ui()

        # Check if already logged in
        self.after(100, self._check_existing_login)

        logger.info("HiDockLogin", "init", "Login dialog opened")

    def _setup_ui(self):
        """Setup dialog UI components."""

        # Main container with padding
        main_frame = ctk.CTkFrame(self, fg_color="transparent")
        main_frame.pack(fill="both", expand=True, padx=30, pady=30)

        # Title
        title_label = ctk.CTkLabel(main_frame, text="Login to HiDock", font=("Segoe UI", 20, "bold"))
        title_label.pack(pady=(0, 10))

        # Subtitle
        subtitle_label = ctk.CTkLabel(
            main_frame, text="Sign in with your HiDock account", font=("Segoe UI", 11), text_color="gray70"
        )
        subtitle_label.pack(pady=(0, 25))

        # Username/Email field
        ctk.CTkLabel(main_frame, text="Email or Username:", font=("Segoe UI", 11), anchor="w").pack(
            fill="x", pady=(0, 5)
        )

        self.username_entry = ctk.CTkEntry(
            main_frame, height=35, font=("Segoe UI", 11), placeholder_text="your.email@example.com"
        )
        self.username_entry.pack(fill="x", pady=(0, 15))

        # Password field
        password_frame = ctk.CTkFrame(main_frame, fg_color="transparent")
        password_frame.pack(fill="x", pady=(0, 5))

        ctk.CTkLabel(password_frame, text="Password:", font=("Segoe UI", 11), anchor="w").pack(side="left")

        self.show_password_var = ctk.BooleanVar(value=False)
        self.show_password_checkbox = ctk.CTkCheckBox(
            password_frame,
            text="Show",
            variable=self.show_password_var,
            command=self._toggle_password_visibility,
            width=60,
            font=("Segoe UI", 10),
        )
        self.show_password_checkbox.pack(side="right")

        self.password_entry = ctk.CTkEntry(
            main_frame, height=35, font=("Segoe UI", 11), show="●", placeholder_text="Enter your password"
        )
        self.password_entry.pack(fill="x", pady=(0, 15))

        # Remember me checkbox
        self.remember_me_var = ctk.BooleanVar(value=True)
        self.remember_me_checkbox = ctk.CTkCheckBox(
            main_frame, text="Keep me logged in", variable=self.remember_me_var, font=("Segoe UI", 11)
        )
        self.remember_me_checkbox.pack(anchor="w", pady=(0, 20))

        # Status/error label
        self.status_label = ctk.CTkLabel(main_frame, text="", font=("Segoe UI", 10), wraplength=380)
        self.status_label.pack(pady=(0, 15))

        # Buttons frame
        button_frame = ctk.CTkFrame(main_frame, fg_color="transparent")
        button_frame.pack(fill="x", pady=(10, 0))

        self.login_button = ctk.CTkButton(
            button_frame, text="Login", command=self._do_login, width=140, height=40, font=("Segoe UI", 13, "bold")
        )
        self.login_button.pack(side="left", expand=True, padx=(0, 5))

        self.cancel_button = ctk.CTkButton(
            button_frame,
            text="Cancel",
            command=self.destroy,
            width=100,
            height=40,
            fg_color="gray",
            hover_color="darkgray",
        )
        self.cancel_button.pack(side="left", expand=True, padx=(5, 0))

        # Bind Enter key to login
        self.username_entry.bind("<Return>", lambda e: self.password_entry.focus())
        self.password_entry.bind("<Return>", lambda e: self._do_login())

    def _toggle_password_visibility(self):
        """Toggle password visibility."""
        if self.show_password_var.get():
            self.password_entry.configure(show="")
        else:
            self.password_entry.configure(show="●")

    def _check_existing_login(self):
        """Check if user is already logged in."""
        if self.auth_service.is_logged_in():
            user_info = self.auth_service.get_user_info()
            username = user_info.get("email") or user_info.get("username", "")

            if username:
                self.username_entry.insert(0, username)
                self.password_entry.focus()

                self.status_label.configure(text=f"Previously logged in as: {username}", text_color="gray70")

    def _do_login(self):
        """Initiate login process."""
        if self.is_logging_in:
            return

        username = self.username_entry.get().strip()
        password = self.password_entry.get()

        # Validation
        if not username:
            self.status_label.configure(text="⚠️ Please enter your email or username", text_color="orange")
            self.username_entry.focus()
            return

        if not password:
            self.status_label.configure(text="⚠️ Please enter your password", text_color="orange")
            self.password_entry.focus()
            return

        # Start login in background thread
        self.is_logging_in = True
        self._set_loading_state(True)

        login_thread = threading.Thread(
            target=self._login_worker, args=(username, password, self.remember_me_var.get()), daemon=True
        )
        login_thread.start()

    def _login_worker(self, username: str, password: str, remember_me: bool):
        """Login worker thread (runs in background)."""
        try:
            success, token, error = self.auth_service.login(username, password, remember_me)

            # Update UI on main thread
            self.after(0, self._on_login_complete, success, token, error)

        except Exception as e:
            logger.error("HiDockLogin", "login_worker", f"Unexpected error: {e}")
            self.after(0, self._on_login_complete, False, None, str(e))

    def _on_login_complete(self, success: bool, token: Optional[str], error: Optional[str]):
        """Handle login completion (runs on main thread)."""
        self.is_logging_in = False
        self._set_loading_state(False)

        if success:
            self.status_label.configure(text="✓ Login successful!", text_color="green")

            logger.info("HiDockLogin", "success", "Login successful")

            # Call callback if provided
            if self.callback:
                user_info = self.auth_service.get_user_info()
                self.callback(token, user_info)

            # Close dialog after short delay
            self.after(1500, self.destroy)

        else:
            # Show error message
            error_msg = error or "Login failed. Please try again."
            self.status_label.configure(text=f"✗ {error_msg}", text_color="red")

            logger.warning("HiDockLogin", "failed", error_msg)

            # Re-enable password field for retry
            self.password_entry.delete(0, "end")
            self.password_entry.focus()

    def _set_loading_state(self, loading: bool):
        """Set UI to loading state."""
        if loading:
            self.login_button.configure(text="Logging in...", state="disabled")
            self.cancel_button.configure(state="disabled")
            self.username_entry.configure(state="disabled")
            self.password_entry.configure(state="disabled")
            self.remember_me_checkbox.configure(state="disabled")

            self.status_label.configure(text="⏳ Authenticating...", text_color="gray70")

        else:
            self.login_button.configure(text="Login", state="normal")
            self.cancel_button.configure(state="normal")
            self.username_entry.configure(state="normal")
            self.password_entry.configure(state="normal")
            self.remember_me_checkbox.configure(state="normal")


class HiDockAccountManager:
    """
    Manages HiDock account authentication for the desktop app.

    Provides high-level methods for login, logout, and session management.
    """

    def __init__(self):
        """Initialize account manager."""
        self.auth_service = HiDockAuthService()

    def is_logged_in(self) -> bool:
        """Check if user is logged in."""
        return self.auth_service.is_logged_in()

    def get_access_token(self) -> Optional[str]:
        """Get current access token."""
        return self.auth_service.get_stored_token()

    def get_user_info(self) -> Optional[dict]:
        """Get current user information."""
        return self.auth_service.get_user_info()

    def show_login_dialog(self, parent, callback: Optional[Callable] = None):
        """
        Show login dialog.

        Args:
            parent: Parent window
            callback: Optional callback function called on success
        """
        dialog = HiDockLoginDialog(parent, callback)
        return dialog

    def logout(self):
        """Logout current user."""
        self.auth_service.logout()
        logger.info("HiDockAccount", "logout", "User logged out")

    def validate_session(self) -> bool:
        """Validate current session."""
        return self.auth_service.validate_token()


# Example usage for testing
if __name__ == "__main__":
    import tkinter as tk

    def on_login_success(token: str, user_info: dict):
        print(f"\n✓ Login successful!")
        print(f"Token: {token[:20]}...{token[-20:]}")
        print(f"User: {user_info}")

    # Create test window
    root = ctk.CTk()
    root.geometry("600x400")
    root.title("HiDock Login Test")

    # Account manager
    manager = HiDockAccountManager()

    # Status label
    status_label = ctk.CTkLabel(root, text="", font=("Segoe UI", 12))
    status_label.pack(pady=20)

    def update_status():
        if manager.is_logged_in():
            user_info = manager.get_user_info()
            email = user_info.get("email") or user_info.get("username", "Unknown")
            status_label.configure(text=f"Logged in as: {email}", text_color="green")
            login_btn.configure(text="Logout", command=do_logout)
        else:
            status_label.configure(text="Not logged in", text_color="gray")
            login_btn.configure(text="Login", command=do_login)

    def do_login():
        manager.show_login_dialog(root, callback=lambda t, u: (on_login_success(t, u), update_status()))

    def do_logout():
        manager.logout()
        update_status()

    login_btn = ctk.CTkButton(root, text="Login", command=do_login, width=200, height=40)
    login_btn.pack(pady=10)

    # Initial status check
    update_status()

    root.mainloop()
