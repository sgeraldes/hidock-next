"""
Settings Dialog for the HiDock Explorer Tool.

This module defines the `SettingsDialog` class, a customtkinter.CTkToplevel
window that allows users to configure various application settings.
It interacts with the main `HiDockToolGUI` to load, display, and apply
changes to general application preferences, connection parameters,
operation timeouts, device-specific behaviors, and logging options.
"""

import tkinter
from tkinter import filedialog, messagebox
import os
import threading  # For device settings apply thread
import usb.core  # For specific exception handling
import customtkinter as ctk

from config_and_logger import logger, Logger, save_config  # For type hint and logger instance


class SettingsDialog(ctk.CTkToplevel):
    """
    A top-level window for configuring application settings.

    This dialog allows users to modify general application preferences,
    connection parameters, operation timeouts, device-specific behaviors,
    and logging options. It interacts with the main GUI instance to
    load initial settings and apply changes.
    """

    def __init__(self, parent_gui, initial_config, hidock_instance, *args, **kwargs):
        """
        Initializes the SettingsDialog window.

        Args:
        parent_gui: The main HiDockToolGUI instance.
        initial_config (dict): A snapshot of the configuration dictionary
        when the dialog was opened.
        hidock_instance: The HiDockJensen instance for device interaction.
        *args: Variable length argument list for CTkToplevel.
        **kwargs: Arbitrary keyword arguments for CTkToplevel.
        """
        super().__init__(parent_gui, *args, **kwargs)
        self.parent_gui = parent_gui  # Reference to the main HiDockToolGUI instance
        self.initial_config_snapshot = initial_config  # A snapshot of config at dialog open
        self.dock = hidock_instance  # HiDockJensen instance

        self.title("Application Settings")
        self.transient(parent_gui)
        self.attributes("-alpha", 0)  # Start fully transparent for fade-in
        self.grab_set()

        self._settings_dialog_initializing = True  # Flag to prevent premature updates
        self.settings_changed_tracker = [False]  # Use a list to pass by reference

        # Store current values of relevant CTk Variables from parent_gui for local use and reset
        self.local_vars = {}
        self._clone_parent_vars()

        # Store the initial download directory separately for comparison
        self.initial_download_directory = self.parent_gui.download_directory
        self.current_dialog_download_dir = [
            self.parent_gui.download_directory
        ]  # Mutable for dialog changes

        # Initialize attributes that will hold widget instances later
        self.current_dl_dir_label_settings = None
        self.settings_device_combobox = None
        self.auto_record_checkbox = None
        self.auto_play_checkbox = None
        self.bt_tone_checkbox = None
        self.notification_sound_checkbox = None

        self._fetched_device_settings_for_dialog = {}  # Cache for device settings

        self._create_settings_widgets()

        # If device is connected, load its specific settings
        if self.dock.is_connected():
            threading.Thread(
                target=self._load_device_settings_for_dialog_thread, daemon=True
            ).start()
        else:
            self._finalize_initialization_and_button_states()  # No async load needed

        self.bind(
            "<Return>",
            lambda event: (
                self.ok_button.invoke() if self.ok_button.cget("state") == "normal" else None
            ),
        )
        self.bind("<Escape>", lambda event: self.cancel_close_button.invoke())

        self.after(10, self._adjust_window_size_and_fade_in)

    def _adjust_window_size_and_fade_in(self):
        """
        Adjusts the window size based on content and performs a fade-in animation.

        Ensures the window is visible and focused after initialization.
        """
        self.update_idletasks()  # Ensure widgets are sized
        min_width, min_height = 650, 600
        req_width = self.winfo_reqwidth() + 40  # Add padding
        req_height = self.winfo_reqheight() + 40
        self.geometry(f"{max(min_width, req_width)}x{max(min_height, req_height)}")
        self.minsize(min_width, min_height)
        self.attributes("-alpha", 1.0)  # Fade in
        self.focus_set()

    def _clone_parent_vars(self):
        """Clones relevant CTk Variables from the parent GUI for local modification and reset."""
        vars_to_clone_map = {
            "autoconnect_var": "BooleanVar",
            "logger_processing_level_var": "StringVar",
            "selected_vid_var": "IntVar",
            "selected_pid_var": "IntVar",
            "target_interface_var": "IntVar",
            "recording_check_interval_var": "IntVar",
            "default_command_timeout_ms_var": "IntVar",
            "file_stream_timeout_s_var": "IntVar",
            "auto_refresh_files_var": "BooleanVar",
            "auto_refresh_interval_s_var": "IntVar",
            "quit_without_prompt_var": "BooleanVar",
            "appearance_mode_var": "StringVar",
            "color_theme_var": "StringVar",
            "suppress_console_output_var": "BooleanVar",
            "suppress_gui_log_output_var": "BooleanVar",
            "device_setting_auto_record_var": "BooleanVar",
            "device_setting_auto_play_var": "BooleanVar",
            "device_setting_bluetooth_tone_var": "BooleanVar",
            "device_setting_notification_sound_var": "BooleanVar",
        }
        for var_name, var_type_str in vars_to_clone_map.items():
            if hasattr(self.parent_gui, var_name):
                parent_var = getattr(self.parent_gui, var_name)
                var_class = getattr(ctk, var_type_str)  # Get ctk.StringVar, ctk.BooleanVar etc.
                self.local_vars[var_name] = var_class(value=parent_var.get())
                self.local_vars[var_name].trace_add("write", self._update_button_states_on_change)

        # Clone log color variables
        for level_key in Logger.LEVELS:  # Iterate directly over dictionary keys
            level_lower = level_key.lower()
            for mode in ["light", "dark"]:
                var_name = f"log_color_{level_lower}_{mode}_var"
                if hasattr(self.parent_gui, var_name):
                    parent_var = getattr(self.parent_gui, var_name)
                    self.local_vars[var_name] = ctk.StringVar(value=parent_var.get())
                    self.local_vars[var_name].trace_add(
                        "write", self._update_button_states_on_change
                    )

    def _create_settings_widgets(self):
        """
        Creates and lays out all the widgets within the settings dialog.

        Organizes settings into tabs for better navigation."""
        main_content_frame = ctk.CTkFrame(self, fg_color="transparent")
        main_content_frame.pack(fill="both", expand=True, padx=10, pady=10)

        tabview = ctk.CTkTabview(main_content_frame)
        tabview.pack(expand=True, fill="both", pady=(0, 10))

        tab_general = tabview.add(" General ")
        tab_connection = tabview.add(" Connection ")
        tab_operation = tabview.add(" Operation ")
        tab_device_specific = tabview.add(" Device Specific ")
        tab_logging = tabview.add(" Logging ")

        self._populate_general_tab(tab_general)
        self._populate_connection_tab(tab_connection)
        self._populate_operation_tab(tab_operation)
        self._populate_device_specific_tab(tab_device_specific)
        self._populate_logging_tab(tab_logging)

        # --- Buttons Frame ---
        buttons_frame = ctk.CTkFrame(main_content_frame, fg_color="transparent")
        buttons_frame.pack(
            fill="x", side="bottom", pady=(10, 0)
        )  # padx handled by subframe or main_content_frame

        action_buttons_subframe = ctk.CTkFrame(buttons_frame, fg_color="transparent")
        action_buttons_subframe.pack(side="right")  # Align buttons to the right

        # Define colors for buttons (could be moved to constants or theme if widely used)
        self.color_ok_blue = self.parent_gui.apply_appearance_mode_theme_color(
            ctk.ThemeManager.theme["CTkButton"]["fg_color"]
        )
        self.color_cancel_red = self.parent_gui.apply_appearance_mode_theme_color(
            ("#D32F2F", "#E57373")
        )  # Darker red for light, lighter for dark
        self.color_apply_grey = self.parent_gui.apply_appearance_mode_theme_color(
            ctk.ThemeManager.theme["CTkButton"].get("border_color", ("gray60", "gray40"))
        )  # Use border or a neutral color
        self.color_close_grey = self.color_apply_grey

        self.ok_button = ctk.CTkButton(
            action_buttons_subframe,
            text="OK",
            state="disabled",
            fg_color=self.color_ok_blue,
            command=self._ok_action,
        )
        self.apply_button = ctk.CTkButton(
            action_buttons_subframe,
            text="Apply",
            fg_color=self.color_apply_grey,
            state="disabled",
            command=self._apply_action_ui_handler,
        )
        self.cancel_close_button = ctk.CTkButton(
            action_buttons_subframe,
            text="Close",
            fg_color=self.color_close_grey,
            command=self._cancel_close_action,
        )

        self.cancel_close_button.pack(
            side="left", padx=(0, 0)
        )  # Initially only "Close" is visible and packed

        ctk.CTkLabel(
            main_content_frame,
            text="Note: Appearance/Theme changes apply immediately."
            " Other settings update on Apply/OK.",
            font=ctk.CTkFont(size=10, slant="italic"),
        ).pack(side="bottom", fill="x", pady=(5, 0))

    def _populate_general_tab(self, tab):
        """Populates the 'General' tab with relevant settings widgets."""
        scroll_frame = ctk.CTkScrollableFrame(tab, fg_color="transparent")
        scroll_frame.pack(fill="both", expand=True, padx=5, pady=5)

        ctk.CTkLabel(scroll_frame, text="Application Theme:", font=ctk.CTkFont(weight="bold")).pack(
            anchor="w", pady=(5, 2), padx=5
        )
        ctk.CTkLabel(scroll_frame, text="Appearance Mode:").pack(anchor="w", pady=(5, 0), padx=10)
        ctk.CTkComboBox(
            scroll_frame,
            variable=self.local_vars["appearance_mode_var"],
            values=["Light", "Dark", "System"],
            state="readonly",
        ).pack(fill="x", pady=2, padx=10)
        ctk.CTkLabel(scroll_frame, text="Color Theme:").pack(anchor="w", pady=(5, 0), padx=10)
        ctk.CTkComboBox(
            scroll_frame,
            variable=self.local_vars["color_theme_var"],
            values=["blue", "dark-blue", "green"],
            state="readonly",
        ).pack(fill="x", pady=(2, 10), padx=10)

        ctk.CTkLabel(scroll_frame, text="Application Exit:", font=ctk.CTkFont(weight="bold")).pack(
            anchor="w", pady=(10, 2), padx=5
        )
        ctk.CTkCheckBox(
            scroll_frame,
            text="Quit without confirmation if device is connected",
            variable=self.local_vars["quit_without_prompt_var"],
        ).pack(anchor="w", pady=(5, 10), padx=10)

        ctk.CTkLabel(scroll_frame, text="Download Settings:", font=ctk.CTkFont(weight="bold")).pack(
            anchor="w", pady=(10, 2), padx=5
        )
        self.current_dl_dir_label_settings = ctk.CTkLabel(
            scroll_frame,
            text=self.current_dialog_download_dir[0],
            wraplength=380,
            anchor="w",
            justify="left",
        )
        self.current_dl_dir_label_settings.pack(fill="x", pady=2, padx=10)
        dir_buttons_frame = ctk.CTkFrame(scroll_frame, fg_color="transparent")
        dir_buttons_frame.pack(fill="x", pady=(0, 5), padx=10)
        ctk.CTkButton(
            dir_buttons_frame,
            text="Select Download Directory...",
            command=self._select_download_dir_action,
        ).pack(side="left", pady=(5, 0))
        ctk.CTkButton(
            dir_buttons_frame, text="Reset to App Folder", command=self._reset_download_dir_action
        ).pack(side="left", padx=5, pady=(5, 0))

    def _populate_connection_tab(self, tab):
        """Populates the 'Connection' tab with relevant settings widgets."""
        scroll_frame = ctk.CTkScrollableFrame(tab, fg_color="transparent")
        scroll_frame.pack(fill="both", expand=True, padx=5, pady=5)

        ctk.CTkLabel(
            scroll_frame, text="USB Device Selection:", font=ctk.CTkFont(weight="bold")
        ).pack(anchor="w", pady=(5, 2), padx=5)
        device_combo_scan_frame = ctk.CTkFrame(scroll_frame, fg_color="transparent")
        device_combo_scan_frame.pack(fill="x", padx=10, pady=(0, 10))
        self.settings_device_combobox = ctk.CTkComboBox(
            device_combo_scan_frame,
            state="readonly",
            width=350,
            command=self._on_device_selected_in_settings,
        )
        self.settings_device_combobox.pack(side="left", fill="x", expand=True, padx=(0, 5))
        ctk.CTkButton(
            device_combo_scan_frame,
            text="Scan",
            width=80,
            command=lambda: self.parent_gui.scan_usb_devices_for_settings(
                self, change_callback=self._update_button_states_on_change
            ),
        ).pack(side="left")
        self.parent_gui.scan_usb_devices_for_settings(
            self, initial_load=True, change_callback=self._update_button_states_on_change
        )  # Initial scan

        ctk.CTkCheckBox(
            scroll_frame, text="Autoconnect on startup", variable=self.local_vars["autoconnect_var"]
        ).pack(pady=10, padx=10, anchor="w")
        ctk.CTkLabel(scroll_frame, text="Target USB Interface Number:").pack(
            anchor="w", pady=(5, 0), padx=10
        )
        ctk.CTkEntry(
            scroll_frame, textvariable=self.local_vars["target_interface_var"], width=60
        ).pack(anchor="w", pady=2, padx=10)

    def _populate_operation_tab(self, tab):
        """Populates the 'Operation' tab with relevant settings widgets."""
        scroll_frame = ctk.CTkScrollableFrame(tab, fg_color="transparent")
        scroll_frame.pack(fill="both", expand=True, padx=5, pady=5)
        ctk.CTkLabel(
            scroll_frame, text="Timings & Auto-Refresh:", font=ctk.CTkFont(weight="bold")
        ).pack(anchor="w", pady=(5, 2), padx=5)
        ctk.CTkLabel(scroll_frame, text="Recording Status Check Interval (seconds):").pack(
            anchor="w", pady=(5, 0), padx=10
        )
        ctk.CTkEntry(
            scroll_frame, textvariable=self.local_vars["recording_check_interval_var"], width=60
        ).pack(anchor="w", pady=2, padx=10)
        ctk.CTkLabel(scroll_frame, text="Default Command Timeout (ms):").pack(
            anchor="w", pady=(5, 0), padx=10
        )
        ctk.CTkEntry(
            scroll_frame, textvariable=self.local_vars["default_command_timeout_ms_var"], width=100
        ).pack(anchor="w", pady=2, padx=10)
        ctk.CTkLabel(scroll_frame, text="File Streaming Timeout (seconds):").pack(
            anchor="w", pady=(5, 0), padx=10
        )
        ctk.CTkEntry(
            scroll_frame, textvariable=self.local_vars["file_stream_timeout_s_var"], width=100
        ).pack(anchor="w", pady=2, padx=10)
        ctk.CTkCheckBox(
            scroll_frame,
            text="Automatically refresh file list when connected",
            variable=self.local_vars["auto_refresh_files_var"],
        ).pack(anchor="w", pady=(10, 0), padx=10)
        ctk.CTkLabel(scroll_frame, text="Auto Refresh Interval (seconds):").pack(
            anchor="w", pady=(0, 0), padx=10
        )
        ctk.CTkEntry(
            scroll_frame, textvariable=self.local_vars["auto_refresh_interval_s_var"], width=60
        ).pack(anchor="w", pady=(2, 10), padx=10)

    def _populate_device_specific_tab(self, tab):
        """Populates the 'Device Specific' tab with relevant settings widgets."""
        scroll_frame = ctk.CTkScrollableFrame(tab, fg_color="transparent")
        scroll_frame.pack(fill="both", expand=True, padx=5, pady=5)
        ctk.CTkLabel(
            scroll_frame,
            text="Device Behavior Settings (Requires Connection):",
            font=ctk.CTkFont(weight="bold"),
        ).pack(anchor="w", pady=(5, 2), padx=5)
        self.auto_record_checkbox = ctk.CTkCheckBox(
            scroll_frame,
            text="Auto Record on Power On",
            variable=self.local_vars["device_setting_auto_record_var"],
            state="disabled",
        )
        self.auto_record_checkbox.pack(anchor="w", padx=10, pady=2)
        self.auto_play_checkbox = ctk.CTkCheckBox(
            scroll_frame,
            text="Auto Play on Insert (if applicable)",
            variable=self.local_vars["device_setting_auto_play_var"],
            state="disabled",
        )
        self.auto_play_checkbox.pack(anchor="w", padx=10, pady=2)
        self.bt_tone_checkbox = ctk.CTkCheckBox(
            scroll_frame,
            text="Bluetooth Connection Tones",
            variable=self.local_vars["device_setting_bluetooth_tone_var"],
            state="disabled",
        )
        self.bt_tone_checkbox.pack(anchor="w", padx=10, pady=2)
        self.notification_sound_checkbox = ctk.CTkCheckBox(
            scroll_frame,
            text="Notification Sounds",
            variable=self.local_vars["device_setting_notification_sound_var"],
            state="disabled",
        )
        self.notification_sound_checkbox.pack(anchor="w", padx=10, pady=(2, 10))

    def _populate_logging_tab(self, tab):
        """Populates the 'Logging' tab with relevant settings widgets."""
        scroll_frame = ctk.CTkScrollableFrame(tab, fg_color="transparent")
        scroll_frame.pack(fill="both", expand=True, padx=5, pady=5)
        ctk.CTkLabel(
            scroll_frame, text="General Logging Settings:", font=ctk.CTkFont(weight="bold")
        ).pack(anchor="w", pady=(5, 2), padx=5)
        ctk.CTkLabel(scroll_frame, text="Logger Processing Level:").pack(
            anchor="w", pady=(5, 0), padx=10
        )
        ctk.CTkComboBox(
            scroll_frame,
            variable=self.local_vars["logger_processing_level_var"],
            values=list(Logger.LEVELS.keys()),
            state="readonly",
        ).pack(fill="x", pady=2, padx=10)
        ctk.CTkCheckBox(
            scroll_frame,
            text="Suppress console output (logs still go to GUI)",
            variable=self.local_vars["suppress_console_output_var"],
        ).pack(anchor="w", pady=(5, 0), padx=10)
        ctk.CTkCheckBox(
            scroll_frame,
            text="Suppress GUI log output (logs only to console/stderr)",
            variable=self.local_vars["suppress_gui_log_output_var"],
        ).pack(anchor="w", pady=(0, 10), padx=10)

        ctk.CTkLabel(
            scroll_frame,
            text="Log Level Colors (Hex Codes, e.g., #RRGGBB):",
            font=ctk.CTkFont(weight="bold"),
        ).pack(anchor="w", pady=(10, 10), padx=5)
        for level_name_upper in ["ERROR", "WARNING", "INFO", "DEBUG", "CRITICAL"]:
            level_name_lower = level_name_upper.lower()
            level_frame = ctk.CTkFrame(scroll_frame)
            level_frame.pack(fill="x", pady=3, padx=5)
            ctk.CTkLabel(level_frame, text=f"{level_name_upper}:", width=80, anchor="w").pack(
                side="left", padx=(0, 10)
            )
            ctk.CTkLabel(level_frame, text="Light:", width=40).pack(side="left", padx=(0, 2))
            light_entry = ctk.CTkEntry(
                level_frame,
                textvariable=self.local_vars[f"log_color_{level_name_lower}_light_var"],
                width=90,
            )
            light_entry.pack(side="left", padx=(0, 2))
            light_color_var_ref = self.local_vars[f"log_color_{level_name_lower}_light_var"]
            light_preview_frame = ctk.CTkFrame(
                level_frame, width=20, height=20, corner_radius=3, border_width=1
            )
            light_preview_frame.pack(side="left", padx=(0, 10))
            light_color_var_ref.trace_add(
                "write",
                lambda *args, f=light_preview_frame,
                v=light_color_var_ref: self._update_color_preview_widget(
                    f, v
                ),
            )
            self._update_color_preview_widget(light_preview_frame, light_color_var_ref)
            ctk.CTkLabel(level_frame, text="Dark:", width=40).pack(side="left", padx=(0, 2))
            dark_entry = ctk.CTkEntry(
                level_frame,
                textvariable=self.local_vars[f"log_color_{level_name_lower}_dark_var"],
                width=90,
            )
            dark_entry.pack(side="left", padx=(0, 2))
            dark_color_var_ref = self.local_vars[f"log_color_{level_name_lower}_dark_var"]
            dark_preview_frame = ctk.CTkFrame(
                level_frame, width=20, height=20, corner_radius=3, border_width=1
            )
            dark_preview_frame.pack(side="left", padx=(3, 5))
            dark_color_var_ref.trace_add(
                "write",
                lambda *args, f=dark_preview_frame,
                v=dark_color_var_ref: self._update_color_preview_widget(
                    f, v
                ),
            )
            self._update_color_preview_widget(dark_preview_frame, dark_color_var_ref)

    def _finalize_initialization_and_button_states(self):
        """
        Finalizes the dialog initialization and sets the initial button states.

        This is called after all widgets are created and potentially after async loads.
        """

        def _core_final_setup():
            if not self.winfo_exists():
                return
            self._settings_dialog_initializing = False
            self.settings_changed_tracker[0] = False
            logger.debug(
                "SettingsDialog",
                "_core_final_setup",
                "Initialization complete. Change tracking active.",
            )
            if self.ok_button.winfo_exists():
                if self.ok_button.winfo_ismapped():
                    self.ok_button.pack_forget()
                self.ok_button.configure(state="disabled")
            if self.apply_button.winfo_exists():
                if self.apply_button.winfo_ismapped():
                    self.apply_button.pack_forget()
                self.apply_button.configure(state="disabled")
            if self.cancel_close_button.winfo_exists():
                self.cancel_close_button.configure(
                    text="Close", fg_color=self.color_close_grey, state="normal"
                )
                if not self.cancel_close_button.winfo_ismapped():
                    self.cancel_close_button.pack(side="left", padx=(0, 0))

        if self.winfo_exists():
            self.after(50, _core_final_setup)

    def _update_button_states_on_change(self, _var_name=None, _index=None, _mode=None):
        """
        Updates the state of the OK, Apply, and Cancel/Close buttons.

        Called whenever a setting value changes to enable/disable buttons appropriately.
        """
        if not self.winfo_exists():
            return
        if self._settings_dialog_initializing:
            return
        if not self.settings_changed_tracker[0]:
            self.settings_changed_tracker[0] = True
            logger.debug(
                "SettingsDialog",
                "_update_button_states_on_change",
                "First change, transitioning buttons.",
            )
            if self.ok_button.winfo_exists() and self.ok_button.winfo_ismapped():
                self.ok_button.pack_forget()
            if self.apply_button.winfo_exists() and self.apply_button.winfo_ismapped():
                self.apply_button.pack_forget()
            if (
                self.cancel_close_button.winfo_exists()
                and self.cancel_close_button.winfo_ismapped()
            ):
                self.cancel_close_button.pack_forget()
            self.ok_button.pack(side="left", padx=(0, 5))
            self.apply_button.pack(side="left", padx=5)
            self.cancel_close_button.pack(side="left", padx=(5, 0))
            self.ok_button.configure(
                state="normal", fg_color=self.color_ok_blue
            )  # Ensure OK button color is set
            self.apply_button.configure(state="normal" if self.dock.is_connected() else "disabled")
            self.cancel_close_button.configure(text="Cancel", fg_color=self.color_cancel_red)
        elif self.apply_button.winfo_exists() and self.apply_button.winfo_ismapped():
            self.apply_button.configure(state="normal" if self.dock.is_connected() else "disabled")

    def _select_download_dir_action(self):
        """Opens a file dialog to select the download directory and updates the UI."""
        selected_dir = filedialog.askdirectory(
            initialdir=self.current_dialog_download_dir[0],
            title="Select Download Directory",
            parent=self,
        )
        if selected_dir and selected_dir != self.current_dialog_download_dir[0]:
            self.current_dialog_download_dir[0] = selected_dir
            if (
                hasattr(self, "current_dl_dir_label_settings")
                and self.current_dl_dir_label_settings.winfo_exists()
            ):
                self.current_dl_dir_label_settings.configure(
                    text=self.current_dialog_download_dir[0]
                )
            self._update_button_states_on_change()  # Manually trigger change detection

    def _reset_download_dir_action(self):
        """Resets the download directory to the application's current working directory."""
        default_dir = os.getcwd()
        if default_dir != self.current_dialog_download_dir[0]:
            self.current_dialog_download_dir[0] = default_dir
            if (
                hasattr(self, "current_dl_dir_label_settings")
                and self.current_dl_dir_label_settings.winfo_exists()
            ):
                self.current_dl_dir_label_settings.configure(
                    text=self.current_dialog_download_dir[0]
                )
            self._update_button_states_on_change()

    def _on_device_selected_in_settings(self, _choice):  # CTkComboBox passes choice, mark as unused
        """
        Handles the selection change in the device combobox.

        Updates the selected VID/PID variables based on the user's selection.
        """
        if not self.settings_device_combobox or not self.settings_device_combobox.winfo_exists():
            return
        selection = self.settings_device_combobox.get()  # Get current value
        if not selection or selection == "--- Devices with Issues ---":
            return
        selected_device_info = next(
            (dev for dev in self.parent_gui.available_usb_devices if dev[0] == selection), None
        )
        if selected_device_info:
            _, vid, pid = selected_device_info
            if self.local_vars["selected_vid_var"].get() != vid:
                self.local_vars["selected_vid_var"].set(vid)
            if self.local_vars["selected_pid_var"].get() != pid:
                self.local_vars["selected_pid_var"].set(pid)
            if (
                self.local_vars["selected_vid_var"].get() == vid
                and self.local_vars["selected_pid_var"].get() == pid
            ):
                self._update_button_states_on_change()  # Manually trigger change
        else:
            logger.warning(
                "SettingsDialog",
                "_on_device_selected",
                f"Could not find details for: '{selection}'",
            )

    def _update_color_preview_widget(self, frame_widget, color_string_var):
        """
        Updates the background color of a preview frame based on a hex color string variable.

        Args:
        frame_widget (ctk.CTkFrame): The frame widget to update.
        color_string_var (ctk.StringVar): The StringVar holding the hex color code.
        """
        if not frame_widget.winfo_exists():
            return
        color_hex = color_string_var.get()
        try:
            if color_hex.startswith("#") and (len(color_hex) == 7 or len(color_hex) == 9):
                frame_widget.configure(fg_color=color_hex)
            else:
                frame_widget.configure(
                    fg_color=self.parent_gui.apply_appearance_mode_theme_color(
                        ("#e0e0e0", "#404040")
                    )
                )
        except tkinter.TclError:
            frame_widget.configure(
                fg_color=self.parent_gui.apply_appearance_mode_theme_color(("#e0e0e0", "#404040"))
            )
        except (ValueError, TypeError) as e:  # More specific for color string issues
            logger.error("SettingsDialog", "_update_color_preview", f"Error for '{color_hex}': {e}")
            frame_widget.configure(
                fg_color=self.parent_gui.apply_appearance_mode_theme_color(("#e0e0e0", "#404040"))
            )

    def _load_device_settings_for_dialog_thread(self):
        """
        Loads device-specific settings in a separate thread.

        Updates the corresponding CTk Variables and enables the checkboxes upon completion.
        """
        try:
            settings = self.dock.get_device_settings()

            def safe_update(task):
                if self.winfo_exists():
                    self.after(0, task)

            if settings:
                self._fetched_device_settings_for_dialog = settings.copy()
                safe_update(
                    lambda: self.local_vars["device_setting_auto_record_var"].set(
                        settings.get("autoRecord", False)
                    )
                )
                safe_update(
                    lambda: self.local_vars["device_setting_auto_play_var"].set(
                        settings.get("autoPlay", False)
                    )
                )
                safe_update(
                    lambda: self.local_vars["device_setting_bluetooth_tone_var"].set(
                        settings.get("bluetoothTone", False)
                    )
                )
                safe_update(
                    lambda: self.local_vars["device_setting_notification_sound_var"].set(
                        settings.get("notificationSound", False)
                    )
                )
                for cb in [
                    self.auto_record_checkbox,
                    self.auto_play_checkbox,
                    self.bt_tone_checkbox,
                    self.notification_sound_checkbox,
                ]:
                    if cb and cb.winfo_exists():
                        safe_update(lambda widget=cb: widget.configure(state="normal"))
            else:
                logger.warning(
                    "SettingsDialog", "_load_device_settings", "Failed to load device settings."
                )
        except (usb.core.USBError, ConnectionError) as e_usb:
            logger.error(
                "SettingsDialog", "_load_device_settings", f"USB/Connection Error: {e_usb}"
            )
            if self.winfo_exists():
                messagebox.showerror(
                    "Device Error", f"Failed to load device settings: {e_usb}", parent=self
                )
        except tkinter.TclError as e_tk:
            logger.error("SettingsDialog", "_load_device_settings", f"Tkinter Error: {e_tk}")
            # May not be able to show messagebox if tkinter itself is the issue here, but try
            if self.winfo_exists():  # pragma: no cover
                messagebox.showerror(
                    "GUI Error", f"Error updating settings UI: {e_tk}", parent=self
                )
        except (
            AttributeError,
            KeyError,
            TypeError,
            ValueError,
        ) as e_runtime:  # More specific runtime errors
            logger.error(
                "SettingsDialog",
                "_load_device_settings",
                f"Runtime error loading device settings: {type(e_runtime).__name__} - {e_runtime}",
            )
        finally:
            if self.winfo_exists():
                self.after(0, self._finalize_initialization_and_button_states)

    def _perform_apply_settings_logic(self, update_dialog_baseline=False):
        """
        Applies the settings from the dialog's local variables to the parent GUI's state and config.

        Args:
        update_dialog_baseline (bool): If True, updates the dialog's internal snapshot
        to the newly applied settings (used for the 'Apply' button).
        """
        # Apply local_vars to parent_gui's vars and config
        for var_name, local_tk_var in self.local_vars.items():
            if hasattr(self.parent_gui, var_name):
                parent_var = getattr(self.parent_gui, var_name)
                parent_var.set(local_tk_var.get())  # This will trigger traces on parent if any
                # Update the main config dictionary directly for saving
                # Need to map var_name (e.g. "autoconnect_var") to config key (e.g. "autoconnect")
                config_key = var_name.replace("_var", "")
                if config_key.startswith("log_color_") and config_key.endswith(("_light", "_dark")):
                    pass  # Log colors handled separately
                elif config_key.startswith("device_setting_"):  # These are not directly in config
                    pass
                else:
                    self.parent_gui.config[config_key] = local_tk_var.get()

        # Apply log colors
        if "log_colors" not in self.parent_gui.config:
            self.parent_gui.config["log_colors"] = {}
        for level_key in Logger.LEVELS:  # Iterate directly over dictionary keys
            level_lower = level_key.lower()
            self.parent_gui.config["log_colors"][level_key] = [
                self.local_vars[f"log_color_{level_lower}_light_var"].get(),
                self.local_vars[f"log_color_{level_lower}_dark_var"].get(),
            ]

        self.parent_gui.download_directory = self.current_dialog_download_dir[0]
        self.parent_gui.config["download_directory"] = self.parent_gui.download_directory

        # Trigger updates in parent GUI
        self.parent_gui.apply_theme_and_color()  # Applies appearance dependent styles
        logger.set_level(self.parent_gui.logger_processing_level_var.get())  # Update global logger
        logger.update_config(
            {
                "suppress_console_output": self.parent_gui.suppress_console_output_var.get(),
                "suppress_gui_log_output": self.parent_gui.suppress_gui_log_output_var.get(),
            }
        )
        self.parent_gui.update_log_colors_gui()  # Use public method
        self.parent_gui.update_all_status_info()

        # Apply device-specific settings if connected and changed
        if self.dock.is_connected() and self._fetched_device_settings_for_dialog:
            changed_device_settings = {}
            conceptual_device_setting_keys = {
                "autoRecord": "device_setting_auto_record_var",
                "autoPlay": "device_setting_auto_play_var",
                "bluetoothTone": "device_setting_bluetooth_tone_var",
                "notificationSound": "device_setting_notification_sound_var",
            }
            for conceptual_key, local_var_name in conceptual_device_setting_keys.items():
                current_val = self.local_vars[local_var_name].get()
                fetched_val = self._fetched_device_settings_for_dialog.get(conceptual_key)
                if (
                    current_val != fetched_val and fetched_val is not None
                ):  # Only if fetched_val was successfully loaded
                    changed_device_settings[conceptual_key] = current_val
            if changed_device_settings:
                self.parent_gui.apply_device_settings_from_dialog(
                    changed_device_settings
                )  # Call parent's method

        save_config(self.parent_gui.config)  # Save the updated main config
        logger.info("SettingsDialog", "apply_settings", "Settings applied and saved.")

        if update_dialog_baseline:  # If "Apply" was clicked, update the baseline for this dialog
            self.initial_config_snapshot = self.parent_gui.config.copy()  # Re-snapshot
            self._clone_parent_vars()  # Re-clone vars to update local_vars to current parent state
            self.initial_download_directory = self.parent_gui.download_directory
            self.current_dialog_download_dir[0] = self.parent_gui.download_directory
            # Re-fetch device settings for baseline if needed,
            # or use current local_vars as new baseline
            if self.dock.is_connected():
                self._fetched_device_settings_for_dialog["autoRecord"] = self.local_vars[
                    "device_setting_auto_record_var"
                ].get()
                self._fetched_device_settings_for_dialog["autoPlay"] = self.local_vars[
                    "device_setting_auto_play_var"
                ].get()
                self._fetched_device_settings_for_dialog["bluetoothTone"] = self.local_vars[
                    "device_setting_bluetooth_tone_var"
                ].get()
                self._fetched_device_settings_for_dialog["notificationSound"] = self.local_vars[
                    "device_setting_notification_sound_var"
                ].get()

    def _ok_action(self):
        """
        Handles the 'OK' button click.

        Applies settings if changed and closes the dialog.
        """
        if self.settings_changed_tracker[0]:
            self._perform_apply_settings_logic(update_dialog_baseline=False)
        self.destroy()

    def _apply_action_ui_handler(self):
        """Handles the 'Apply' button click, applying settings and updating the dialog state."""
        if self.settings_changed_tracker[0]:
            self._perform_apply_settings_logic(update_dialog_baseline=True)

            def _update_dialog_ui_after_apply():
                if self.winfo_exists():
                    self.settings_changed_tracker[0] = False
                    if self.ok_button.winfo_exists():
                        self.ok_button.configure(state="disabled")
                        self.ok_button.pack_forget()
                    if self.apply_button.winfo_exists():
                        self.apply_button.configure(state="disabled")
                        self.apply_button.pack_forget()
                    if self.cancel_close_button.winfo_exists():
                        self.cancel_close_button.configure(
                            text="Close", fg_color=self.color_close_grey
                        )
                    self.focus_set()

            if self.winfo_exists():
                self.after(160, _update_dialog_ui_after_apply)

    def _cancel_close_action(self):
        """
        Handles the 'Cancel' or 'Close' button click.

        If settings were changed, resets the local variables to the initial state before closing.
        """
        if self.settings_changed_tracker[0]:
            # Reset local_vars to their state at the time of the last "Apply" or dialog open
            for config_key, initial_config_value in self.initial_config_snapshot.items():
                if config_key == "log_colors":
                    # initial_config_value is the dict of log colors.
                    for level_key, color_pair in initial_config_value.items():  # Iterate the dict
                        level_lower = level_key.lower()
                        light_var_name = f"log_color_{level_lower}_light_var"
                        dark_var_name = f"log_color_{level_lower}_dark_var"
                        if light_var_name in self.local_vars and len(color_pair) > 0:
                            self.local_vars[light_var_name].set(color_pair[0])
                        if dark_var_name in self.local_vars and len(color_pair) > 1:
                            self.local_vars[dark_var_name].set(color_pair[1])
                elif config_key == "download_directory":
                    # Handled separately by resetting self.current_dialog_download_dir[0]
                    # to self.initial_download_directory (which is updated on Apply)
                    pass
                else:
                    # General config keys like "autoconnect", "log_level", "appearance_mode"
                    # Map config key from snapshot to local CTk variable name
                    local_var_name = config_key + "_var"  # Default mapping
                    if config_key == "log_level":
                        local_var_name = "logger_processing_level_var"
                    elif config_key == "quit_without_prompt_if_connected":
                        local_var_name = "quit_without_prompt_var"
                    # Add other special mappings
                    # if config_key doesn't directly map by appending "_var"

                    if local_var_name in self.local_vars:
                        self.local_vars[local_var_name].set(initial_config_value)

            # Reset device settings. These are not in initial_config_snapshot.
            # Their values in self.local_vars should be reset to what they were when
            # the dialog was opened or after the last "Apply". This means resetting
            # them to the parent_gui's current CTkVar values (which reflect the last applied state).
            device_setting_vars_to_reset = [
                "device_setting_auto_record_var", "device_setting_auto_play_var",
                "device_setting_bluetooth_tone_var", "device_setting_notification_sound_var"
            ]
            for ds_var_name in device_setting_vars_to_reset:
                if hasattr(self.parent_gui, ds_var_name) and ds_var_name in self.local_vars:
                    parent_var = getattr(self.parent_gui, ds_var_name)
                    if self.local_vars[ds_var_name].get() != parent_var.get():
                        self.local_vars[ds_var_name].set(parent_var.get())

            # Reset download directory specifically
            self.current_dialog_download_dir[0] = self.initial_download_directory
            if (
                hasattr(self, "current_dl_dir_label_settings")
                and self.current_dl_dir_label_settings.winfo_exists()
            ):
                self.current_dl_dir_label_settings.configure(
                    text=self.current_dialog_download_dir[0]
                )

            logger.info("SettingsDialog", "cancel_close_action", "Settings changes cancelled.")
        self.destroy()
