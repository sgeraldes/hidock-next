# gui_actions_device.py
"""
Device Actions Mixin for the HiDock Explorer Tool GUI.

This module provides the `DeviceActionsMixin` class, which contains methods
for handling direct device communication actions like connecting, disconnecting,
refreshing file lists, and other device-specific commands.
"""
import asyncio
import os
import threading
import tkinter
import traceback
from datetime import datetime
from tkinter import messagebox

import usb.core
from config_and_logger import logger
from ctk_custom_widgets import CTkBanner
from file_operations_manager import FileMetadata


class DeviceActionsMixin:
    """A mixin for handling device-related actions."""

    def _initialize_backend_early(self):  # Identical to original
        error_to_report, local_backend_instance = None, None
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            dll_paths_to_try = (
                [os.path.join(script_dir, name) for name in ["libusb-1.0.dll"]]
                + [
                    os.path.join(script_dir, "MS64", "dll", name)
                    for name in ["libusb-1.0.dll"]
                ]
                + [
                    os.path.join(script_dir, "MS32", "dll", name)
                    for name in ["libusb-1.0.dll"]
                ]
            )
            dll_path = next((p for p in dll_paths_to_try if os.path.exists(p)), None)
            if not dll_path:
                logger.warning(
                    "GUI",
                    "_initialize_backend_early",
                    "libusb-1.0.dll not found locally. Trying system paths.",
                )
                local_backend_instance = usb.backend.libusb1.get_backend()
                if not local_backend_instance:
                    error_to_report = "Libusb backend failed from system paths."
            else:
                logger.info(
                    "GUI",
                    "_initialize_backend_early",
                    f"Attempting backend with DLL: {dll_path}",
                )
                local_backend_instance = usb.backend.libusb1.get_backend(
                    find_library=lambda x: dll_path
                )
                if not local_backend_instance:
                    error_to_report = f"Failed with DLL: {dll_path}. Check 32/64 bit."
            if error_to_report:
                logger.error("GUI", "_initialize_backend_early", error_to_report)
                return False, error_to_report, None
            logger.info(
                "GUI",
                "_initialize_backend_early",
                f"Backend initialized: {local_backend_instance}",
            )
            return True, None, local_backend_instance
        except (
            OSError,
            usb.core.USBError,
            RuntimeError,
            AttributeError,
            ImportError,
        ) as e:
            error_to_report = f"Unexpected error initializing libusb: {e}"
            logger.error(
                "GUI",
                "_initialize_backend_early",
                f"{error_to_report}\n{traceback.format_exc()}",
            )
            return False, error_to_report, None

    def attempt_autoconnect_on_startup(self):  # Enhanced with auto-detection
        """Attempts to autoconnect to the HiDock device on startup if autoconnect is enabled."""
        if not self.backend_initialized_successfully:
            logger.warning(
                "GUI", "attempt_autoconnect", "Skipping autoconnect, USB backend error."
            )
            return
        if (
            self.autoconnect_var.get()
            and not self.device_manager.device_interface.jensen_device.is_connected()
        ):
            logger.info(
                "GUI",
                "attempt_autoconnect",
                "Attempting autoconnect with device discovery...",
            )

            # Try to discover available devices first
            try:
                discovered_devices = asyncio.run(
                    self.device_manager.device_interface.discover_devices()
                )
                if discovered_devices:
                    # Use the first discovered device
                    first_device = discovered_devices[0]
                    logger.info(
                        "GUI",
                        "attempt_autoconnect",
                        f"Auto-discovered device: {first_device.name}",
                    )

                    # Update the selected VID/PID to match the discovered device
                    self.selected_vid_var.set(first_device.vendor_id)
                    self.selected_pid_var.set(first_device.product_id)

                    self.connect_device()
                else:
                    logger.info(
                        "GUI",
                        "attempt_autoconnect",
                        "No HiDock devices discovered, trying configured device...",
                    )
                    self.connect_device()
            except Exception as e:
                logger.warning(
                    "GUI",
                    "attempt_autoconnect",
                    f"Device discovery failed: {e}, trying configured device...",
                )
                self.connect_device()

    def connect_device(self):  # Identical to original, parent=self for dialogs
        """Connects to the HiDock device using the selected VID, PID, and interface."""
        if not self.backend_initialized_successfully:
            logger.error(
                "GUI", "connect_device", "Cannot connect: USB backend not initialized."
            )
            self.update_status_bar(connection_status="Status: USB Backend FAILED!")
            if self.backend_init_error_message:
                messagebox.showerror(
                    "USB Backend Error", self.backend_init_error_message, parent=self
                )
            self._update_menu_states()
            return
        if not self.winfo_exists():
            logger.warning("GUI", "connect_device", "Master window gone, aborting.")
            return
        self.update_status_bar(connection_status="Status: Connecting...")
        self._update_menu_states()
        threading.Thread(target=self._connect_device_thread, daemon=True).start()

    def _connect_device_thread(self):  # Identical to original logic, uses self.after
        """Threaded method to connect to the HiDock device."""
        try:
            device_info = None
            with self.device_lock:
                vid, pid = (
                    self.selected_vid_var.get(),
                    self.selected_pid_var.get(),
                )
                device_id = f"{vid:04x}:{pid:04x}"
                # The connect method returns DeviceInfo, eliminating the need for a separate get_device_info call
                device_info = asyncio.run(
                    self.device_manager.device_interface.connect(device_id=device_id)
                )

            if self.device_manager.device_interface.is_connected() and device_info:
                # Build the status text from the info we just got.
                conn_status_text = (
                    f"Status: Connected ({device_info.model.value or 'HiDock'})"
                )
                if device_info.serial_number != "N/A":
                    conn_status_text += f" SN: {device_info.serial_number}"

                # Update the status bar immediately to show connection success
                # and that we're about to fetch files. This provides instant feedback.
                self.after(
                    0,
                    lambda: self.update_status_bar(
                        connection_status=conn_status_text,
                        progress_text="Fetching file list...",
                    ),
                )
                self.after(0, self._update_menu_states)
                # Update UI to show connected state immediately
                self.after(0, self._show_connected_state)
                # Show cached files immediately if available, then refresh
                if hasattr(self, '_show_cached_files_if_available'):
                    self.after(50, self._show_cached_files_if_available)
                # Load file list with proper delay to ensure cached display completes
                self.after(300, self.refresh_file_list_gui)
                # Start recording status check after file list loads to avoid conflicts
                self.after(500, self.start_recording_status_check)
                if self.auto_refresh_files_var.get():
                    self.after(600, self.start_auto_file_refresh_periodic_check)
            elif (
                self.device_manager.device_interface.is_connected() and not device_info
            ):
                self.after(
                    0,
                    lambda: self.update_status_bar(
                        connection_status="Status: Connected, but failed to get device info."
                    ),
                )
                self.stop_recording_status_check()
                self.stop_auto_file_refresh_periodic_check()
            else:  # Not connected
                logger.info(
                    "GUI",
                    "_connect_device_thread",
                    f"Connection attempt failed.",
                )
                if self.winfo_exists():
                    # Remove previous banner if it exists
                    if (
                        hasattr(self, "_connection_error_banner")
                        and self._connection_error_banner
                        and self._connection_error_banner.winfo_exists()
                    ):
                        self._connection_error_banner.dismiss()

                    # Use the error_message from dock.connect() for the banner
                    banner_message = (
                        f"HiDock device "
                        f"(VID={hex(self.selected_vid_var.get())}, "
                        f"PID={hex(self.selected_pid_var.get())}) not found or "
                        f"connection failed. Ensure it's connected, powered on, "
                        f"and you have permissions."
                    )

                    self._connection_error_banner = CTkBanner(
                        master=self,
                        state="warning",  # "error" or "info" could also be used
                        title=banner_message,
                        # btn1 removed as banner now only has 'X'
                        side="bottom_right",
                        auto_dismiss_after_ms=10000,  # Increased for potentially longer messages
                        width=550,  # Adjusted width
                    )
                    self._connection_error_banner.show()
                self.after(
                    0,
                    lambda: (
                        self.handle_auto_disconnect_ui()
                        if self.winfo_exists()
                        else None
                    ),
                )
        except (usb.core.USBError, ConnectionError, OSError, RuntimeError) as e:
            # Log the technical error for debugging
            logger.error(
                "GUI",
                "_connect_device_thread",
                f"Connection error: {e}",
            )

            # Determine user-friendly error message
            error_str = str(e).lower()
            if "not found" in error_str or "no device" in error_str:
                user_message = "No HiDock device found. Please check that your device is connected and powered on."
                status_message = "Status: Device Not Found"
            elif "health check failed" in error_str or "timeout" in error_str:
                user_message = "Connection failed. Please disconnect and reconnect your device, then try again."
                status_message = "Status: Connection Failed"
            elif "access denied" in error_str or "permission" in error_str:
                user_message = "USB access denied. Please check device permissions or try running as administrator."
                status_message = "Status: Access Denied"
            else:
                user_message = f"Connection failed: {str(e)}"
                status_message = "Status: Connection Error"

            if self.winfo_exists():
                # Show user-friendly error dialog
                self.after(
                    0,
                    lambda: messagebox.showerror(
                        "Connection Error",
                        user_message,
                        parent=self,
                    ),
                )
                self.after(
                    0,
                    lambda: self.update_status_bar(connection_status=status_message),
                )
                if not self.device_manager.device_interface.is_connected():
                    self.after(
                        0,
                        lambda: (
                            self.handle_auto_disconnect_ui()
                            if self.winfo_exists()
                            else None
                        ),
                    )
        finally:
            if self.winfo_exists():
                self.after(0, self._update_menu_states)

    def handle_auto_disconnect_ui(self):  # Identical to original
        """Handles the UI updates when the device is auto-disconnected or connection is lost."""
        logger.warning(
            "GUI",
            "handle_auto_disconnect_ui",
            "Device auto-disconnected or connection lost.",
        )
        self.update_status_bar(connection_status="Status: Disconnected (Error/Lost)")
        if hasattr(self, "file_tree") and self.file_tree.winfo_exists():
            for item in self.file_tree.get_children():
                self.file_tree.delete(item)
        self.displayed_files_details.clear()
        self.update_all_status_info()
        self.stop_auto_file_refresh_periodic_check()
        self.stop_recording_status_check()
        if self.device_manager.device_interface.is_connected():
            asyncio.run(self.device_manager.device_interface.disconnect())
        self._update_menu_states()

    def disconnect_device(self):  # Identical to original
        """Disconnects the HiDock device and updates the UI accordingly."""
        with self.device_lock:
            if self.device_manager.device_interface.is_connected():
                asyncio.run(self.device_manager.device_interface.disconnect())
        self.update_status_bar(connection_status="Status: Disconnected")
        if hasattr(self, "file_tree") and self.file_tree.winfo_exists():
            for item in self.file_tree.get_children():
                self.file_tree.delete(item)
        self.displayed_files_details.clear()
        self.stop_auto_file_refresh_periodic_check()
        self.stop_recording_status_check()
        self.update_all_status_info()
        self._update_menu_states()

    def refresh_file_list_gui(self):  # Identical to original, parent=self for dialogs
        """Refreshes the file list in the GUI by fetching it from the HiDock device."""
        if not self.backend_initialized_successfully:
            logger.warning("GUI", "refresh_file_list_gui", "Backend not init.")
            return
        if not self.device_manager.device_interface.is_connected():
            messagebox.showerror("Error", "Not connected.", parent=self)
            self._update_menu_states()
            return
        if self._is_ui_refresh_in_progress:
            logger.debug("GUI", "refresh_file_list_gui", "Refresh in progress.")
            return
        if self.is_long_operation_active:
            logger.debug(
                "GUI",
                "refresh_file_list_gui",
                "Long operation active, refresh deferred.",
            )
            return
        self._is_ui_refresh_in_progress = True
        self.update_status_bar(progress_text="Fetching file list...")
        self._update_menu_states()

        # Show loading state only if no files are currently displayed
        self.show_loading_state()

        threading.Thread(target=self._refresh_file_list_thread, daemon=True).start()

    def _update_downloaded_file_status(self, files):
        """
        Updates the local_path for files that exist in the download directory.
        This ensures downloaded files show the correct status across app restarts.
        Heavily optimized to minimize file system operations and logging.
        """
        # Get download directory once
        download_dir = getattr(self, 'download_directory', None)
        if not download_dir or not os.path.exists(download_dir):
            return
            
        # Get all files in download directory once
        try:
            downloaded_files = set(os.listdir(download_dir))
        except (OSError, PermissionError):
            return
        
        # Batch process files - minimal logging
        found_count = 0
        for f_info in files:
            # Generate the safe filename as _get_local_filepath does
            safe_filename = (
                f_info.filename.replace(":", "-")
                .replace(" ", "_")
                .replace("\\", "_")
                .replace("/", "_")
            )
            if safe_filename in downloaded_files:
                local_filepath = os.path.join(download_dir, safe_filename)
                # Skip the isfile check for performance - trust the directory listing
                f_info.local_path = local_filepath
                found_count += 1
        
        # Single summary log instead of per-file logging
        if found_count > 0:
            logger.debug(
                "GUI",
                "_update_downloaded_file_status", 
                f"Found {found_count} downloaded files"
            )

    def _show_connected_state(self):
        """Update UI to show connected state without waiting for file list."""
        try:
            if hasattr(self, 'update_status_bar'):
                self.update_status_bar(
                    connection_status="Status: Connected",
                    progress_text="Loading files..."
                )
            # Update any other UI elements that need to show connected state
            if hasattr(self, '_update_menu_states'):
                self._update_menu_states()
        except Exception as e:
            logger.warning("GUI", "_show_connected_state", f"Error updating UI: {e}")

    def _show_cached_files_if_available(self):
        """Show cached files immediately if available to improve perceived performance."""
        try:
            cached_files = self.file_operations_manager.metadata_cache.get_all_metadata()
            if cached_files:
                logger.info("GUI", "_show_cached_files_if_available", 
                           f"Showing {len(cached_files)} cached files")
                
                # Convert cached files to GUI format - optimized with list comprehension
                files_dict = [
                    {
                        "name": f_info.filename,
                        "length": f_info.size,
                        "duration": f_info.duration,
                        "createDate": (
                            f_info.date_created.strftime("%Y/%m/%d")
                            if f_info.date_created
                            else "---"
                        ),
                        "createTime": (
                            f_info.date_created.strftime("%H:%M:%S")
                            if f_info.date_created
                            else "---"
                        ),
                        "time": f_info.date_created,
                        "version": "⟳",  # Refreshing indicator
                        "original_index": i + 1,
                        "gui_status": "Cached" if not f_info.local_path else "Downloaded",
                        "local_path": f_info.local_path,
                        "checksum": f_info.checksum,
                    }
                    for i, f_info in enumerate(cached_files)
                ]
                
                # Update GUI with cached data
                sorted_files = self._apply_saved_sort_state_to_tree_and_ui(files_dict)
                self._populate_treeview_from_data(sorted_files)
                self.update_status_bar(
                    connection_status="Status: Connected",
                    progress_text=f"Showing {len(cached_files)} cached files, refreshing..."
                )
        except Exception as e:
            logger.warning("GUI", "_show_cached_files_if_available", f"Error showing cached files: {e}")

    def _refresh_file_list_thread(self):  # Identical to original logic, uses self.after
        """Threaded method to refresh the file list in the GUI."""
        try:
            files = None
            recording_info = None
            all_files_to_display = []

            with self.device_lock:
                # Always fetch fresh data from device to ensure we have the latest files
                recording_info = asyncio.run(
                    self.device_manager.device_interface.get_recordings()
                )
                
                # Get storage info after file list to avoid command conflicts
                card_info = asyncio.run(
                    self.device_manager.device_interface.get_storage_info()
                )
                
                # Check cache to see how many files we had before
                cached_files = self.file_operations_manager.metadata_cache.get_all_metadata()
                cached_count = len(cached_files)
                
                # If we got fresh data from device, decide how to handle it
                if recording_info:
                    if len(recording_info) >= cached_count:
                        # Device returned complete data, update cache fully
                        logger.info(
                            "GUI", 
                            "_refresh_file_list_thread", 
                            f"Updating cache with {len(recording_info)} files from device"
                        )
                        device_files = recording_info
                        for f in device_files:
                            # Handle both AudioRecording objects and raw dictionaries
                            if isinstance(f, dict):
                                # Raw dictionary from adapter
                                filename = f["name"]
                                size = f["length"]
                                duration = f["duration"]
                                # Parse date from createDate and createTime strings
                                try:
                                    date_str = f"{f.get('createDate', '')} {f.get('createTime', '')}".strip()
                                    if date_str and date_str != "---":
                                        date_created = datetime.strptime(date_str, "%Y/%m/%d %H:%M:%S")
                                    else:
                                        date_created = None
                                except (ValueError, TypeError):
                                    date_created = None
                                local_path = f.get("local_path")
                                checksum = f.get("checksum")
                            else:
                                # AudioRecording object
                                filename = f.filename
                                size = f.size
                                duration = f.duration
                                date_created = f.date_created
                                local_path = getattr(f, "local_path", None)
                                checksum = getattr(f, "checksum", None)
                                
                            metadata_to_cache = FileMetadata(
                                filename=filename,
                                size=size,
                                duration=duration,
                                date_created=date_created,
                                device_path=filename,
                                local_path=local_path,
                                checksum=checksum,
                            )
                            self.file_operations_manager.metadata_cache.set_metadata(
                                metadata_to_cache
                            )
                        files = (
                            self.file_operations_manager.metadata_cache.get_all_metadata()
                        )
                    else:
                        # Device returned incomplete data - try to merge new files with cache
                        logger.warning(
                            "GUI", 
                            "_refresh_file_list_thread", 
                            f"Device returned incomplete data ({len(recording_info)} vs {cached_count} cached), attempting merge"
                        )
                        # Create a set of cached filenames for quick lookup
                        cached_filenames = {f.filename for f in cached_files}
                        
                        # Add any new files from device data to cache
                        new_files_added = 0
                        for f in recording_info:
                            filename = f["name"] if isinstance(f, dict) else f.filename
                            if filename not in cached_filenames:
                                # This is a new file not in cache
                                if isinstance(f, dict):
                                    # Raw dictionary from adapter  
                                    size = f["length"]
                                    duration = f["duration"]
                                    try:
                                        date_str = f"{f.get('createDate', '')} {f.get('createTime', '')}".strip()
                                        if date_str and date_str != "---":
                                            date_created = datetime.strptime(date_str, "%Y/%m/%d %H:%M:%S")
                                        else:
                                            date_created = None
                                    except (ValueError, TypeError):
                                        date_created = None
                                    local_path = f.get("local_path")
                                    checksum = f.get("checksum")
                                else:
                                    # AudioRecording object
                                    size = f.size
                                    duration = f.duration
                                    date_created = f.date_created
                                    local_path = getattr(f, "local_path", None)
                                    checksum = getattr(f, "checksum", None)
                                    
                                metadata_to_cache = FileMetadata(
                                    filename=filename,
                                    size=size,
                                    duration=duration,
                                    date_created=date_created,
                                    device_path=filename,
                                    local_path=local_path,
                                    checksum=checksum,
                                )
                                self.file_operations_manager.metadata_cache.set_metadata(
                                    metadata_to_cache
                                )
                                new_files_added += 1
                        
                        if new_files_added > 0:
                            logger.info(
                                "GUI", 
                                "_refresh_file_list_thread", 
                                f"Added {new_files_added} new files to cache from incomplete device data"
                            )
                        
                        # Use updated cache which now includes any new files
                        files = (
                            self.file_operations_manager.metadata_cache.get_all_metadata()
                        )
                else:
                    # Device fetch failed, returned no data, or returned incomplete data
                    # Use cached data as fallback
                    if recording_info:
                        logger.warning(
                            "GUI", 
                            "_refresh_file_list_thread", 
                            f"Device fetch incomplete ({len(recording_info)} vs {cached_count} cached), using cached data"
                        )
                    else:
                        logger.warning(
                            "GUI", 
                            "_refresh_file_list_thread", 
                            "Device fetch failed, using cached data"
                        )
                    files = cached_files  # Use the already loaded cached files

            # Process the fetched data outside the lock
            self.after(0, self.update_all_status_info)

            # Duration correction is now handled directly in hidock_device.py
            # by the _calculate_file_duration method, eliminating the magic number

            # Check for downloaded files and update their status (optimized)
            self._update_downloaded_file_status(files)

            # Convert FileMetadata objects to dictionaries in the format the GUI expects
            # Also include version info from raw recording_info data
            files_dict = []
            
            # Create a lookup for version info from raw recording data
            version_lookup = {}
            if recording_info:
                for raw_file in recording_info:
                    if isinstance(raw_file, dict):
                        version_lookup[raw_file["name"]] = raw_file.get("version", "N/A")
            
            for i, f_info in enumerate(files):
                # Determine GUI status based on local file existence and active operations
                gui_status = "On Device"
                if f_info.local_path and os.path.exists(f_info.local_path):
                    gui_status = "Downloaded"

                # Check if file is queued for download or in progress
                active_ops = self.file_operations_manager.get_all_active_operations()
                for op in active_ops:
                    if op.filename == f_info.filename:
                        from file_operations_manager import FileOperationStatus

                        if op.status == FileOperationStatus.PENDING:
                            gui_status = "Queued"
                        elif op.status == FileOperationStatus.IN_PROGRESS:
                            gui_status = f"Downloading ({op.progress:.0f}%)"
                        break

                # Get version from raw recording info
                version = version_lookup.get(f_info.filename, "N/A")

                files_dict.append(
                    {
                        "name": f_info.filename,
                        "length": f_info.size,
                        "duration": f_info.duration,
                        "createDate": (
                            f_info.date_created.strftime("%Y/%m/%d")
                            if f_info.date_created
                            else "---"
                        ),
                        "createTime": (
                            f_info.date_created.strftime("%H:%M:%S")
                            if f_info.date_created
                            else "---"
                        ),
                        "time": f_info.date_created,  # For sorting
                        "version": version,  # Add version field from raw data
                        "original_index": i + 1,
                        "gui_status": gui_status,
                        # Carry over other fields that might be used elsewhere
                        "local_path": f_info.local_path,
                        "checksum": f_info.checksum,
                    }
                )

            # Use robust recording detection instead of assuming first item is recording
            current_recording_filename = None
            try:
                current_recording_filename = asyncio.run(
                    self.device_manager.device_interface.get_current_recording_filename()
                )
            except Exception as e:
                logger.debug(
                    "GUI",
                    "_refresh_file_list_thread",
                    f"Could not get current recording filename: {e}",
                )

            # If there's an active recording, ensure it's marked in the file list
            if current_recording_filename:
                # Check if the recording file is already in the list
                recording_file_found = False
                for f in files_dict:
                    if f.get("name") == current_recording_filename:
                        f["is_recording"] = True
                        f["duration"] = "Recording..."
                        recording_file_found = True
                        break

                # If recording file is not in the main list, add it
                if not recording_file_found:
                    files_dict.insert(
                        0,
                        {
                            "name": current_recording_filename,
                            "length": 0,
                            "duration": "Recording...",
                            "createDate": "In Progress",
                            "createTime": "",
                            "time": datetime.now(),
                            "is_recording": True,
                        },
                    )
            all_files_to_display = list(files_dict)

            if all_files_to_display:
                if (
                    self.saved_treeview_sort_column
                    and self.saved_treeview_sort_column in self.original_tree_headings
                ):
                    all_files_to_display = self._apply_saved_sort_state_to_tree_and_ui(
                        all_files_to_display
                    )
                elif self.treeview_sort_column:
                    all_files_to_display = self._sort_files_data(
                        all_files_to_display,
                        self.treeview_sort_column,
                        self.treeview_sort_reverse,
                    )
                self.after(0, self._populate_treeview_from_data, all_files_to_display)
            else:
                self.after(
                    0,
                    lambda: self.update_status_bar(
                        progress_text=(
                            f"Error: Failed to list files"
                            if not files
                            else "Ready. No files found."
                        )
                    ),
                )
        except ConnectionError as ce:
            logger.error("GUI", "_refresh_thread", f"ConnErr: {ce}")
            self.after(0, self.handle_auto_disconnect_ui)
        except (usb.core.USBError, tkinter.TclError) as e:
            logger.error(
                "GUI", "_refresh_thread", f"Error: {e}\n{traceback.format_exc()}"
            )
            self.after(
                0, lambda: self.update_status_bar(progress_text="Error loading files.")
            )
        finally:
            self.after(0, lambda: setattr(self, "_is_ui_refresh_in_progress", False))
            self.after(0, self._update_menu_states)
            self.after(
                0,
                lambda: self.update_status_bar(
                    progress_text=(
                        "Ready."
                        if self.device_manager.device_interface.is_connected()
                        else "Disconnected."
                    )
                ),
            )
            self.after(0, self.update_all_status_info)

    def start_recording_status_check(self):  # Identical to original
        """Starts periodic checking of the recording status."""
        interval_s = self.recording_check_interval_var.get()
        if interval_s <= 0:
            logger.info("GUI", "start_rec_check", "Rec check interval <= 0, disabled.")
            self.stop_recording_status_check()
            return
        self.stop_recording_status_check()
        self._check_recording_status_periodically()

    def stop_recording_status_check(self):  # Identical to original
        """Stops periodic checking of the recording status."""
        if self._recording_check_timer_id:
            self.after_cancel(self._recording_check_timer_id)
            self._recording_check_timer_id = None

    def _check_recording_status_periodically(
        self,
    ):  # Identical to original logic, uses self.after
        """Periodically checks the recording status and updates the GUI."""
        try:
            if not self.device_manager.device_interface.is_connected():
                self.stop_recording_status_check()
                return
            if self.is_long_operation_active:
                return

            if self.device_lock.acquire(blocking=False):
                try:
                    # Use the new lightweight method instead of the heavy get_recordings()
                    current_recording_filename = asyncio.run(
                        self.device_manager.device_interface.get_current_recording_filename()
                    )
                    if not self.device_manager.device_interface.is_connected():
                        self.stop_recording_status_check()
                        return

                    # A change in the reported filename indicates a new recording has started,
                    # or the previous one has finished (filename becomes None).
                    if current_recording_filename != self._previous_recording_filename:
                        logger.info(
                            "GUI",
                            "_check_rec_status",
                            f"Recording status changed (prev: '{self._previous_recording_filename}', "
                            f"new: '{current_recording_filename}'). Refreshing file list.",
                        )
                        self._previous_recording_filename = current_recording_filename
                        self.refresh_file_list_gui()
                finally:
                    self.device_lock.release()
            else:
                logger.debug(
                    "GUI", "_check_rec_status", "Skipping check, device is busy."
                )
        except (ConnectionError, usb.core.USBError, tkinter.TclError) as e:
            logger.error(
                "GUI", "_check_rec_status", f"Unhandled: {e}\n{traceback.format_exc()}"
            )
        finally:
            if self.winfo_exists():  # Check if window still exists
                interval_ms = self.recording_check_interval_var.get() * 1000
                if interval_ms <= 0:
                    self.stop_recording_status_check()
                else:
                    self._recording_check_timer_id = self.after(
                        interval_ms, self._check_recording_status_periodically
                    )

    def start_auto_file_refresh_periodic_check(self):  # Identical to original
        """Starts periodic checking for file list refresh based on the auto-refresh settings."""
        self.stop_auto_file_refresh_periodic_check()
        if (
            self.auto_refresh_files_var.get()
            and self.device_manager.device_interface.is_connected()
        ):
            interval_s = self.auto_refresh_interval_s_var.get()
            if interval_s <= 0:
                logger.info("GUI", "start_auto_refresh", "Interval <=0, disabled.")
                return
            # Don't call immediately. The connect logic already does an initial refresh.
            # Schedule the first check to happen after the interval.
            interval_ms = interval_s * 1000
            logger.info(
                "GUI",
                "start_auto_refresh",
                f"Auto-refresh scheduled to run every {interval_s} seconds.",
            )
            self._auto_file_refresh_timer_id = self.after(
                interval_ms, self._check_auto_file_refresh_periodically
            )

    def stop_auto_file_refresh_periodic_check(self):  # Identical to original
        """Stops periodic checking for file list refresh."""
        if self._auto_file_refresh_timer_id:
            self.after_cancel(self._auto_file_refresh_timer_id)
            self._auto_file_refresh_timer_id = None

    def _check_auto_file_refresh_periodically(
        self,
    ):  # Identical to original logic, uses self.after
        """Periodically checks if the file list needs to be refreshed."""
        try:
            if (
                not self.device_manager.device_interface.is_connected()
                or not self.auto_refresh_files_var.get()
            ):
                self.stop_auto_file_refresh_periodic_check()
                return
            if self.is_long_operation_active:
                return
            self.refresh_file_list_gui()
        except (ConnectionError, usb.core.USBError, tkinter.TclError) as e:
            logger.error(
                "GUI",
                "_check_auto_refresh",
                f"Unhandled: {e}\n{traceback.format_exc()}",
            )
        finally:
            if self.winfo_exists():
                interval_ms = self.auto_refresh_interval_s_var.get() * 1000
                if interval_ms <= 0:
                    self.stop_auto_file_refresh_periodic_check()
                else:
                    self._auto_file_refresh_timer_id = self.after(
                        interval_ms, self._check_auto_file_refresh_periodically
                    )

    def format_sd_card_gui(self):  # Uses CTkInputDialog, parent=self for dialogs
        """Handles the formatting of the SD card in the GUI."""
        if not self.device_manager.device_interface.is_connected():
            messagebox.showerror("Error", "Not connected.", parent=self)
            return
        if not messagebox.askyesno(
            "Confirm Format",
            "WARNING: This will erase ALL data. Continue?",
            parent=self,
        ) or not messagebox.askyesno(
            "Final Confirmation",
            "FINAL WARNING: Formatting will erase everything. Continue?",
            parent=self,
        ):
            return
        dialog = self.CTkInputDialog(
            text="Type 'FORMAT' to confirm formatting.", title="Type Confirmation"
        )
        confirm_text = dialog.get_input()  # This will show the dialog and return input
        if confirm_text is None or confirm_text.upper() != "FORMAT":
            messagebox.showwarning(
                "Format Cancelled", "Confirmation text mismatch.", parent=self
            )
            return
        self._set_long_operation_active_state(True, "Formatting Storage")
        threading.Thread(target=self._format_sd_card_thread, daemon=True).start()

    def _format_sd_card_thread(
        self,
    ):  # Identical to original logic, uses self.after, parent=self for dialogs
        """Formats the SD card in a separate thread."""
        self.after(
            0,
            lambda: self.update_status_bar(
                progress_text="Formatting Storage... Please wait."
            ),
        )
        status = asyncio.run(self.device_manager.device_interface.format_storage())
        if status and status.get("result") == "success":
            self.after(
                0,
                lambda: messagebox.showinfo(
                    "Format Success", "Storage formatted successfully.", parent=self
                ),
            )
        else:
            self.after(
                0,
                lambda s=status: messagebox.showerror(
                    "Format Failed",
                    f"Failed to format storage: {s.get('error', s.get('result', 'Unknown'))}",
                    parent=self,
                ),
            )
        self.after(
            0,
            lambda: self.update_status_bar(progress_text="Format operation finished."),
        )
        self.after(0, self.refresh_file_list_gui)
        self.after(
            0, self._set_long_operation_active_state, False, "Formatting Storage"
        )

    def sync_device_time_gui(self):  # Identical to original, parent=self for dialogs
        """Synchronizes the device time with the computer's current time."""
        if not self.device_manager.device_interface.is_connected():
            messagebox.showerror("Error", "Not connected.", parent=self)
            return
        if not messagebox.askyesno(
            "Confirm Sync Time",
            "Set device time to computer's current time?",
            parent=self,
        ):
            return
        self._set_long_operation_active_state(True, "Time Sync")
        threading.Thread(target=self._sync_device_time_thread, daemon=True).start()

    def _sync_device_time_thread(
        self,
    ):  # Identical to original logic, uses self.after, parent=self for dialogs
        """Synchronizes the device time in a separate thread."""
        self.after(
            0, lambda: self.update_status_bar(progress_text="Syncing device time...")
        )
        result = asyncio.run(self.device_manager.device_interface.sync_time())
        if result and result.get("result") == "success":
            self.after(
                0,
                lambda: messagebox.showinfo(
                    "Time Sync", "Device time synchronized.", parent=self
                ),
            )
        else:
            err = result.get("error", "Unknown") if result else "Comm error"
            if result and "device_code" in result:
                err += f" (Dev code: {result['device_code']})"
            self.after(
                0,
                lambda e=err: messagebox.showerror(
                    "Time Sync Error", f"Failed to sync time: {e}", parent=self
                ),
            )
        self.after(0, self._set_long_operation_active_state, False, "Time Sync")
        self.after(
            0, lambda: self.update_status_bar(progress_text="Time sync finished.")
        )
