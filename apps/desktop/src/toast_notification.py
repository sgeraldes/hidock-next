"""
Toast Notification System for HiDock Next
Provides prominent, customizable toast notifications for user feedback.
"""

import customtkinter as ctk
import threading
import time
from typing import Literal, Optional


class ToastNotification:
    """
    A modern toast notification widget that appears temporarily over the main window.
    
    Features:
    - Customizable appearance (success, warning, error, info)
    - Auto-dismiss with configurable timeout
    - Manual dismiss with close button
    - Multiple toast stacking
    - Fade in/out animations
    - Responsive positioning
    """
    
    def __init__(
        self,
        parent: ctk.CTk,
        message: str,
        title: str = "",
        toast_type: Literal["success", "warning", "error", "info"] = "info",
        duration: int = 5000,  # milliseconds
        position: Literal["top-right", "top-left", "bottom-right", "bottom-left"] = "top-right",
        width: int = 450,
        height: int = 120
    ):
        self.parent = parent
        self.message = message
        self.title = title
        self.toast_type = toast_type
        self.duration = duration
        self.position = position
        self.width = width
        self.height = height
        
        self.toast_window: Optional[ctk.CTkToplevel] = None
        self.dismiss_timer: Optional[threading.Timer] = None
        self.is_dismissed = False
        
        # Color schemes for different toast types
        self.colors = {
            "success": {
                "bg": "#4CAF50",
                "text": "#FFFFFF",
                "border": "#45A049",
                "icon": "✓"
            },
            "warning": {
                "bg": "#FF9800", 
                "text": "#FFFFFF",
                "border": "#F57C00",
                "icon": "⚠"
            },
            "error": {
                "bg": "#F44336",
                "text": "#FFFFFF", 
                "border": "#E53935",
                "icon": "✕"
            },
            "info": {
                "bg": "#2196F3",
                "text": "#FFFFFF",
                "border": "#1976D2", 
                "icon": "ⓘ"
            }
        }
        
        self.create_toast()
    
    def _sanitize_text(self, text: str) -> str:
        """Sanitize text to ensure proper display in CustomTkinter labels."""
        if not text:
            return ""
        
        # Convert to string and handle encoding issues
        try:
            if isinstance(text, bytes):
                text = text.decode('utf-8', errors='replace')
            else:
                text = str(text)
        except Exception:
            text = str(text)
        
        # Remove or replace problematic characters
        # Keep only printable ASCII and common Unicode characters
        import re
        # Allow letters, numbers, spaces, common punctuation, and newlines
        text = re.sub(r'[^\w\s\-\.,!?;:()\[\]{}"/\\\'+=<>@#$%^&*~`|_\n]', ' ', text)
        
        # Clean up multiple spaces and newlines
        text = re.sub(r'\s+', ' ', text)  # Multiple spaces to single space
        text = re.sub(r'\n+', '\n', text)  # Multiple newlines to single newline
        text = text.strip()
        
        return text
    
    def _wrap_text(self, text: str, max_chars_per_line: int = 60) -> str:
        """Wrap text to prevent overflow in toast notifications."""
        # First sanitize the text
        text = self._sanitize_text(text)
        
        if len(text) <= max_chars_per_line:
            return text
        
        words = text.split(' ')
        lines = []
        current_line = []
        current_length = 0
        
        for word in words:
            if current_length + len(word) + len(current_line) <= max_chars_per_line:
                current_line.append(word)
                current_length += len(word)
            else:
                if current_line:
                    lines.append(' '.join(current_line))
                current_line = [word]
                current_length = len(word)
        
        if current_line:
            lines.append(' '.join(current_line))
        
        return '\n'.join(lines)
    
    def create_toast(self):
        """Create and display the toast notification."""
        if self.is_dismissed:
            return
            
        # Create toplevel window
        self.toast_window = ctk.CTkToplevel(self.parent)
        self.toast_window.title("")
        
        # Configure window
        self.toast_window.geometry(f"{self.width}x{self.height}")
        self.toast_window.resizable(False, False)
        self.toast_window.overrideredirect(True)  # Remove window decorations
        self.toast_window.wm_attributes("-topmost", True)  # Always on top
        
        # Bind to parent destruction to clean up properly
        self.parent.bind("<Destroy>", lambda e: self.dismiss(), add=True)
        
        # Set window transparency and styling
        try:
            self.toast_window.wm_attributes("-alpha", 0.95)  # Slight transparency
        except:
            pass  # Some systems don't support alpha
            
        # Position the toast
        self._position_toast()
        
        # Create main frame with color scheme
        color_scheme = self.colors[self.toast_type]
        
        main_frame = ctk.CTkFrame(
            self.toast_window,
            fg_color=color_scheme["bg"],
            border_width=2,
            border_color=color_scheme["border"],
            corner_radius=10
        )
        main_frame.pack(fill="both", expand=True, padx=2, pady=2)
        
        # Icon and close button frame
        header_frame = ctk.CTkFrame(main_frame, fg_color="transparent")
        header_frame.pack(fill="x", padx=10, pady=(5, 0))
        
        # Icon label
        icon_label = ctk.CTkLabel(
            header_frame,
            text=color_scheme["icon"],
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color=color_scheme["text"],
            width=20
        )
        icon_label.pack(side="left", padx=(0, 5))
        
        # Close button
        close_button = ctk.CTkButton(
            header_frame,
            text="×",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color=color_scheme["text"],
            fg_color="transparent",
            hover_color=color_scheme["border"],
            width=20,
            height=20,
            command=self.dismiss
        )
        close_button.pack(side="right")
        
        # Title label (if provided)
        if self.title:
            sanitized_title = self._sanitize_text(self.title)
            title_label = ctk.CTkLabel(
                main_frame,
                text=sanitized_title,
                font=ctk.CTkFont(size=12, weight="bold"),
                text_color=color_scheme["text"],
                anchor="w"
            )
            title_label.pack(fill="x", padx=15, pady=(0, 2))
        
        # Message label - Fixed text rendering with proper word wrapping and dynamic height
        wrapped_message = self._wrap_text(self.message, max_chars_per_line=60)
        
        # Calculate required height based on number of lines
        num_lines = wrapped_message.count('\n') + 1
        base_height = 80  # Base height for title, icon, padding
        line_height = 18  # Height per line of text
        required_height = base_height + (num_lines * line_height)
        
        # Resize toast if needed
        if required_height > self.height:
            self.height = min(required_height, 200)  # Cap at 200px max
            self.toast_window.geometry(f"{self.width}x{self.height}")
            self._position_toast()  # Reposition with new height
        
        message_label = ctk.CTkLabel(
            main_frame,
            text=wrapped_message,
            font=ctk.CTkFont(size=11),
            text_color=color_scheme["text"],
            anchor="nw",
            justify="left",
            wraplength=400
        )
        message_label.pack(fill="both", expand=True, padx=15, pady=(0, 5))
        
        # Auto-dismiss timer
        if self.duration > 0:
            self.dismiss_timer = threading.Timer(self.duration / 1000.0, self.dismiss)
            self.dismiss_timer.daemon = True
            self.dismiss_timer.start()
    
    def _position_toast(self):
        """Position the toast based on the specified position."""
        # Get parent window geometry
        self.parent.update_idletasks()
        parent_x = self.parent.winfo_x()
        parent_y = self.parent.winfo_y()
        parent_width = self.parent.winfo_width()
        parent_height = self.parent.winfo_height()
        
        # Calculate position relative to parent window
        margin = 20
        
        if self.position == "top-right":
            x = parent_x + parent_width - self.width - margin
            y = parent_y + margin
        elif self.position == "top-left":
            x = parent_x + margin
            y = parent_y + margin
        elif self.position == "bottom-right":
            x = parent_x + parent_width - self.width - margin
            y = parent_y + parent_height - self.height - margin
        elif self.position == "bottom-left":
            x = parent_x + margin
            y = parent_y + parent_height - self.height - margin
        else:
            # Default to top-right
            x = parent_x + parent_width - self.width - margin
            y = parent_y + margin
        
        # Get monitor bounds for the parent window
        # The parent window center determines which monitor we're on
        parent_center_x = parent_x + parent_width // 2
        parent_center_y = parent_y + parent_height // 2
        
        # For Windows multi-monitor setups, we need to be smarter about boundaries
        # Instead of using screen dimensions, ensure toast stays within parent window's monitor
        # by keeping it relative to the parent window bounds
        
        # Ensure the toast doesn't go off the left edge of the parent's monitor
        if x < parent_x - parent_width:
            x = parent_x + margin
        
        # Ensure the toast doesn't go off the top edge 
        if y < 0:
            y = margin
            
        # Set the position
        self.toast_window.geometry(f"+{x}+{y}")
    
    def dismiss(self):
        """Dismiss the toast notification."""
        if self.is_dismissed:
            return
            
        self.is_dismissed = True
        
        # Cancel timer if running
        if self.dismiss_timer:
            self.dismiss_timer.cancel()
        
        # Destroy window safely
        try:
            if self.toast_window and self.toast_window.winfo_exists():
                self.toast_window.destroy()
        except Exception:
            # Window might already be destroyed
            pass


