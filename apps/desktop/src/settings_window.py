"""
Settings Dialog for the HiDock Explorer Tool.

This module defines the `SettingsDialog` class, a customtkinter.CTkToplevel
window that allows users to configure various application settings.
It interacts with the main `HiDockToolGUI` to load, display, and apply
changes to general application preferences, connection parameters,
operation timeouts, device-specific behaviors, and logging options.
"""

import base64
import binascii

# import json  # Future: for advanced configuration import/export
import os
import threading  # For device settings apply thread
import tkinter
from tkinter import filedialog, messagebox

import customtkinter as ctk
import usb.core  # For specific exception handling

try:
    from cryptography.fernet import Fernet

    ENCRYPTION_AVAILABLE = True
except ImportError:
    ENCRYPTION_AVAILABLE = False
    Fernet = None  # Define Fernet as None when not available

from config_and_logger import Logger, logger, update_config_settings  # For type hint and logger instance


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
        self.withdraw()  # Start hidden to prevent flicker
        self.grab_set()

        self._settings_dialog_initializing = True  # Flag to prevent premature updates
        # Settings are saved atomically when changed - no change tracking

        # Store current values of relevant CTk Variables from parent_gui for local use and reset
        self.local_vars = {}
        try:
            self._clone_parent_vars()
        except Exception as e:
            logger.warning("SettingsDialog", "__init__", f"Error cloning parent vars: {e}")
            self.local_vars = {}  # Ensure it's always initialized

        # Store the initial download directory separately for comparison
        self.initial_download_directory = self.parent_gui.download_directory
        self.current_dialog_download_dir = [self.parent_gui.download_directory]  # Mutable for dialog changes

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
            threading.Thread(target=self._load_device_settings_for_dialog_thread, daemon=True).start()
        else:
            self._finalize_initialization_and_button_states()  # No async load needed

        # Bind keys after widgets are created
        self.after(100, self._setup_key_bindings)

        self.after(10, self._adjust_window_size_and_fade_in)

    def _adjust_window_size_and_fade_in(self):
        """
        Adjusts the window size based on content and performs a fade-in animation.

        Ensures the window is visible and focused after initialization.
        Centers the window on the parent window.
        """
        self.update_idletasks()  # Ensure widgets are sized
        min_width, min_height = 650, 600
        req_width = self.winfo_reqwidth() + 40  # Add padding
        req_height = self.winfo_reqheight() + 40
        
        # Set size
        window_width = max(min_width, req_width)
        window_height = max(min_height, req_height)
        
        # Center on parent window
        parent_x = self.parent_gui.winfo_x()
        parent_y = self.parent_gui.winfo_y()
        parent_width = self.parent_gui.winfo_width()
        parent_height = self.parent_gui.winfo_height()
        
        # Calculate centered position
        x = parent_x + (parent_width - window_width) // 2
        y = parent_y + (parent_height - window_height) // 2
        
        # Ensure window stays on screen (basic bounds check)
        x = max(0, x)
        y = max(0, y)
        
        self.geometry(f"{window_width}x{window_height}+{x}+{y}")
        self.minsize(min_width, min_height)
        self.deiconify()  # Show window after positioning
        self.focus_set()

    def _clone_parent_vars(self):
        """Clones relevant CTk Variables from the parent GUI for local modification and reset."""
        vars_to_clone_map = {
            "autoconnect_var": "BooleanVar",
            "logger_processing_level_var": "StringVar",
            "selected_vid_var": "StringVar",  # Changed from IntVar to prevent TclError
            "selected_pid_var": "StringVar",  # Changed from IntVar to prevent TclError
            "target_interface_var": "StringVar",  # Changed from IntVar to prevent TclError
            "recording_check_interval_var": "StringVar",  # Changed from IntVar to prevent TclError
            "default_command_timeout_ms_var": "StringVar",  # Changed from IntVar to prevent TclError
            "file_stream_timeout_s_var": "StringVar",  # Changed from IntVar to prevent TclError
            "auto_refresh_files_var": "BooleanVar",
            "auto_refresh_interval_s_var": "StringVar",  # Changed from IntVar to prevent TclError
            "quit_without_prompt_var": "BooleanVar",
            "appearance_mode_var": "StringVar",
            "color_theme_var": "StringVar",
            "suppress_console_output_var": "BooleanVar",
            "suppress_gui_log_output_var": "BooleanVar",
            "device_setting_auto_record_var": "BooleanVar",
            "device_setting_auto_play_var": "BooleanVar",
            "device_setting_bluetooth_tone_var": "BooleanVar",
            "device_setting_notification_sound_var": "BooleanVar",
            "ai_api_provider_var": "StringVar",
            "ai_model_var": "StringVar",
            "ai_temperature_var": "DoubleVar",
            "ai_max_tokens_var": "IntVar",
            "ai_language_var": "StringVar",
            "ai_openrouter_base_url_var": "StringVar",
            "ai_amazon_region_var": "StringVar",
            "ai_qwen_base_url_var": "StringVar",
            "ai_deepseek_base_url_var": "StringVar",
            "ai_ollama_base_url_var": "StringVar",
            "ai_lmstudio_base_url_var": "StringVar",
            "single_selection_mode_var": "BooleanVar",
            "visualizer_pinned_var": "BooleanVar",
            "loop_playback_var": "BooleanVar",
            "volume_var": "DoubleVar",
            "logs_visible_var": "BooleanVar",
            "gui_log_filter_level_var": "StringVar",
            "calendar_chunking_period_var": "StringVar",
            "enable_file_logging_var": "BooleanVar",
            "enable_console_logging_var": "BooleanVar",
            "enable_gui_logging_var": "BooleanVar",
            "log_file_path_var": "StringVar",
            "log_file_max_size_mb_var": "StringVar",  # Changed from IntVar to prevent TclError
            "log_file_backup_count_var": "StringVar",  # Changed from IntVar to prevent TclError
            "console_log_level_var": "StringVar",
            "gui_log_level_var": "StringVar",
            "file_log_level_var": "StringVar",
        }
        for var_name, var_type_str in vars_to_clone_map.items():
            if hasattr(self.parent_gui, var_name):
                parent_var = getattr(self.parent_gui, var_name)
                var_class = getattr(ctk, var_type_str)  # Get ctk.StringVar, ctk.BooleanVar etc.

                # Convert integer values to strings for StringVar variables that were previously IntVar
                parent_value = parent_var.get()
                if var_type_str == "StringVar" and var_name in [
                    "selected_vid_var",
                    "selected_pid_var",
                    "target_interface_var",
                    "recording_check_interval_var",
                    "default_command_timeout_ms_var",
                    "file_stream_timeout_s_var",
                    "auto_refresh_interval_s_var",
                    "log_file_max_size_mb_var",
                    "log_file_backup_count_var",
                ]:
                    parent_value = str(parent_value)

                self.local_vars[var_name] = var_class(value=parent_value)

                # Create a closure to capture the var_name for the trace callback
                def make_trace_callback(variable_name):
                    def callback(*args):
                        self._on_setting_change(variable_name)

                    return callback

                self.local_vars[var_name].trace_add("write", make_trace_callback(var_name))

        # Clone log color variables
        for level_key in Logger.LEVELS:  # Iterate directly over dictionary keys
            level_lower = level_key.lower()
            for mode in ["light", "dark"]:
                var_name = f"log_color_{level_lower}_{mode}_var"
                if hasattr(self.parent_gui, var_name):
                    parent_var = getattr(self.parent_gui, var_name)
                    self.local_vars[var_name] = ctk.StringVar(value=parent_var.get())

                    # Use the same make_trace_callback function defined above
                    self.local_vars[var_name].trace_add("write", make_trace_callback(var_name))

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
        tab_calendar = tabview.add(" Calendar Sync ")
        tab_ai_transcription = tabview.add(" AI Transcription ")
        tab_logging = tabview.add(" Logging ")
        tab_advanced = tabview.add(" Advanced ")

        self._populate_general_tab(tab_general)
        self._populate_connection_tab(tab_connection)
        self._populate_operation_tab(tab_operation)
        self._populate_device_specific_tab(tab_device_specific)
        self._populate_calendar_tab(tab_calendar)
        self._populate_ai_transcription_tab(tab_ai_transcription)
        self._populate_logging_tab(tab_logging)
        self._populate_advanced_tab(tab_advanced)

        # --- Buttons Frame ---
        buttons_frame = ctk.CTkFrame(main_content_frame, fg_color="transparent")
        buttons_frame.pack(fill="x", side="bottom", pady=(10, 0))

        action_buttons_subframe = ctk.CTkFrame(buttons_frame, fg_color="transparent")
        action_buttons_subframe.pack(side="right")

        # Only Close button
        self.close_button = ctk.CTkButton(
            action_buttons_subframe,
            text="Close",
            command=self.destroy,
        )
        self.close_button.pack(side="left")

        ctk.CTkLabel(
            main_content_frame,
            text="All changes are saved immediately. No need to apply.",
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
        appearance_combo = ctk.CTkComboBox(
            scroll_frame,
            variable=self.local_vars["appearance_mode_var"],
            values=["Light", "Dark", "System"],
            state="readonly",
            command=self._on_appearance_change,
        )
        appearance_combo.pack(fill="x", pady=2, padx=10)
        ctk.CTkLabel(scroll_frame, text="Color Theme:").pack(anchor="w", pady=(5, 0), padx=10)
        theme_combo = ctk.CTkComboBox(
            scroll_frame,
            variable=self.local_vars["color_theme_var"],
            values=["blue", "dark-blue", "green"],
            state="readonly",
            command=self._on_theme_change,
        )
        theme_combo.pack(fill="x", pady=(2, 10), padx=10)

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
            dir_buttons_frame,
            text="Reset to App Folder",
            command=self._reset_download_dir_action,
        ).pack(side="left", padx=5, pady=(5, 0))

    def _populate_connection_tab(self, tab):
        """Populates the 'Connection' tab with relevant settings widgets."""
        scroll_frame = ctk.CTkScrollableFrame(tab, fg_color="transparent")
        scroll_frame.pack(fill="both", expand=True, padx=5, pady=5)

        # Enhanced device selector
        from enhanced_device_selector import EnhancedDeviceSelector

        self.device_selector = EnhancedDeviceSelector(
            scroll_frame,
            command=self._on_device_selected_enhanced,
            scan_callback=self._on_device_scan_complete,
        )
        self.device_selector.pack(fill="both", expand=True, padx=5, pady=5)

        # Disable device selection if device is connected
        if self.dock.is_connected():
            self.device_selector.set_enabled(False)

            # Add informational label
            ctk.CTkLabel(
                scroll_frame,
                text="⚠️ Device selection is disabled while connected. Disconnect to change device.",
                text_color=("orange", "orange"),
                font=ctk.CTkFont(size=12, weight="bold"),
            ).pack(anchor="w", pady=(10, 0), padx=10)
        else:
            # Auto-scan for devices when not connected
            threading.Thread(target=self._initial_enhanced_scan_thread, daemon=True).start()

        ctk.CTkCheckBox(
            scroll_frame,
            text="Autoconnect on startup",
            variable=self.local_vars["autoconnect_var"],
        ).pack(pady=10, padx=10, anchor="w")
        ctk.CTkLabel(scroll_frame, text="Target USB Interface Number:").pack(anchor="w", pady=(5, 0), padx=10)
        ctk.CTkEntry(scroll_frame, textvariable=self.local_vars["target_interface_var"], width=60).pack(
            anchor="w", pady=2, padx=10
        )

    def _populate_operation_tab(self, tab):
        """Populates the 'Operation' tab with relevant settings widgets."""
        scroll_frame = ctk.CTkScrollableFrame(tab, fg_color="transparent")
        scroll_frame.pack(fill="both", expand=True, padx=5, pady=5)
        ctk.CTkLabel(
            scroll_frame,
            text="Timings & Auto-Refresh:",
            font=ctk.CTkFont(weight="bold"),
        ).pack(anchor="w", pady=(5, 2), padx=5)
        ctk.CTkLabel(scroll_frame, text="Recording Status Check Interval (seconds):").pack(
            anchor="w", pady=(5, 0), padx=10
        )
        ctk.CTkEntry(
            scroll_frame,
            textvariable=self.local_vars["recording_check_interval_var"],
            width=60,
        ).pack(anchor="w", pady=2, padx=10)
        ctk.CTkLabel(scroll_frame, text="Default Command Timeout (ms):").pack(anchor="w", pady=(5, 0), padx=10)
        ctk.CTkEntry(
            scroll_frame,
            textvariable=self.local_vars["default_command_timeout_ms_var"],
            width=100,
        ).pack(anchor="w", pady=2, padx=10)
        ctk.CTkLabel(scroll_frame, text="File Streaming Timeout (seconds):").pack(anchor="w", pady=(5, 0), padx=10)
        ctk.CTkEntry(
            scroll_frame,
            textvariable=self.local_vars["file_stream_timeout_s_var"],
            width=100,
        ).pack(anchor="w", pady=2, padx=10)
        ctk.CTkCheckBox(
            scroll_frame,
            text="Automatically refresh file list when connected",
            variable=self.local_vars["auto_refresh_files_var"],
        ).pack(anchor="w", pady=(10, 0), padx=10)
        ctk.CTkLabel(scroll_frame, text="Auto Refresh Interval (seconds):").pack(anchor="w", pady=(0, 0), padx=10)
        ctk.CTkEntry(
            scroll_frame,
            textvariable=self.local_vars["auto_refresh_interval_s_var"],
            width=60,
        ).pack(anchor="w", pady=(2, 10), padx=10)
        
        # Calendar Settings Section

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

    # Calendar integration removed - impractical for regular users

    def _populate_logging_tab(self, tab):
        """Populates the 'Logging' tab with relevant settings widgets."""
        scroll_frame = ctk.CTkScrollableFrame(tab, fg_color="transparent")
        scroll_frame.pack(fill="both", expand=True, padx=5, pady=5)
        
        # Console Logging Section
        ctk.CTkLabel(
            scroll_frame,
            text="Console Logging:",
            font=ctk.CTkFont(weight="bold"),
        ).pack(anchor="w", pady=(5, 2), padx=5)
        
        self.console_enable_checkbox = ctk.CTkCheckBox(
            scroll_frame,
            text="Enable console logging",
            variable=self.local_vars["enable_console_logging_var"],
            command=self._on_console_logging_enabled_changed,
        )
        self.console_enable_checkbox.pack(anchor="w", pady=(5, 5), padx=10)
        
        console_level_frame = ctk.CTkFrame(scroll_frame)
        console_level_frame.pack(fill="x", pady=2, padx=10)
        ctk.CTkLabel(console_level_frame, text="Level:", width=80, anchor="w").pack(side="left", padx=(5, 5))
        self.console_log_level_combo = ctk.CTkComboBox(
            console_level_frame,
            variable=self.local_vars["console_log_level_var"],
            values=list(Logger.LEVELS.keys()),
            state="readonly",
            width=120,
        )
        self.console_log_level_combo.pack(side="left", padx=(0, 5))
        
        # GUI Logging Section
        ctk.CTkLabel(
            scroll_frame,
            text="GUI Logging:",
            font=ctk.CTkFont(weight="bold"),
        ).pack(anchor="w", pady=(20, 2), padx=5)
        
        self.gui_enable_checkbox = ctk.CTkCheckBox(
            scroll_frame,
            text="Enable GUI logging",
            variable=self.local_vars["enable_gui_logging_var"],
            command=self._on_gui_logging_enabled_changed,
        )
        self.gui_enable_checkbox.pack(anchor="w", pady=(5, 5), padx=10)
        
        gui_level_frame = ctk.CTkFrame(scroll_frame)
        gui_level_frame.pack(fill="x", pady=2, padx=10)
        ctk.CTkLabel(gui_level_frame, text="Level:", width=80, anchor="w").pack(side="left", padx=(5, 5))
        self.gui_log_level_combo = ctk.CTkComboBox(
            gui_level_frame,
            variable=self.local_vars["gui_log_level_var"],
            values=list(Logger.LEVELS.keys()),
            state="readonly",
            width=120,
        )
        self.gui_log_level_combo.pack(side="left", padx=(0, 5))
        
        # Add info text about GUI logging behavior
        ctk.CTkLabel(
            scroll_frame,
            text="💡 GUI logs are hidden by default and auto-show on ERROR/CRITICAL messages",
            font=ctk.CTkFont(size=10),
            text_color="gray70",
        ).pack(anchor="w", pady=(2, 10), padx=10)
        
        # File Logging Section
        ctk.CTkLabel(
            scroll_frame,
            text="File Logging:",
            font=ctk.CTkFont(weight="bold"),
        ).pack(anchor="w", pady=(20, 2), padx=5)
        
        self.file_enable_checkbox = ctk.CTkCheckBox(
            scroll_frame,
            text="Enable file logging",
            variable=self.local_vars["enable_file_logging_var"],
            command=self._on_file_logging_enabled_changed,
        )
        self.file_enable_checkbox.pack(anchor="w", pady=(5, 5), padx=10)
        
        file_level_frame = ctk.CTkFrame(scroll_frame)
        file_level_frame.pack(fill="x", pady=2, padx=10)
        ctk.CTkLabel(file_level_frame, text="Level:", width=80, anchor="w").pack(side="left", padx=(5, 5))
        self.file_log_level_combo = ctk.CTkComboBox(
            file_level_frame,
            variable=self.local_vars["file_log_level_var"],
            values=list(Logger.LEVELS.keys()),
            state="readonly",
            width=120,
        )
        self.file_log_level_combo.pack(side="left", padx=(0, 5))
        
        # File logging path
        log_path_frame = ctk.CTkFrame(scroll_frame)
        log_path_frame.pack(fill="x", pady=2, padx=10)
        ctk.CTkLabel(log_path_frame, text="File Path:", width=80, anchor="w").pack(side="left", padx=(5, 5))
        self.log_file_path_entry = ctk.CTkEntry(
            log_path_frame,
            textvariable=self.local_vars["log_file_path_var"],
            width=200,
        )
        self.log_file_path_entry.pack(side="left", fill="x", expand=True, padx=(0, 5))
        
        # File logging max size
        log_size_frame = ctk.CTkFrame(scroll_frame)
        log_size_frame.pack(fill="x", pady=2, padx=10)
        ctk.CTkLabel(log_size_frame, text="Max Size (MB):", width=80, anchor="w").pack(side="left", padx=(5, 5))
        self.log_file_max_size_entry = ctk.CTkEntry(
            log_size_frame,
            textvariable=self.local_vars["log_file_max_size_mb_var"],
            width=80,
        )
        self.log_file_max_size_entry.pack(side="left", padx=(0, 5))
        
        # File logging backup count
        log_backup_frame = ctk.CTkFrame(scroll_frame)
        log_backup_frame.pack(fill="x", pady=2, padx=10)
        ctk.CTkLabel(log_backup_frame, text="Backup Count:", width=80, anchor="w").pack(side="left", padx=(5, 5))
        self.log_file_backup_count_entry = ctk.CTkEntry(
            log_backup_frame,
            textvariable=self.local_vars["log_file_backup_count_var"],
            width=80,
        )
        self.log_file_backup_count_entry.pack(side="left", padx=(0, 5))
        
        # Initialize control states
        self._on_console_logging_enabled_changed()
        self._on_gui_logging_enabled_changed()
        self._on_file_logging_enabled_changed()

        ctk.CTkLabel(
            scroll_frame,
            text="Log Level Colors (Hex Codes, e.g., #RRGGBB):",
            font=ctk.CTkFont(weight="bold"),
        ).pack(anchor="w", pady=(20, 10), padx=5)
        for level_name_upper in ["ERROR", "WARNING", "INFO", "DEBUG", "CRITICAL"]:
            level_name_lower = level_name_upper.lower()
            level_frame = ctk.CTkFrame(scroll_frame)
            level_frame.pack(fill="x", pady=3, padx=5)
            ctk.CTkLabel(level_frame, text=f"{level_name_upper}:", width=80, anchor="w").pack(side="left", padx=(0, 10))
            ctk.CTkLabel(level_frame, text="Light:", width=40).pack(side="left", padx=(0, 2))
            light_entry = ctk.CTkEntry(
                level_frame,
                textvariable=self.local_vars[f"log_color_{level_name_lower}_light_var"],
                width=90,
            )
            light_entry.pack(side="left", padx=(0, 2))
            light_color_var_ref = self.local_vars[f"log_color_{level_name_lower}_light_var"]
            light_preview_frame = ctk.CTkFrame(level_frame, width=20, height=20, corner_radius=3, border_width=1)
            light_preview_frame.pack(side="left", padx=(0, 10))
            light_color_var_ref.trace_add(
                "write",
                lambda *args, f=light_preview_frame, v=light_color_var_ref: self._update_color_preview_widget(f, v),
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
            dark_preview_frame = ctk.CTkFrame(level_frame, width=20, height=20, corner_radius=3, border_width=1)
            dark_preview_frame.pack(side="left", padx=(3, 5))
            dark_color_var_ref.trace_add(
                "write",
                lambda *args, f=dark_preview_frame, v=dark_color_var_ref: self._update_color_preview_widget(f, v),
            )
            self._update_color_preview_widget(dark_preview_frame, dark_color_var_ref)

    def _populate_advanced_tab(self, tab):
        """Populates the 'Advanced' tab with advanced settings and reset functionality."""
        scroll_frame = ctk.CTkScrollableFrame(tab, fg_color="transparent")
        scroll_frame.pack(fill="both", expand=True, padx=5, pady=5)

        # Reset Section
        ctk.CTkLabel(
            scroll_frame, text="⚠️ Danger Zone:", font=ctk.CTkFont(weight="bold", size=16), text_color="red"
        ).pack(anchor="w", pady=(5, 2), padx=5)

        self.reset_button = ctk.CTkButton(
            scroll_frame,
            text="Reset All Settings to Defaults",
            fg_color="red",
            hover_color="darkred",
            command=self._reset_to_defaults,
            width=250,
            height=40,
        )
        self.reset_button.pack(anchor="w", padx=10, pady=10)

        ctk.CTkLabel(
            scroll_frame,
            text="⚠️ This will reset ALL settings to defaults and cannot be undone!",
            font=ctk.CTkFont(size=10),
            text_color="orange",
        ).pack(anchor="w", padx=10, pady=(0, 20))

        # Advanced UI Settings
        ctk.CTkLabel(scroll_frame, text="Advanced UI Settings:", font=ctk.CTkFont(weight="bold")).pack(
            anchor="w", pady=(10, 2), padx=5
        )

        # Add missing settings that should be exposed
        if "single_selection_mode_var" in self.local_vars:
            ctk.CTkCheckBox(
                scroll_frame,
                text="Single selection mode (vs multi-select)",
                variable=self.local_vars["single_selection_mode_var"],
            ).pack(anchor="w", pady=5, padx=10)

        if "visualizer_pinned_var" in self.local_vars:
            ctk.CTkCheckBox(
                scroll_frame, text="Keep audio visualizer pinned", variable=self.local_vars["visualizer_pinned_var"]
            ).pack(anchor="w", pady=5, padx=10)

        if "loop_playback_var" in self.local_vars:
            ctk.CTkCheckBox(
                scroll_frame, text="Loop audio playback", variable=self.local_vars["loop_playback_var"]
            ).pack(anchor="w", pady=5, padx=10)

        if "volume_var" in self.local_vars:
            ctk.CTkLabel(scroll_frame, text="Default playback volume:").pack(anchor="w", pady=(10, 0), padx=10)
            volume_frame = ctk.CTkFrame(scroll_frame)
            volume_frame.pack(fill="x", pady=2, padx=10)

            volume_slider = ctk.CTkSlider(
                volume_frame, from_=0.0, to=1.0, variable=self.local_vars["volume_var"], number_of_steps=100
            )
            volume_slider.pack(side="left", fill="x", expand=True, padx=(0, 5))

            self.volume_label = ctk.CTkLabel(volume_frame, text="0.5", width=40)
            self.volume_label.pack(side="right")

            # Update volume label when slider changes
            self.local_vars["volume_var"].trace_add("write", self._update_volume_label)
            self._update_volume_label()

        # Debug Settings
        ctk.CTkLabel(scroll_frame, text="Debug Settings:", font=ctk.CTkFont(weight="bold")).pack(
            anchor="w", pady=(20, 2), padx=5
        )

        if "logs_visible_var" in self.local_vars:
            ctk.CTkCheckBox(
                scroll_frame, text="Show logs panel by default", variable=self.local_vars["logs_visible_var"]
            ).pack(anchor="w", pady=5, padx=10)

        if "gui_log_filter_level_var" in self.local_vars:
            ctk.CTkLabel(scroll_frame, text="GUI Log Filter Level:").pack(anchor="w", pady=(10, 0), padx=10)
            ctk.CTkComboBox(
                scroll_frame,
                variable=self.local_vars["gui_log_filter_level_var"],
                values=list(Logger.LEVELS.keys()),
                state="readonly",
            ).pack(fill="x", pady=2, padx=10)

    def _update_volume_label(self, *args):
        """Update the volume display label."""
        if hasattr(self, "volume_label") and "volume_var" in self.local_vars:
            volume_value = self.local_vars["volume_var"].get()
            self.volume_label.configure(text=f"{volume_value:.2f}")

    def _populate_ai_transcription_tab(self, tab):
        """Populates the 'AI Transcription' tab with AI service settings."""
        scroll_frame = ctk.CTkScrollableFrame(tab, fg_color="transparent")
        scroll_frame.pack(fill="both", expand=True, padx=5, pady=5)

        # API Configuration Section
        ctk.CTkLabel(
            scroll_frame,
            text="API Configuration:",
            font=ctk.CTkFont(weight="bold"),
        ).pack(anchor="w", pady=(5, 2), padx=5)

        # API Provider Selection
        ctk.CTkLabel(scroll_frame, text="AI Service Provider:").pack(anchor="w", pady=(5, 0), padx=10)
        self.provider_combobox = ctk.CTkComboBox(
            scroll_frame,
            variable=self.local_vars["ai_api_provider_var"],
            values=[
                "gemini",
                "openai",
                "anthropic",
                "openrouter",
                "amazon",
                "qwen",
                "deepseek",
                "ollama",
                "lmstudio",
            ],
            state="readonly",
            command=self._on_ai_provider_changed,
        )
        self.provider_combobox.pack(fill="x", pady=2, padx=10)

        # API Key Entry
        ctk.CTkLabel(scroll_frame, text="API Key:").pack(anchor="w", pady=(10, 0), padx=10)

        api_key_frame = ctk.CTkFrame(scroll_frame)
        api_key_frame.pack(fill="x", pady=2, padx=10)

        self.api_key_entry = ctk.CTkEntry(api_key_frame, placeholder_text="Enter your API key", show="*", width=300)
        self.api_key_entry.pack(side="left", fill="x", expand=True, padx=(0, 5))

        # Save API key when user finishes typing (on focus out)
        self.api_key_entry.bind("<FocusOut>", self._save_api_key)
        self.api_key_entry.bind("<Return>", self._save_api_key)

        self.validate_key_button = ctk.CTkButton(
            api_key_frame, text="Validate", width=80, command=self._validate_api_key
        )
        self.validate_key_button.pack(side="right")

        # Key status indicator
        self.api_key_status_label = ctk.CTkLabel(scroll_frame, text="Status: Not configured", text_color="orange")
        self.api_key_status_label.pack(anchor="w", pady=(2, 10), padx=10)

        # Model Settings Section
        ctk.CTkLabel(
            scroll_frame,
            text="Model Settings:",
            font=ctk.CTkFont(weight="bold"),
        ).pack(anchor="w", pady=(10, 2), padx=5)

        # Model Selection
        ctk.CTkLabel(scroll_frame, text="Model:").pack(anchor="w", pady=(5, 0), padx=10)
        self.model_combobox = ctk.CTkComboBox(
            scroll_frame,
            variable=self.local_vars["ai_model_var"],
            values=[
                "gemini-2.5-flash",
                "gemini-2.5-pro",
                "gemini-2.5-lite",
                "gemini-2.0-flash",
                "gemini-1.5-flash",
                "gemini-1.5-pro",
                "gpt-4o-mini",
                "gpt-4o",
            ],
            state="readonly",
        )
        self.model_combobox.pack(fill="x", pady=2, padx=10)

        # Temperature Setting
        ctk.CTkLabel(scroll_frame, text="Temperature (0.0 - 2.0):").pack(anchor="w", pady=(10, 0), padx=10)
        temp_frame = ctk.CTkFrame(scroll_frame)
        temp_frame.pack(fill="x", pady=2, padx=10)

        self.temperature_slider = ctk.CTkSlider(
            temp_frame,
            from_=0.0,
            to=2.0,
            variable=self.local_vars["ai_temperature_var"],
            number_of_steps=200,
        )
        self.temperature_slider.pack(side="left", fill="x", expand=True, padx=(0, 5))

        self.temperature_label = ctk.CTkLabel(temp_frame, text="0.3", width=40)
        self.temperature_label.pack(side="right")

        # Update temperature label when slider changes
        self.local_vars["ai_temperature_var"].trace_add("write", self._update_temperature_label)

        # Max Tokens Setting
        ctk.CTkLabel(scroll_frame, text="Max Tokens:").pack(anchor="w", pady=(10, 0), padx=10)
        ctk.CTkEntry(
            scroll_frame,
            textvariable=self.local_vars["ai_max_tokens_var"],
            placeholder_text="4000",
        ).pack(fill="x", pady=2, padx=10)

        # Language Setting
        ctk.CTkLabel(scroll_frame, text="Language:").pack(anchor="w", pady=(10, 0), padx=10)
        ctk.CTkComboBox(
            scroll_frame,
            variable=self.local_vars["ai_language_var"],
            values=["auto", "en", "es", "fr", "de", "pt", "zh", "ja", "ko"],
            state="readonly",
        ).pack(fill="x", pady=(2, 10), padx=10)

        # Provider-specific Configuration Section
        self.provider_config_frame = ctk.CTkFrame(scroll_frame)
        self.provider_config_frame.pack(fill="x", pady=(5, 10), padx=5)

        ctk.CTkLabel(
            self.provider_config_frame,
            text="Provider Configuration:",
            font=ctk.CTkFont(weight="bold"),
        ).pack(anchor="w", pady=(5, 2), padx=5)

        # Create provider-specific config widgets (initially hidden)
        self._create_provider_config_widgets()

        # Load current API key status
        self._load_api_key_status()
        self._update_model_list()
        self._update_temperature_label()
        self._update_provider_config()

    def _create_provider_config_widgets(self):
        """Create provider-specific configuration widgets"""
        # OpenRouter Configuration
        self.openrouter_frame = ctk.CTkFrame(self.provider_config_frame)
        ctk.CTkLabel(self.openrouter_frame, text="Base URL:").pack(anchor="w", pady=(5, 2), padx=10)
        ctk.CTkEntry(
            self.openrouter_frame,
            textvariable=self.local_vars["ai_openrouter_base_url_var"],
            placeholder_text="https://openrouter.ai/api/v1",
        ).pack(fill="x", pady=2, padx=10)

        # Amazon Bedrock Configuration
        self.amazon_frame = ctk.CTkFrame(self.provider_config_frame)
        ctk.CTkLabel(self.amazon_frame, text="AWS Region:").pack(anchor="w", pady=(5, 2), padx=10)
        ctk.CTkComboBox(
            self.amazon_frame,
            variable=self.local_vars["ai_amazon_region_var"],
            values=[
                "us-east-1",
                "us-west-2",
                "eu-west-1",
                "ap-southeast-1",
                "ap-northeast-1",
            ],
            state="readonly",
        ).pack(fill="x", pady=2, padx=10)

        # Qwen Configuration
        self.qwen_frame = ctk.CTkFrame(self.provider_config_frame)
        ctk.CTkLabel(self.qwen_frame, text="API Base URL:").pack(anchor="w", pady=(5, 2), padx=10)
        ctk.CTkEntry(
            self.qwen_frame,
            textvariable=self.local_vars["ai_qwen_base_url_var"],
            placeholder_text="https://dashscope.aliyuncs.com/compatible-mode/v1",
        ).pack(fill="x", pady=2, padx=10)

        # DeepSeek Configuration
        self.deepseek_frame = ctk.CTkFrame(self.provider_config_frame)
        ctk.CTkLabel(self.deepseek_frame, text="API Base URL:").pack(anchor="w", pady=(5, 2), padx=10)
        ctk.CTkEntry(
            self.deepseek_frame,
            textvariable=self.local_vars["ai_deepseek_base_url_var"],
            placeholder_text="https://api.deepseek.com",
        ).pack(fill="x", pady=2, padx=10)

        # Ollama Configuration
        self.ollama_frame = ctk.CTkFrame(self.provider_config_frame)
        ctk.CTkLabel(self.ollama_frame, text="🏠 Local Ollama Server:").pack(anchor="w", pady=(5, 2), padx=10)
        ctk.CTkEntry(
            self.ollama_frame,
            textvariable=self.local_vars["ai_ollama_base_url_var"],
            placeholder_text="http://localhost:11434",
        ).pack(fill="x", pady=2, padx=10)

        ollama_info = ctk.CTkLabel(
            self.ollama_frame,
            text="💡 Tip: Install Ollama locally and pull models with 'ollama pull llama3.2'",
            font=ctk.CTkFont(size=10),
            text_color="gray70",
        )
        ollama_info.pack(anchor="w", pady=(2, 5), padx=10)

        # LM Studio Configuration
        self.lmstudio_frame = ctk.CTkFrame(self.provider_config_frame)
        ctk.CTkLabel(self.lmstudio_frame, text="🏠 Local LM Studio Server:").pack(anchor="w", pady=(5, 2), padx=10)
        ctk.CTkEntry(
            self.lmstudio_frame,
            textvariable=self.local_vars["ai_lmstudio_base_url_var"],
            placeholder_text="http://localhost:1234/v1",
        ).pack(fill="x", pady=2, padx=10)

        lmstudio_info = ctk.CTkLabel(
            self.lmstudio_frame,
            text="💡 Tip: Download LM Studio and start local server with your preferred model",
            font=ctk.CTkFont(size=10),
            text_color="gray70",
        )
        lmstudio_info.pack(anchor="w", pady=(2, 5), padx=10)

        # Initially hide all provider config frames
        self.openrouter_frame.pack_forget()
        self.amazon_frame.pack_forget()
        self.qwen_frame.pack_forget()
        self.deepseek_frame.pack_forget()
        self.ollama_frame.pack_forget()
        self.lmstudio_frame.pack_forget()

    def _update_provider_config(self):
        """Show/hide provider-specific configuration based on selected provider"""
        provider = self.local_vars["ai_api_provider_var"].get()

        # Hide all provider config frames first
        config_frames = [
            "openrouter_frame",
            "amazon_frame",
            "qwen_frame",
            "deepseek_frame",
            "ollama_frame",
            "lmstudio_frame",
        ]
        for frame_name in config_frames:
            if hasattr(self, frame_name):
                getattr(self, frame_name).pack_forget()

        # Show relevant provider config frame
        frame_mapping = {
            "openrouter": "openrouter_frame",
            "amazon": "amazon_frame",
            "qwen": "qwen_frame",
            "deepseek": "deepseek_frame",
            "ollama": "ollama_frame",
            "lmstudio": "lmstudio_frame",
        }

        frame_name = frame_mapping.get(provider)
        if frame_name and hasattr(self, frame_name):
            getattr(self, frame_name).pack(fill="x", pady=2, padx=5)

    def _setup_key_bindings(self):
        """Setup key bindings after widgets are created."""
        try:
            if hasattr(self, "close_button") and self.close_button.winfo_exists():
                self.bind("<Return>", lambda event: self.close_button.invoke())
                self.bind("<Escape>", lambda event: self.close_button.invoke())
        except Exception as e:
            logger.debug("SettingsDialog", "_setup_key_bindings", f"Key binding setup: {e}")

    def _finalize_initialization_and_button_states(self):
        """
        Finalizes the dialog initialization and sets the initial button states.

        This is called after all widgets are created and potentially after async loads.
        """

        def _core_final_setup():
            if not self.winfo_exists():
                return
            self._settings_dialog_initializing = False
            logger.debug(
                "SettingsDialog",
                "_core_final_setup",
                "Initialization complete. Atomic saves active.",
            )

        if self.winfo_exists():
            self.after(50, _core_final_setup)

    def _select_download_dir_action(self):
        """Opens a file dialog to select the download directory and updates the UI."""
        selected_dir = filedialog.askdirectory(
            initialdir=self.current_dialog_download_dir[0],
            title="Select Download Directory",
            parent=self,
        )
        if selected_dir and selected_dir != self.current_dialog_download_dir[0]:
            self.current_dialog_download_dir[0] = selected_dir
            if hasattr(self, "current_dl_dir_label_settings") and self.current_dl_dir_label_settings.winfo_exists():
                self.current_dl_dir_label_settings.configure(text=self.current_dialog_download_dir[0])
            # Update parent GUI and save atomically
            self.parent_gui.download_directory = selected_dir
            update_config_settings({"download_directory": selected_dir})

    def _reset_download_dir_action(self):
        """Resets the download directory to the application's current working directory."""
        default_dir = os.getcwd()
        if default_dir != self.current_dialog_download_dir[0]:
            self.current_dialog_download_dir[0] = default_dir
            if hasattr(self, "current_dl_dir_label_settings") and self.current_dl_dir_label_settings.winfo_exists():
                self.current_dl_dir_label_settings.configure(text=self.current_dialog_download_dir[0])
            # Update parent GUI and save atomically
            self.parent_gui.download_directory = default_dir
            update_config_settings({"download_directory": default_dir})

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
                    fg_color=self.parent_gui.apply_appearance_mode_theme_color(("#e0e0e0", "#404040"))
                )
        except tkinter.TclError:
            frame_widget.configure(fg_color=self.parent_gui.apply_appearance_mode_theme_color(("#e0e0e0", "#404040")))
        except (ValueError, TypeError) as e:  # More specific for color string issues
            logger.error(
                "SettingsDialog",
                "_update_color_preview",
                f"Error for '{color_hex}': {e}",
            )
            frame_widget.configure(fg_color=self.parent_gui.apply_appearance_mode_theme_color(("#e0e0e0", "#404040")))

    def _load_device_settings_for_dialog_thread(self):
        """
        Loads device-specific settings in a separate thread.

        Updates the corresponding CTk Variables and enables the checkboxes upon completion.
        """
        try:
            # Use asyncio.run to call the async method
            import asyncio

            settings = asyncio.run(self.dock.get_device_settings())

            def safe_update(task):
                if self.winfo_exists():
                    self.after(0, task)

            if settings:
                self._fetched_device_settings_for_dialog = settings.copy()
                safe_update(
                    lambda: self.local_vars["device_setting_auto_record_var"].set(settings.get("autoRecord", False))
                )
                safe_update(
                    lambda: self.local_vars["device_setting_auto_play_var"].set(settings.get("autoPlay", False))
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
                    "SettingsDialog",
                    "_load_device_settings",
                    "Failed to load device settings.",
                )
        except (usb.core.USBError, ConnectionError) as e_usb:
            logger.error(
                "SettingsDialog",
                "_load_device_settings",
                f"USB/Connection Error: {e_usb}",
            )
            if self.winfo_exists():
                messagebox.showerror(
                    "Device Error",
                    f"Failed to load device settings: {e_usb}",
                    parent=self,
                )
        except tkinter.TclError as e_tk:
            logger.error("SettingsDialog", "_load_device_settings", f"Tkinter Error: {e_tk}")
            # May not be able to show messagebox if tkinter itself is the issue here, but try
            if self.winfo_exists():  # pragma: no cover
                messagebox.showerror("GUI Error", f"Error updating settings UI: {e_tk}", parent=self)
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

    def _initial_usb_scan_thread(self):
        """
        Performs the initial USB scan in a separate thread to prevent UI freezing.
        This prevents deadlocks when the settings dialog is opened during active downloads.
        Only scans if device is not connected.
        """
        try:
            # Skip scanning if device is connected
            if self.dock.is_connected():
                logger.info(
                    "SettingsDialog",
                    "_initial_usb_scan_thread",
                    "Skipping USB scan - device is connected",
                )
                return

            # Add a small delay to ensure the dialog is fully initialized
            import time

            time.sleep(0.1)

            if self.winfo_exists():
                self.parent_gui.scan_usb_devices_for_settings(
                    self,
                    initial_load=True,
                    change_callback=None,  # No callback for atomic saves
                )
        except Exception as e:
            logger.error(
                "SettingsDialog",
                "_initial_usb_scan_thread",
                f"Error during initial USB scan: {e}",
            )
            # If scanning fails, just continue without it - the user can manually scan
            if self.winfo_exists():
                self.after(
                    0,
                    lambda: (
                        self.settings_device_combobox.configure(values=["Scan failed - click Scan button to retry"])
                        if hasattr(self, "settings_device_combobox") and self.settings_device_combobox.winfo_exists()
                        else None
                    ),
                )

    def _validate_numeric_settings(self):
        """
        Validates numeric settings and shows error messages for invalid values.
        Returns True if all values are valid, False otherwise.
        """
        numeric_vars = {
            "selected_vid_var": ("Vendor ID", 0, 0xFFFF),
            "selected_pid_var": ("Product ID", 0, 0xFFFF),
            "target_interface_var": ("Target Interface", 0, 10),
            "recording_check_interval_var": ("Recording Check Interval", 1, 3600),
            "default_command_timeout_ms_var": ("Command Timeout", 100, 60000),
            "file_stream_timeout_s_var": ("File Stream Timeout", 1, 300),
            "auto_refresh_interval_s_var": ("Auto Refresh Interval", 1, 3600),
        }

        for var_name, (display_name, min_val, max_val) in numeric_vars.items():
            if var_name in self.local_vars:
                value_str = self.local_vars[var_name].get().strip()

                # Check for empty string
                if not value_str:
                    messagebox.showerror(
                        "Invalid Setting",
                        f"{display_name} cannot be empty. Please enter a valid number.",
                        parent=self,
                    )
                    return False

                # Try to convert to integer
                try:
                    value = int(value_str)
                except ValueError:
                    messagebox.showerror(
                        "Invalid Setting",
                        f"{display_name} must be a valid integer. Got: '{value_str}'",
                        parent=self,
                    )
                    return False

                # Check range
                if not (min_val <= value <= max_val):
                    messagebox.showerror(
                        "Invalid Setting",
                        f"{display_name} must be between {min_val} and {max_val}. Got: {value}",
                        parent=self,
                    )
                    return False

        # Validate AI settings
        if "ai_temperature_var" in self.local_vars:
            temp_value = self.local_vars["ai_temperature_var"].get()
            if not (0.0 <= temp_value <= 2.0):
                messagebox.showerror(
                    "Invalid Setting",
                    f"Temperature must be between 0.0 and 2.0. Got: {temp_value}",
                    parent=self,
                )
                return False

        if "ai_max_tokens_var" in self.local_vars:
            tokens_value = self.local_vars["ai_max_tokens_var"].get()
            if not (1 <= tokens_value <= 32000):
                messagebox.showerror(
                    "Invalid Setting",
                    f"Max Tokens must be between 1 and 32000. Got: {tokens_value}",
                    parent=self,
                )
                return False

        return True

    def _cancel_close_action(self):
        """
        Handles the 'Close' button click.

        With atomic saves, all changes are already saved, so just close.
        """
        logger.info("SettingsDialog", "close_action", "Closing settings dialog.")
        self.destroy()

    # AI Transcription Helper Methods

    def _on_ai_provider_changed(self, *args):
        """Called when AI provider selection changes."""
        # Save current API key before switching providers
        self._save_api_key()

        self._update_model_list()
        self._load_api_key_status()
        self._update_provider_config()

    def _update_model_list(self):
        """Update the model list based on selected provider."""
        provider = self.local_vars["ai_api_provider_var"].get()

        # Define models for each provider
        provider_models = {
            "gemini": [
                "gemini-2.5-flash",
                "gemini-2.5-pro",
                "gemini-2.5-lite",
                "gemini-2.0-flash",
                "gemini-1.5-flash",
                "gemini-1.5-pro",
                "gemini-pro",
            ],
            "openai": [
                "gpt-4o",
                "gpt-4o-mini",
                "gpt-4-turbo",
                "gpt-4",
                "gpt-3.5-turbo",
                "whisper-1",
            ],
            "anthropic": [
                "claude-3-5-sonnet-20241022",
                "claude-3-5-haiku-20241022",
                "claude-3-opus-20240229",
                "claude-3-sonnet-20240229",
                "claude-3-haiku-20240307",
            ],
            "openrouter": [
                "anthropic/claude-3.5-sonnet",
                "openai/gpt-4o",
                "google/gemini-pro-1.5",
                "meta-llama/llama-3.1-405b",
                "mistralai/mistral-large-2407",
                "qwen/qwen-2.5-72b",
                "deepseek/deepseek-coder",
                "perplexity/llama-3.1-sonar-large",
            ],
            "amazon": [
                "anthropic.claude-3-5-sonnet-20241022-v2:0",
                "anthropic.claude-3-haiku-20240307-v1:0",
                "amazon.titan-text-premier-v1:0",
                "ai21.jamba-1-5-large-v1:0",
                "cohere.command-r-plus-v1:0",
            ],
            "qwen": [
                "qwen-plus",
                "qwen-turbo",
                "qwen-max",
                "qwen2.5-72b-instruct",
                "qwen2.5-32b-instruct",
                "qwen2.5-14b-instruct",
                "qwen2.5-7b-instruct",
            ],
            "deepseek": [
                "deepseek-chat",
                "deepseek-coder",
                "deepseek-reasoner",
                "deepseek-v2.5",
                "deepseek-v2",
            ],
            "ollama": [
                "llama3.2:latest",
                "llama3.1:latest",
                "llama3:latest",
                "mistral:latest",
                "codellama:latest",
                "phi3:latest",
                "gemma2:latest",
                "qwen2.5:latest",
                "nomic-embed-text:latest",
            ],
            "lmstudio": [
                "custom-model",
                "llama-3.2-3b-instruct",
                "llama-3.1-8b-instruct",
                "mistral-7b-instruct",
                "codellama-7b-instruct",
                "phi-3-mini",
                "gemma-2-9b-it",
                "qwen2.5-7b-instruct",
            ],
        }

        models = provider_models.get(provider, ["gemini-1.5-flash"])

        if hasattr(self, "model_combobox"):
            self.model_combobox.configure(values=models)
            # Reset to first model if current model not in new list
            current_model = self.local_vars["ai_model_var"].get()
            if current_model not in models:
                self.local_vars["ai_model_var"].set(models[0])

    def _update_temperature_label(self, *args):
        """Update the temperature display label."""
        if hasattr(self, "temperature_label"):
            temp_value = self.local_vars["ai_temperature_var"].get()
            self.temperature_label.configure(text=f"{temp_value:.2f}")

    def _generate_encryption_key(self):
        """Generate or retrieve encryption key for API key storage."""
        if not ENCRYPTION_AVAILABLE:
            return None

        # Try to load existing key from config directory
        config_file_path = self.parent_gui.config.get("config_file_path", "")
        if config_file_path:
            config_dir = os.path.dirname(config_file_path)
        else:
            # Fallback to current directory if config path not available
            config_dir = os.getcwd()
        
        key_file = os.path.join(config_dir, ".hidock_key.dat")

        try:
            if os.path.exists(key_file):
                with open(key_file, "rb") as f:
                    return f.read()
            else:
                # Generate new key
                key = Fernet.generate_key()
                with open(key_file, "wb") as f:
                    f.write(key)
                return key
        except Exception as e:
            logger.error(
                "SettingsDialog",
                "_generate_encryption_key",
                f"Error with encryption key: {e}",
            )
            return None

    def _encrypt_api_key(self, api_key):
        """Encrypt API key for secure storage."""
        if not ENCRYPTION_AVAILABLE or not api_key:
            return api_key  # Return plaintext if encryption not available

        try:
            key = self._generate_encryption_key()
            if key:
                f = Fernet(key)
                encrypted = f.encrypt(api_key.encode())
                return base64.b64encode(encrypted).decode()
            return api_key
        except Exception as e:
            logger.error("SettingsDialog", "_encrypt_api_key", f"Error encrypting API key: {e}")
            return api_key

    def _decrypt_api_key(self, encrypted_key):
        """Decrypt API key from storage."""
        if not ENCRYPTION_AVAILABLE or not encrypted_key:
            return encrypted_key  # Return as-is if encryption not available

        try:
            key = self._generate_encryption_key()
            if key:
                f = Fernet(key)
                encrypted_bytes = base64.b64decode(encrypted_key.encode())
                decrypted = f.decrypt(encrypted_bytes)
                return decrypted.decode()
            return encrypted_key
        except (binascii.Error, ValueError) as e:
            logger.error("SettingsDialog", "_decrypt_api_key", f"Invalid encrypted key format: {e}")
            # Clear the corrupted key
            provider = self.local_vars["ai_api_provider_var"].get()
            config_key = f"ai_api_key_{provider}_encrypted"
            update_config_settings({config_key: ""})
            return ""
        except Exception as e:
            logger.error("SettingsDialog", "_decrypt_api_key", f"Error decrypting API key: {e}")
            # If decryption fails, it might be due to a corrupted key file
            # Try to regenerate the encryption key
            try:
                config_dir = os.path.dirname(self.parent_gui.config.get("config_file_path", ""))
                key_file = os.path.join(config_dir, ".hidock_key.dat")
                if os.path.exists(key_file):
                    os.remove(key_file)
                    logger.info("SettingsDialog", "_decrypt_api_key", "Removed corrupted encryption key file")
            except Exception as cleanup_error:
                logger.warning("SettingsDialog", "_decrypt_api_key", f"Could not clean up key file: {cleanup_error}")
            return ""

    def _load_api_key_status(self):
        """Load and display current API key status."""
        try:
            provider = self.local_vars["ai_api_provider_var"].get()
            encrypted_key = self.parent_gui.config.get(f"ai_api_key_{provider}_encrypted", "")

            if hasattr(self, "api_key_entry") and hasattr(self, "api_key_status_label"):
                if encrypted_key:
                    decrypted_key = self._decrypt_api_key(encrypted_key)
                    if decrypted_key:
                        self.api_key_entry.delete(0, "end")
                        self.api_key_entry.insert(0, decrypted_key)
                        self.api_key_status_label.configure(
                            text="Status: Configured (click Validate to test)",
                            text_color="green",
                        )
                    else:
                        # Decryption failed - clear the entry and show helpful message
                        self.api_key_entry.delete(0, "end")
                        self.api_key_status_label.configure(
                            text="Status: Decryption failed - please re-enter your API key",
                            text_color="red",
                        )
                else:
                    self.api_key_entry.delete(0, "end")
                    self.api_key_status_label.configure(text="Status: Not configured", text_color="orange")
        except Exception as e:
            logger.error(
                "SettingsDialog",
                "_load_api_key_status",
                f"Error loading API key status: {e}",
            )
            # Show error in UI
            if hasattr(self, "api_key_status_label"):
                self.api_key_status_label.configure(
                    text="Status: Error loading key - please re-enter",
                    text_color="red",
                )

    def _validate_api_key(self):
        """Validate the entered API key by making a test API call."""
        if not hasattr(self, "api_key_entry") or not hasattr(self, "api_key_status_label"):
            return

        api_key = self.api_key_entry.get().strip()
        if not api_key:
            self.api_key_status_label.configure(text="Status: Please enter an API key", text_color="red")
            return

        provider = self.local_vars["ai_api_provider_var"].get()
        self.api_key_status_label.configure(text="Status: Validating...", text_color="blue")
        self.validate_key_button.configure(state="disabled")

        # Run validation in background thread
        threading.Thread(target=self._validate_api_key_thread, args=(api_key, provider), daemon=True).start()

    def _validate_api_key_thread(self, api_key, provider):
        """Background thread for API key validation."""
        try:
            # Use ai_service for validation to maintain consistency with multi-provider architecture
            from ai_service import AIServiceManager

            ai_manager = AIServiceManager()
            success = ai_manager.validate_provider(provider, api_key)

            # Update UI on main thread
            self.after(0, self._validation_complete, success)

        except Exception as e:
            logger.error(
                "SettingsDialog",
                "_validate_api_key_thread",
                f"API validation error: {e}",
            )
            self.after(0, self._validation_complete, False)

    def _validation_complete(self, success):
        """Called when API key validation completes."""
        if hasattr(self, "api_key_status_label") and hasattr(self, "validate_key_button"):
            if success:
                self.api_key_status_label.configure(text="Status: Valid API key", text_color="green")
                # Save the validated API key
                self._save_api_key()
            else:
                self.api_key_status_label.configure(text="Status: Invalid API key", text_color="red")
            self.validate_key_button.configure(state="normal")

    def _save_api_key(self, event=None):
        """Save the API key for the current provider."""
        if not hasattr(self, "api_key_entry"):
            return

        api_key = self.api_key_entry.get().strip()
        if not api_key:
            return

        provider = self.local_vars["ai_api_provider_var"].get()
        encrypted_key = self._encrypt_api_key(api_key)

        # Save encrypted API key
        config_key = f"ai_api_key_{provider}_encrypted"
        update_config_settings({config_key: encrypted_key})

        logger.info("SettingsDialog", "_save_api_key", f"Saved API key for provider: {provider}")

    # Enhanced Device Selector Methods

    def _on_device_selected_enhanced(self, device_info):
        """Handle device selection in enhanced selector."""
        try:
            logger.info(
                "SettingsDialog",
                "_on_device_selected_enhanced",
                f"Device selected: {device_info.name}",
            )

            # Update the local variables with selected device
            self.local_vars["selected_vid_var"].set(str(device_info.vendor_id))
            self.local_vars["selected_pid_var"].set(str(device_info.product_id))

            # Update parent GUI and save device selection atomically
            self.parent_gui.selected_vid_var.set(str(device_info.vendor_id))
            self.parent_gui.selected_pid_var.set(str(device_info.product_id))

            # Save only the device selection settings atomically
            device_settings = {"selected_vid": int(device_info.vendor_id), "selected_pid": int(device_info.product_id)}
            update_config_settings(device_settings)

        except Exception as e:
            logger.error(
                "SettingsDialog",
                "_on_device_selected_enhanced",
                f"Error handling device selection: {e}",
            )

    def _on_device_scan_complete(self, devices):
        """Handle completion of device scan."""
        try:
            hidock_count = sum(1 for d in devices if d.is_hidock)
            logger.info(
                "SettingsDialog",
                "_on_device_scan_complete",
                f"Scan complete: {len(devices)} devices, {hidock_count} HiDock devices",
            )

            # If there's a HiDock device and no device is currently selected, auto-select it
            if hidock_count > 0 and not any(d.status == "connected" for d in devices):
                hidock_device = next(d for d in devices if d.is_hidock)
                if hasattr(self, "device_selector") and hasattr(self.device_selector, "_select_device"):
                    self.device_selector._select_device(hidock_device)

        except Exception as e:
            logger.debug(
                "SettingsDialog",
                "_on_device_scan_complete",
                f"Device scan completion handled gracefully: {e}",
            )

    def _initial_enhanced_scan_thread(self):
        """Initial device scan thread for enhanced selector."""
        try:
            # Small delay to let the UI settle
            import time

            time.sleep(0.5)

            # Trigger device scan on main thread
            self.after(0, lambda: self.device_selector.refresh_devices())

        except Exception as e:
            logger.error(
                "SettingsDialog",
                "_initial_enhanced_scan_thread",
                f"Error in initial scan: {e}",
            )

    def _on_appearance_change(self, value):
        """Handle appearance mode change with immediate save and apply."""
        from config_and_logger import update_config_settings
        import customtkinter as ctk

        # Save current window state
        current_x = self.winfo_x()
        current_y = self.winfo_y() 
        current_width = self.winfo_width()
        current_height = self.winfo_height()
        
        # Temporarily remove transient to prevent position issues
        self.transient(None)
        
        # Update the config and parent GUI
        update_config_settings({"appearance_mode": value})
        self.parent_gui.appearance_mode_var.set(value)
        
        # Apply theme to CTk directly (affects this window too)
        ctk.set_appearance_mode(value)
        
        # Update parent's theme
        self.parent_gui.apply_theme_and_color()
        
        # Schedule restoration of window properties
        def restore_window():
            # Restore exact position and size
            self.geometry(f"{current_width}x{current_height}+{current_x}+{current_y}")
            # Re-establish transient relationship
            self.transient(self.parent_gui)
            # Ensure window stays on top and focused
            self.lift()
            self.focus_force()
            self.grab_set()
        
        # Use after to ensure theme changes are applied first
        self.after(50, restore_window)

    def _on_theme_change(self, value):
        """Handle color theme change with immediate save and apply."""
        from config_and_logger import update_config_settings
        import customtkinter as ctk

        # Save current window state
        current_x = self.winfo_x()
        current_y = self.winfo_y()
        current_width = self.winfo_width()
        current_height = self.winfo_height()
        
        # Temporarily remove transient to prevent position issues
        self.transient(None)
        
        # Update the config and parent GUI
        update_config_settings({"color_theme": value})
        self.parent_gui.color_theme_var.set(value)
        
        # Apply the color theme
        try:
            ctk.set_default_color_theme(value)
        except:
            pass  # Theme might not exist or be already set
            
        # Update parent's theme
        self.parent_gui.apply_theme_and_color()
        
        # Schedule restoration of window properties
        def restore_window():
            # Restore exact position and size
            self.geometry(f"{current_width}x{current_height}+{current_x}+{current_y}")
            # Re-establish transient relationship
            self.transient(self.parent_gui)
            # Ensure window stays on top and focused  
            self.lift()
            self.focus_force()
            self.grab_set()
        
        # Use after to ensure theme changes are applied first
        self.after(50, restore_window)

    def _reset_to_defaults(self):
        """Reset all settings to default values."""
        if not messagebox.askyesno(
            "Reset to Defaults",
            "This will reset ALL settings to their default values.\n\nThis action cannot be undone. Continue?",
            parent=self,
        ):
            return

        try:
            from config_and_logger import get_default_config, update_config_settings

            # Save default config (this wipes existing config)
            default_config = get_default_config()
            update_config_settings(default_config.copy())

            # Update parent GUI with defaults
            self.parent_gui.config = default_config.copy()

            # Reload parent GUI variables from defaults
            self.parent_gui._initialize_vars_from_config()

            # Apply theme changes
            self.parent_gui.apply_theme_and_color()

            messagebox.showinfo(
                "Reset Complete",
                "All settings have been reset to defaults.\n\n"
                "Please restart the application for all changes to take effect.",
                parent=self,
            )

            # Close settings dialog
            self.destroy()

        except Exception as e:
            logger.error("SettingsDialog", "_reset_to_defaults", f"Error resetting to defaults: {e}")
            messagebox.showerror("Reset Failed", f"Failed to reset settings: {e}", parent=self)

    def _on_setting_change(self, var_name=None, index=None, mode=None):
        """Handle any setting change with immediate save."""
        if self._settings_dialog_initializing:
            logger.debug("SettingsDialog", "_on_setting_change", f"Skipping {var_name} - dialog initializing")
            return

        # Save only the specific setting that changed atomically
        if var_name:
            logger.debug("SettingsDialog", "_on_setting_change", f"Setting changed: {var_name}")
            self._save_single_setting(var_name)
        else:
            logger.debug("SettingsDialog", "_on_setting_change", "Setting change called without var_name")

    def _save_single_setting(self, var_name):
        """Save a single setting atomically."""
        try:
            if not hasattr(self, "local_vars") or var_name not in self.local_vars:
                logger.debug("SettingsDialog", "_save_single_setting", f"Skipping {var_name} - not in local_vars")
                return

            local_tk_var = self.local_vars[var_name]
            
            # Handle calendar settings specially - they don't have corresponding parent_gui variables
            calendar_var_names = [
                "calendar_tolerance_minutes_var",
                "enable_calendar_integration_var", 
                "calendar_cache_expiry_hours_var",
                "auto_refresh_calendar_on_connect_var",
                "include_organizer_in_display_var",
                "max_meeting_display_length_var"
            ]
            
            if var_name in calendar_var_names:
                value = local_tk_var.get()
                config_key = var_name.replace("_var", "")
                
                # Convert string values to int for numeric calendar settings
                if var_name in ["calendar_tolerance_minutes_var", "calendar_cache_expiry_hours_var", "max_meeting_display_length_var"]:
                    try:
                        value = int(str(value).strip())
                        logger.debug("SettingsDialog", "_save_single_setting", f"Converted {var_name} to int: {value}")
                    except (ValueError, AttributeError):
                        logger.warning("SettingsDialog", "_save_single_setting", f"Invalid numeric value for {var_name}: {value}")
                        return  # Skip invalid values
                
                logger.info("SettingsDialog", "_save_single_setting", f"Saving calendar setting: {config_key} = {value}")
                update_config_settings({config_key: value})
                return
            
            if not hasattr(self.parent_gui, var_name):
                logger.debug("SettingsDialog", "_save_single_setting", f"Skipping {var_name} - not in parent_gui")
                return

            parent_var = getattr(self.parent_gui, var_name)
            value = local_tk_var.get()

            logger.debug("SettingsDialog", "_save_single_setting", f"Processing {var_name} with value: {value}")

            # Convert string values back to integers for numeric variables
            if var_name in [
                "selected_vid_var",
                "selected_pid_var",
                "target_interface_var",
                "recording_check_interval_var",
                "default_command_timeout_ms_var",
                "file_stream_timeout_s_var",
                "auto_refresh_interval_s_var",
                "log_file_max_size_mb_var",
                "log_file_backup_count_var",
            ]:
                try:
                    value = int(str(value).strip())
                    logger.debug("SettingsDialog", "_save_single_setting", f"Converted {var_name} to int: {value}")
                except (ValueError, AttributeError):
                    logger.warning(
                        "SettingsDialog", "_save_single_setting", f"Invalid numeric value for {var_name}: {value}"
                    )
                    return  # Skip invalid values

            # Update parent variable
            parent_var.set(value)

            # Map to config key and save atomically
            config_key = var_name.replace("_var", "")
            if config_key == "logger_processing_level":
                config_key = "log_level"
            elif config_key == "quit_without_prompt":
                config_key = "quit_without_prompt_if_connected"
            elif config_key == "recording_check_interval":
                config_key = "recording_check_interval_s"
            # autoconnect maps directly to autoconnect (no change needed)

            logger.debug("SettingsDialog", "_save_single_setting", f"Mapped {var_name} to config key: {config_key}")

            # Skip device settings and log colors (handled separately)
            if config_key.startswith("log_color_") or config_key.startswith("device_setting_"):
                logger.debug(
                    "SettingsDialog", "_save_single_setting", f"Skipping {config_key} - device/log color setting"
                )
                return

            # Handle AI settings properly
            if config_key.startswith("ai_"):
                # AI API key needs encryption - handle separately
                if config_key == "ai_api_key":
                    logger.debug(
                        "SettingsDialog",
                        "_save_single_setting",
                        f"Skipping {config_key} - API key handled by validate button",
                    )
                    return
                # Save other AI settings normally
                logger.info("SettingsDialog", "_save_single_setting", f"Saving AI setting: {config_key} = {value}")
                update_config_settings({config_key: value})
                return

            logger.info("SettingsDialog", "_save_single_setting", f"Saving setting: {config_key} = {value}")
            update_config_settings({config_key: value})

        except Exception as e:
            logger.error("SettingsDialog", "_save_single_setting", f"Error saving {var_name}: {e}")
    
    def _on_console_logging_enabled_changed(self):
        """Handle console logging enable/disable changes."""
        if not hasattr(self, "local_vars") or "enable_console_logging_var" not in self.local_vars:
            return
        
        enabled = self.local_vars["enable_console_logging_var"].get()
        
        # Enable/disable console logging level combo
        if hasattr(self, "console_log_level_combo"):
            self.console_log_level_combo.configure(state="readonly" if enabled else "disabled")
    
    def _on_gui_logging_enabled_changed(self):
        """Handle GUI logging enable/disable changes."""
        if not hasattr(self, "local_vars") or "enable_gui_logging_var" not in self.local_vars:
            return
        
        enabled = self.local_vars["enable_gui_logging_var"].get()
        
        # Enable/disable GUI logging level combo
        if hasattr(self, "gui_log_level_combo"):
            self.gui_log_level_combo.configure(state="readonly" if enabled else "disabled")
    
    def _on_file_logging_enabled_changed(self):
        """Handle file logging enable/disable changes."""
        if not hasattr(self, "local_vars") or "enable_file_logging_var" not in self.local_vars:
            return
        
        enabled = self.local_vars["enable_file_logging_var"].get()
        
        # Enable/disable file logging related fields
        state = "normal" if enabled else "disabled"
        
        if hasattr(self, "log_file_path_entry"):
            self.log_file_path_entry.configure(state=state)
        if hasattr(self, "log_file_max_size_entry"):
            self.log_file_max_size_entry.configure(state=state)
        if hasattr(self, "log_file_backup_count_entry"):
            self.log_file_backup_count_entry.configure(state=state)
        if hasattr(self, "file_log_level_combo"):
            self.file_log_level_combo.configure(state="readonly" if enabled else "disabled")
    
    def _populate_calendar_tab(self, tab):
        """Populates the 'Calendar Sync' tab with calendar integration settings."""
        scroll_frame = ctk.CTkScrollableFrame(tab, fg_color="transparent")
        scroll_frame.pack(fill="both", expand=True, padx=5, pady=5)

        # 🔍 MEETING DETECTION SECTION
        ctk.CTkLabel(scroll_frame, text="🔍 Meeting Detection:", font=ctk.CTkFont(weight="bold", size=14)).pack(
            anchor="w", pady=(10, 5), padx=5
        )
        
        # Enable Calendar Integration (most important setting first)
        if "enable_calendar_integration_var" not in self.local_vars:
            from config_and_logger import load_config
            config = load_config()
            current_value = config.get('enable_calendar_integration', True)
            self.local_vars["enable_calendar_integration_var"] = ctk.BooleanVar(value=current_value)
            self.local_vars["enable_calendar_integration_var"].trace_add("write", 
                lambda *args: self._on_setting_change("enable_calendar_integration_var"))
            
        ctk.CTkCheckBox(
            scroll_frame,
            text="Enable calendar integration for meeting detection",
            variable=self.local_vars["enable_calendar_integration_var"],
        ).pack(anchor="w", pady=(5, 10), padx=10)

        # Time Tolerance
        ctk.CTkLabel(scroll_frame, text="Time Tolerance (minutes):").pack(anchor="w", pady=(5, 0), padx=10)
        
        if "calendar_tolerance_minutes_var" not in self.local_vars:
            from config_and_logger import load_config
            config = load_config()
            current_value = str(config.get('calendar_tolerance_minutes', 20))
            self.local_vars["calendar_tolerance_minutes_var"] = ctk.StringVar(value=current_value)
            self.local_vars["calendar_tolerance_minutes_var"].trace_add("write", 
                lambda *args: self._on_setting_change("calendar_tolerance_minutes_var"))
            
        ctk.CTkEntry(scroll_frame, textvariable=self.local_vars["calendar_tolerance_minutes_var"], width=100).pack(
            anchor="w", pady=(2, 5), padx=10
        )
        
        # Auto-refresh on connect
        if "auto_refresh_calendar_on_connect_var" not in self.local_vars:
            from config_and_logger import load_config
            config = load_config()
            current_value = config.get('auto_refresh_calendar_on_connect', True)
            self.local_vars["auto_refresh_calendar_on_connect_var"] = ctk.BooleanVar(value=current_value)
            self.local_vars["auto_refresh_calendar_on_connect_var"].trace_add("write", 
                lambda *args: self._on_setting_change("auto_refresh_calendar_on_connect_var"))
            
        ctk.CTkCheckBox(
            scroll_frame,
            text="Automatically check for meetings when connecting to device",
            variable=self.local_vars["auto_refresh_calendar_on_connect_var"],
        ).pack(anchor="w", pady=(5, 15), padx=10)

        # ⚡ PERFORMANCE & OPTIMIZATION SECTION
        ctk.CTkLabel(scroll_frame, text="⚡ Performance & Optimization:", font=ctk.CTkFont(weight="bold", size=14)).pack(
            anchor="w", pady=(15, 5), padx=5
        )
        
        # Calendar Chunking Period (moved from Operation tab)
        ctk.CTkLabel(scroll_frame, text="Calendar Chunking Period:").pack(
            anchor="w", pady=(5, 0), padx=10
        )
        
        ctk.CTkComboBox(
            scroll_frame,
            variable=self.local_vars["calendar_chunking_period_var"],
            values=["1 Day", "1 Week", "2 Weeks", "1 Month", "3 Months"],
            state="readonly",
            width=120,
        ).pack(anchor="w", pady=(2, 5), padx=10)
        
        ctk.CTkLabel(
            scroll_frame,
            text="💡 Larger periods reduce Outlook API calls but may increase initial loading time",
            font=ctk.CTkFont(size=10),
            text_color="gray70",
        ).pack(anchor="w", pady=(0, 10), padx=10)

        # Cache Expiry
        ctk.CTkLabel(scroll_frame, text="Cache Expiry (hours):").pack(anchor="w", pady=(5, 0), padx=10)
        
        if "calendar_cache_expiry_hours_var" not in self.local_vars:
            from config_and_logger import load_config
            config = load_config()
            current_value = str(config.get('calendar_cache_expiry_hours', 24))
            self.local_vars["calendar_cache_expiry_hours_var"] = ctk.StringVar(value=current_value)
            self.local_vars["calendar_cache_expiry_hours_var"].trace_add("write", 
                lambda *args: self._on_setting_change("calendar_cache_expiry_hours_var"))
            
        ctk.CTkEntry(scroll_frame, textvariable=self.local_vars["calendar_cache_expiry_hours_var"], width=100).pack(
            anchor="w", pady=(2, 15), padx=10
        )

        # 📱 DISPLAY PREFERENCES SECTION
        ctk.CTkLabel(scroll_frame, text="📱 Display Preferences:", font=ctk.CTkFont(weight="bold", size=14)).pack(
            anchor="w", pady=(15, 5), padx=5
        )

        # Include organizer option
        if "include_organizer_in_display_var" not in self.local_vars:
            from config_and_logger import load_config
            config = load_config()
            current_value = config.get('include_organizer_in_display', True)
            self.local_vars["include_organizer_in_display_var"] = ctk.BooleanVar(value=current_value)
            self.local_vars["include_organizer_in_display_var"].trace_add("write", 
                lambda *args: self._on_setting_change("include_organizer_in_display_var"))
            
        ctk.CTkCheckBox(
            scroll_frame,
            text="Include meeting organizer in display text",
            variable=self.local_vars["include_organizer_in_display_var"],
        ).pack(anchor="w", pady=(5, 10), padx=10)

        # Max display length
        ctk.CTkLabel(scroll_frame, text="Max Display Length (characters):").pack(anchor="w", pady=(5, 0), padx=10)
        
        if "max_meeting_display_length_var" not in self.local_vars:
            from config_and_logger import load_config
            config = load_config()
            current_value = str(config.get('max_meeting_display_length', 45))
            self.local_vars["max_meeting_display_length_var"] = ctk.StringVar(value=current_value)
            self.local_vars["max_meeting_display_length_var"].trace_add("write", 
                lambda *args: self._on_setting_change("max_meeting_display_length_var"))
            
        ctk.CTkEntry(scroll_frame, textvariable=self.local_vars["max_meeting_display_length_var"], width=100).pack(
            anchor="w", pady=(2, 15), padx=10
        )

        # Bottom note
        ctk.CTkLabel(
            scroll_frame, 
            text="ℹ️ All settings apply immediately to both bulk and individual refresh operations",
            font=ctk.CTkFont(size=11, slant="italic"),
            text_color="gray60",
        ).pack(anchor="w", pady=(15, 10), padx=5)
