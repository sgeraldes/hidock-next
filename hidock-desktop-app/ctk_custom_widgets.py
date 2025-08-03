"""
CustomTkinter Custom Widgets
----------------------------

This module contains custom widget implementations for use with CustomTkinter.
This module contains custom widget implementations for use with CustomTkinter.
Currently includes CTkBanner.
"""

import os
import sys  # For platform-specific transparency
import tkinter  # ADDED: For tkinter.TclError

import customtkinter as ctk
from PIL import Image

from config_and_logger import logger

# --- Constants for CTkBanner ---
CURRENT_PATH = os.path.dirname(os.path.realpath(__file__))
# Assuming 'icons' folder is in the same directory as this script (project root)
ICON_DIR = os.path.join(CURRENT_PATH, "icons")

ICON_PATH = {
    "close": (
        os.path.join(ICON_DIR, "close_black.png"),
        os.path.join(ICON_DIR, "close_white.png"),
    ),
    "info": os.path.join(ICON_DIR, "info.png"),
    "warning": os.path.join(ICON_DIR, "warning.png"),
    "error": os.path.join(ICON_DIR, "error.png"),
}

DEFAULT_BTN = {
    "fg_color": "transparent",
    "hover": False,
    "compound": "left",
    "anchor": "w",
}

LINK_BTN = {
    **DEFAULT_BTN,
    "width": 70,
    "height": 25,
    "text_color": ("#3574F0", "#87CEFA"),
}  # Adjusted dark mode color for visibility


# --- Helper Functions ---
def calculate_toplevel_position(root, frame_width, frame_height, horizontal, vertical, padx=10, pady=10):
    """
    Calculates x, y coordinates for placing a Toplevel window relative
    to its root/master window based on horizontal and vertical alignment.
    """
    root.update_idletasks()  # Ensure root window dimensions are up-to-date
    root_width = root.winfo_width()
    root_height = root.winfo_height()
    # frame_width and frame_height are passed as arguments, no need to get them from 'frame' object.
    # frame_width = frame.winfo_reqwidth() # REMOVED
    # frame_height = frame.winfo_reqheight() # REMOVED

    x_val, y_val = 0, 0

    if horizontal == "left":
        x_val = padx
    elif horizontal == "right":
        x_val = root_width - frame_width - padx
    elif horizontal == "center":
        x_val = (root_width - frame_width) // 2

    if vertical == "top":
        y_val = pady
    elif vertical == "bottom":
        y_val = root_height - frame_height - pady
    elif vertical == "center":
        y_val = (root_height - frame_height) // 2

    return x_val, y_val