class ToastManager:
    """
    Manages multiple toast notifications to prevent overlap and provide stacking.
    """
    
    def __init__(self, parent: ctk.CTk):
        self.parent = parent
        self.active_toasts = []
        self.toast_spacing = 90  # Vertical spacing between toasts
    
    def show_toast(
        self,
        message: str,
        title: str = "",
        toast_type: Literal["success", "warning", "error", "info"] = "info",
        duration: int = 5000,
        position: Literal["top-right", "top-left", "bottom-right", "bottom-left"] = "top-right"
    ) -> ToastNotification:
        """
        Show a toast notification with automatic stacking.
        
        Args:
            message: The main message to display
            title: Optional title for the toast
            toast_type: Type of toast (success, warning, error, info)
            duration: How long to show the toast in milliseconds (0 = manual dismiss only)
            position: Where to position the toast
        
        Returns:
            ToastNotification: The created toast instance
        """
        # Calculate offset for stacking
        offset = len(self.active_toasts) * self.toast_spacing
        
        # Create toast with offset
        toast = ToastNotification(
            self.parent,
            message=message,
            title=title,
            toast_type=toast_type,
            duration=duration,
            position=position
        )
        
        # Adjust position for stacking
        if toast.toast_window and offset > 0:
            current_geometry = toast.toast_window.geometry()
            # Parse geometry string (+x+y)
            parts = current_geometry.split('+')
            if len(parts) >= 3:
                x = int(parts[1])
                y = int(parts[2]) + offset
                toast.toast_window.geometry(f"+{x}+{y}")
        
        # Add to active toasts
        self.active_toasts.append(toast)
        
        # Set up cleanup when toast is dismissed
        original_dismiss = toast.dismiss
        def cleanup_dismiss():
            original_dismiss()
            if toast in self.active_toasts:
                self.active_toasts.remove(toast)
                self._restack_toasts()
        
        toast.dismiss = cleanup_dismiss
        
        return toast
    
    def _restack_toasts(self):
        """Restack remaining toasts to fill gaps."""
        # This could be enhanced to animate toasts moving up
        # For now, we just rely on the natural stacking
        pass
    
    def dismiss_all(self):
        """Dismiss all active toasts."""
        for toast in self.active_toasts.copy():
            toast.dismiss()
    
    def show_success(self, message: str, title: str = "Success", duration: int = 3000):
        """Show a success toast."""
        return self.show_toast(message, title, "success", duration)
    
    def show_warning(self, message: str, title: str = "Warning", duration: int = 5000):
        """Show a warning toast.""" 
        return self.show_toast(message, title, "warning", duration)
    
    def show_error(self, message: str, title: str = "Error", duration: int = 7000):
        """Show an error toast (longer duration)."""
        return self.show_toast(message, title, "error", duration)
    
    def show_info(self, message: str, title: str = "Info", duration: int = 4000):
        """Show an info toast."""
        return self.show_toast(message, title, "info", duration)


# Convenience functions for quick usage
def show_toast(
    parent: ctk.CTk,
    message: str,
    title: str = "",
    toast_type: Literal["success", "warning", "error", "info"] = "info",
    duration: int = 5000
) -> ToastNotification:
    """Quick function to show a single toast."""
    return ToastNotification(parent, message, title, toast_type, duration)


def show_error_toast(parent: ctk.CTk, message: str, title: str = "Connection Error", duration: int = 7000):
    """Quick function to show an error toast for connection issues."""
    return ToastNotification(parent, message, title, "error", duration)


def show_success_toast(parent: ctk.CTk, message: str, title: str = "Success", duration: int = 3000):
    """Quick function to show a success toast."""
    return ToastNotification(parent, message, title, "success", duration)