class CTkBanner(ctk.CTkToplevel):  # MODIFIED: Inherit from CTkToplevel
    """

    A banner widget for displaying dismissible messages within a master window.
    Adapted from reference ctk_components. Now a Toplevel for fade effects and progress bar.
    """

    FADE_ANIMATION_DURATION_MS = 300
    FADE_ANIMATION_STEPS = 15
    PROGRESS_BAR_UPDATE_INTERVAL_MS = 50

    def __init__(
        self,
        master,
        state: str = "info",
        title: str = "Title",
        # btn1 and btn2 removed as per new requirement
        side: str = "top_center",
        auto_dismiss_after_ms: int = None,
        width: int = None,  # Allow custom width
    ):
        """
        Initializes a new CTkBanner instance.

        Args:
        master: The master window (usually a CTk or CTkToplevel) to which
        this banner is logically attached for positioning.
        state (str): The state of the banner ('info', 'warning', 'error').
        Determines the icon used.
        title (str): The main text message displayed in the banner.
        side (str): Positioning relative to the master ('top_center', 'bottom_right', etc.).
        auto_dismiss_after_ms (int, optional): Time in milliseconds after which the banner
        automatically dismisses. If None or <= 0, it requires manual dismissal.
        width (int, optional): Explicit width for the banner. If None, width is estimated.
        """
        super().__init__(master)
        self.master_window = master

        # Estimate width based on title length, or set a default.
        if width is None:
            estimated_title_width = len(title) * 7  # Approx 7 pixels per character
            self.banner_width = max(300, min(600, estimated_title_width + 60))  # Adjusted for no action buttons
        else:
            self.banner_width = width

        self.progress_bar_height = 5
        self.banner_height = 60 + self.progress_bar_height  # Title area + progress bar

        self.overrideredirect(True)
        self.attributes("-alpha", 0.0)  # Start fully transparent
        self.wm_attributes("-topmost", True)  # Keep it on top

        # Platform-specific transparency for rounded corners on the Toplevel itself
        if sys.platform.startswith("win"):
            # For Windows, fg_color of the Toplevel itself can be made transparent.
            # The content_frame will provide the visible background.
            self.transparent_color_for_toplevel = self._apply_appearance_mode(self.cget("fg_color"))
            self.attributes("-transparentcolor", self.transparent_color_for_toplevel)
        elif sys.platform.startswith("darwin"):  # macOS
            self.attributes("-transparent", True)
            # On macOS, the Toplevel itself can be transparent and the content_frame provides shape.
        # Linux transparency for shaped windows can be complex and compositor-dependent.
        # For simplicity, we might not get perfect rounded corners on all Linux setups.

        # Content Frame: This frame will hold all visible elements and have the rounded corners.
        self.content_frame_bg = self._apply_appearance_mode(ctk.ThemeManager.theme["CTkFrame"]["fg_color"])
        self.content_frame = ctk.CTkFrame(
            self,
            width=self.banner_width,
            height=self.banner_height,
            corner_radius=5,
            border_width=1,
            fg_color=self.content_frame_bg,
        )
        self.content_frame.pack(expand=True, fill="both")

        self.content_frame.grid_propagate(False)
        self.content_frame.grid_columnconfigure(0, weight=1)  # Title label column
        self.content_frame.grid_columnconfigure(1, weight=0)  # Close button column (fixed width)
        self.content_frame.grid_rowconfigure(0, weight=1)  # Title row (takes most space)
        self.content_frame.grid_rowconfigure(1, weight=0)  # Progress bar row (fixed height)

        # self.event = None # Not used with only a close button
        self._auto_dismiss_timer = None
        self._progress_bar_timer = None
        self.auto_dismiss_after_ms = auto_dismiss_after_ms
        self._current_alpha = 0.0
        self._is_dismissing = False  # Flag to prevent multiple dismiss actions

        # Corrected placement logic parsing for "side"
        # side is expected as "vertical_horizontal", e.g., "top_center", "bottom_right"
        parts = side.split("_")
        if len(parts) == 2:
            self.vertical = parts[0]  # e.g., "bottom" from "bottom_right"
            self.horizontal = parts[1]  # e.g., "right" from "bottom_right"
        elif len(parts) == 1:  # Handle single word like "top", "center", "right"
            single_part = parts[0].lower()  # Normalize to lowercase
            if single_part in ["top", "bottom"]:
                self.vertical = single_part
                self.horizontal = "center"  # Default horizontal if only vertical is given
            elif single_part in ["left", "right"]:
                self.vertical = "center"  # Default vertical if only horizontal is given
                self.horizontal = single_part
            elif single_part == "center":
                self.vertical = "center"
                self.horizontal = "center"
            else:  # Fallback for unknown single word
                logger.warning(
                    "CTkBanner",
                    "__init__",
                    f"Unknown side value '{side}'. Defaulting to top_center.",
                )
                self.vertical = "top"
                self.horizontal = "center"
        else:  # Fallback for malformed side (e.g. too many parts or empty)
            logger.warning(
                "CTkBanner",
                "__init__",
                f"Malformed side value '{side}'. Defaulting to top_center.",
            )
            self.vertical = "top"
            self.horizontal = "center"

        icon_file = ICON_PATH.get(state.lower())
        if isinstance(icon_file, tuple):  # For icons with light/dark variants
            self.icon = ctk.CTkImage(Image.open(icon_file[0]), Image.open(icon_file[1]), (24, 24))
        elif icon_file and os.path.exists(icon_file):
            self.icon = ctk.CTkImage(Image.open(icon_file), Image.open(icon_file), (24, 24))
        else:  # Fallback icon
            self.icon = ctk.CTkImage(Image.open(ICON_PATH["info"]), Image.open(ICON_PATH["info"]), (24, 24))

        close_icon_paths = ICON_PATH.get("close")
        if close_icon_paths and os.path.exists(close_icon_paths[0]) and os.path.exists(close_icon_paths[1]):
            self.close_icon = ctk.CTkImage(
                Image.open(close_icon_paths[0]),
                Image.open(close_icon_paths[1]),
                (20, 20),
            )
        else:
            self.close_icon = None  # No close icon if paths are invalid

        # Title Label
        self.title_label = ctk.CTkLabel(
            self.content_frame,  # MODIFIED: Parent is content_frame
            text=f"  {title}",
            font=("", 14),
            image=self.icon,
            compound="left",
            wraplength=self.banner_width - 60,  # Adjusted wraplength for close button
        )
        self.title_label.grid(
            row=0,
            column=0,
            sticky="nsew",
            padx=(15, 5),
            pady=(10, 5),  # Span across available space
        )

        # Close Button
        if self.close_icon:
            self.close_btn = ctk.CTkButton(
                self.content_frame,  # MODIFIED: Parent is content_frame
                text="",
                image=self.close_icon,
                width=20,
                height=20,
                hover=False,
                fg_color="transparent",
                command=self._initiate_dismissal,  # MODIFIED: New dismiss handler
            )
            self.close_btn.grid(row=0, column=1, sticky="ne", padx=(0, 10), pady=10)
        else:  # If no close icon, create a text button
            self.close_btn = ctk.CTkButton(
                self.content_frame,  # MODIFIED: Parent is content_frame
                text="X",
                width=25,
                height=25,
                command=self._initiate_dismissal,  # MODIFIED: New dismiss handler
            )
            self.close_btn.grid(row=0, column=1, sticky="ne", padx=(0, 10), pady=10)

        # Progress Bar
        self.progress_bar = ctk.CTkProgressBar(
            self.content_frame, height=self.progress_bar_height, corner_radius=0
        )  # Flat bar
        self.progress_bar.set(0)  # Start empty
        self.progress_bar.grid(row=1, column=0, columnspan=2, sticky="sew", padx=5, pady=(0, 5))

        self.update_position()  # Initial positioning
        self.bind_configure()  # Call to store the binding ID

        # Auto-dismiss timer is started in show()

    def update_position(self, _event=None):
        """
        Re-calculates and updates the banner's position within its master window.

        This method is typically called when the master window is resized or reconfigured.
        The `_event` parameter is passed by Tkinter but not used in this implementation.
        """
        if self.winfo_exists():
            # Calculate position relative to the master window's client area
            relative_x, relative_y = calculate_toplevel_position(
                self.master_window,
                self.banner_width,
                self.banner_height,
                self.horizontal,
                self.vertical,
            )

            # Get the master window's absolute screen coordinates
            master_x = self.master_window.winfo_x()
            master_y = self.master_window.winfo_y()

            # Calculate absolute screen coordinates for the banner
            absolute_x = master_x + relative_x
            absolute_y = master_y + relative_y
            self.geometry(f"{self.banner_width}x{self.banner_height}+{absolute_x}+{absolute_y}")
            self.update_idletasks()

    def _initiate_dismissal(self):
        """
        Handles the close button click or auto-dismiss timer expiration.
        Initiates the fade-out animation.
        """
        if self._is_dismissing:  # Prevent multiple dismiss calls
            return
        self._is_dismissing = True

        if self._auto_dismiss_timer:
            self.after_cancel(self._auto_dismiss_timer)
            self._auto_dismiss_timer = None
        if self._progress_bar_timer:
            self.after_cancel(self._progress_bar_timer)
            self._progress_bar_timer = None

        self._animate_fade(target_alpha=0.0, on_complete=self._destroy_banner)

    def dismiss(self):  # NEW PUBLIC METHOD
        """Public method to dismiss the banner."""
        self._initiate_dismissal()

    def _destroy_banner(self):
        """
        Actually destroys the banner window after fade-out.

        Cancels the auto-dismiss timer if active, unbinds the window configure event,
        destroys the banner widget, and stores the event data (e.g., the text of the
        button that was clicked).

        Args:
            event_data: Data associated with the event, typically the text of the button clicked.
        """
        try:
            # Ensure _configure_binding_id exists before trying to use it
            if hasattr(self, "_configure_binding_id") and self._configure_binding_id:
                self.master_window.unbind("<Configure>", self._configure_binding_id)
        except (
            AttributeError,
            TypeError,
            tkinter.TclError,
        ):  # If _configure_binding_id was not stored or unbind failed
            pass  # Silently ignore if unbinding fails (e.g. already unbound)
        if self.winfo_exists():
            self.destroy()
        # self.event = event_data # Not needed as only close button exists

    def _animate_fade(self, target_alpha: float, on_complete: callable = None):
        """
        Animates the transparency of the banner window.

        Args:
        target_alpha (float): The final alpha value (0.0 to 1.0).
        on_complete (callable, optional): A function to call once the animation
        reaches the target alpha.
        """
        current_alpha = self._current_alpha
        alpha_step = (target_alpha - current_alpha) / self.FADE_ANIMATION_STEPS

        def _step_fade():
            nonlocal current_alpha
            current_alpha += alpha_step

            # Clamp alpha and check completion
            if (
                (alpha_step > 0 and current_alpha >= target_alpha)
                or (alpha_step < 0 and current_alpha <= target_alpha)
                or alpha_step == 0
            ):
                current_alpha = target_alpha
                if self.winfo_exists():
                    self.attributes("-alpha", current_alpha)
                self._current_alpha = current_alpha
                if on_complete:
                    on_complete()
            else:
                if self.winfo_exists():
                    self.attributes("-alpha", current_alpha)
                self._current_alpha = current_alpha
                if self.winfo_exists():
                    self.after(
                        self.FADE_ANIMATION_DURATION_MS // self.FADE_ANIMATION_STEPS,
                        _step_fade,
                    )

        if self.winfo_exists():
            _step_fade()
        elif on_complete:  # If window destroyed before animation, still call on_complete
            on_complete()

    def _update_auto_dismiss_progress(self, current_time_ms=0):
        """
        Updates the progress bar for auto-dismiss and schedules the next update.

        Args:
        current_time_ms (int): The elapsed time in milliseconds since the
        auto-dismiss timer started.
        """
        if not self.winfo_exists() or not self.auto_dismiss_after_ms or self.auto_dismiss_after_ms <= 0:
            if hasattr(self, "progress_bar") and self.progress_bar.winfo_exists():
                self.progress_bar.set(0)
            return

        progress = min(1.0, current_time_ms / self.auto_dismiss_after_ms)
        if hasattr(self, "progress_bar") and self.progress_bar.winfo_exists():
            self.progress_bar.set(progress)

        if current_time_ms < self.auto_dismiss_after_ms:
            self._progress_bar_timer = self.after(
                self.PROGRESS_BAR_UPDATE_INTERVAL_MS,
                lambda: self._update_auto_dismiss_progress(current_time_ms + self.PROGRESS_BAR_UPDATE_INTERVAL_MS),
            )
        elif hasattr(self, "progress_bar") and self.progress_bar.winfo_exists():  # Progress complete
            self.progress_bar.set(1.0)

    def show(self):
        """Ensure the banner is raised to the top and visible."""
        if not self.winfo_exists():
            return  # Don't try to show if already destroyed

        self.deiconify()  # Make Toplevel visible if it was withdrawn
        self.lift()
        self.wm_attributes("-topmost", True)  # Keep it on top

        self._animate_fade(target_alpha=1.0)  # Start fade-in

        if self.auto_dismiss_after_ms and self.auto_dismiss_after_ms > 0:
            if self._auto_dismiss_timer:
                self.after_cancel(self._auto_dismiss_timer)
            if self._progress_bar_timer:
                self.after_cancel(self._progress_bar_timer)
            self._auto_dismiss_timer = self.after(self.auto_dismiss_after_ms, self._initiate_dismissal)
            self._update_auto_dismiss_progress()  # Start progress bar animation

    def bind_configure(self):
        """
        Binds the `update_position` method to the master window's `<Configure>` event
        and stores the binding ID. This allows the banner to reposition itself
        when the master window's size or position changes. The stored ID is used
        to unbind the event later, preventing potential issues when the banner is destroyed.
        """
        self._configure_binding_id = self.master_window.bind("<Configure>", self.update_position, add="+")
