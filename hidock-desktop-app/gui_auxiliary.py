# gui_auxiliary.py
"""
Auxiliary Mixin for the HiDock Explorer Tool GUI.

This module provides the `AuxiliaryMixin` class, which contains methods
for handling the settings dialog, GUI logging, and other helper functions.
"""
import tkinter
import traceback
from tkinter import filedialog, messagebox

import usb.core
from config_and_logger import Logger, logger
from settings_window import SettingsDialog


class AuxiliaryMixin:
    """A mixin for auxiliary GUI functions like settings and logging."""

    def open_settings_window(self):
        """Opens the application settings dialog window.

        Ensures only one settings dialog is open at a time and focuses it
        if it already exists. Passes a snapshot of the current configuration
        and the HiDockJensen instance to the dialog.
        """

        # Ensure the dialog is not already open
        if (
            hasattr(self, "_settings_dialog_instance")
            and self._settings_dialog_instance
            and self._settings_dialog_instance.winfo_exists()
        ):
            self._settings_dialog_instance.focus()  # If already open, focus it

        # Pass a copy of the current config for the dialog to work with
        # The dialog will handle its own state and apply changes back to self.config and self (GUI vars)
        current_config_snapshot = self.config.copy()

        # Pass necessary CTk Variables (or their names/accessors) that SettingsDialog needs to read/write
        # For simplicity, pass self (parent_gui) and let SettingsDialog access vars like self.parent_gui.autoconnect_var
        if (
            hasattr(self, "_settings_dialog_instance")
            and self._settings_dialog_instance
            and self._settings_dialog_instance.winfo_exists()
        ):
            self._settings_dialog_instance.focus()  # If already open, focus it
            return

        self._settings_dialog_instance = SettingsDialog(
            parent_gui=self,
            initial_config=current_config_snapshot,
            hidock_instance=self.device_manager.device_interface,
        )
        self._settings_dialog_instance.protocol(
            "WM_DELETE_WINDOW",
            lambda: self._on_settings_dialog_close(self._settings_dialog_instance),
        )

    def _update_default_progressbar_colors(self):
        """
        Updates the default colors for the progress bar based on the current theme.

        This is used to restore the progress bar's appearance after it has been
        changed to indicate an error or warning state.
        """
        if (
            hasattr(self, "status_file_progress_bar")
            and self.status_file_progress_bar.winfo_exists()
        ):
            self.default_progressbar_fg_color = (
                self.status_file_progress_bar.cget("fg_color"),
            )
            self.default_progressbar_progress_color = (
                self.status_file_progress_bar.cget("progress_color"),
            )

    def update_log_colors_gui(self):
        """Updates the log text area to reflect the new filter level."""
        logger.info(
            "GUI",
            "on_gui_log_filter_change",
            f"GUI log display filter to {self.gui_log_filter_level_var.get()}.",
        )

    def _update_log_text_area_tag_colors(
        self,
    ):
        """Updates the foreground colors for different log levels in the GUI log text area."""
        if not hasattr(self, "log_text_area") or not self.log_text_area.winfo_exists():
            return
        log_levels_to_configure = ["ERROR", "WARNING", "INFO", "DEBUG", "CRITICAL"]
        for level_name_upper in log_levels_to_configure:
            level_name_lower = level_name_upper.lower()
            light_var = getattr(self, f"log_color_{level_name_lower}_light_var", None)
            dark_var = getattr(self, f"log_color_{level_name_lower}_dark_var", None)
            if light_var and dark_var:
                color_tuple = (light_var.get(), dark_var.get())
                try:
                    self.log_text_area.tag_config(
                        level_name_upper,
                        foreground=self.apply_appearance_mode_theme_color(color_tuple),
                    )
                except tkinter.TclError as e:
                    logger.error(
                        "GUI",
                        "_update_log_text_area_tag_colors",
                        f"Error applying color for {level_name_upper} with {color_tuple}: {e}",
                    )
            else:
                logger.warning(
                    "GUI",
                    "_update_log_text_area_tag_colors",
                    f"Color StringVars for log level {level_name_upper} not found.",
                )
        logger.debug(
            "GUI",
            "_update_log_text_area_tag_colors",
            "Log text area tag colors updated.",
        )

    def _get_device_display_info(self, dev):
        """
        Fetches display information for a given PyUSB device object.
        Returns a tuple containing the description, VID, PID, and a boolean indicating if there was a problem.
        """
        is_problem = False
        try:
            mfg = (
                usb.util.get_string(dev, dev.iManufacturer, 1000)
                if dev.iManufacturer
                else "N/A"
            )
            prod = (
                usb.util.get_string(dev, dev.iProduct, 1000) if dev.iProduct else "N/A"
            )
            desc = (
                f"{mfg} - {prod} (VID: {hex(dev.idVendor)}, "
                f"PID: {hex(dev.idProduct)})"
            )
        except (usb.core.USBError, NotImplementedError, ValueError) as e_str_fetch:
            is_problem = True
            logger.warning(
                "GUI",
                "scan_usb_devices",
                f"Error getting string for VID={hex(dev.idVendor)} PID={hex(dev.idProduct)} "
                f"({type(e_str_fetch).__name__}): {e_str_fetch}",
            )
            error_type_name = type(e_str_fetch).__name__
            desc = (
                f"[Error Reading Info ({error_type_name})] "
                f"(VID={hex(dev.idVendor)}, PID={hex(dev.idProduct)})"
            )
        return desc, dev.idVendor, dev.idProduct, is_problem

    def _update_settings_device_combobox(
        self, devices, parent_window, initial_load, change_callback
    ):
        """Updates the device selection combobox in the settings dialog."""
        if not (
            hasattr(parent_window, "settings_device_combobox")
            and parent_window.settings_device_combobox.winfo_exists()
        ):
            return

        combobox = parent_window.settings_device_combobox
        combo_list = [d[0] for d in devices]
        combobox.configure(
            values=combo_list if combo_list else ["No devices accessible"]
        )

        settings_vid_var = parent_window.local_vars["selected_vid_var"]
        settings_pid_var = parent_window.local_vars["selected_pid_var"]

        current_sel_str = next(
            (
                d
                for d, v, p, _ in devices
                if v == settings_vid_var.get() and p == settings_pid_var.get()
            ),
            None,
        )

        if current_sel_str and current_sel_str in combo_list:
            combobox.set(current_sel_str)
        elif combo_list and "---" not in combo_list[0]:
            if not initial_load:
                combobox.set(combo_list[0])
                sel_info = next((d for d in devices if d[0] == combo_list[0]), None)
                if sel_info:
                    settings_vid_var.set(sel_info[1])
                    settings_pid_var.set(sel_info[2])
                if change_callback:
                    change_callback()
        elif not combo_list:
            combobox.set("No devices accessible")

    def _on_settings_dialog_close(self, dialog_instance):
        """Logic for when settings dialog is closed with 'x' (behaves like cancel)
        The SettingsDialog's _cancel_close_action handles reset if changes were made."""
        if dialog_instance and dialog_instance.winfo_exists():
            dialog_instance.destroy()
        self._settings_dialog_instance = None

    # scan_usb_devices_for_settings is called by SettingsDialog,
    # but defined here as it relates to main app's available_usb_devices
    def scan_usb_devices_for_settings(
        self, parent_window_for_dialogs, initial_load=False, change_callback=None
    ):  # pylint: disable=too-many-locals, too-many-branches, too-many-statements
        """This method is called by the SettingsDialog. It updates self.available_usb_devices
        and then configures the combobox *in the SettingsDialog*.
        The parent_window_for_dialogs will be the SettingsDialog instance."""
        try:
            # If device is connected, use existing device info instead of scanning
            if self.device_manager.device_interface.is_connected():
                logger.info(
                    "GUI",
                    "scan_usb_devices_for_settings",
                    "Device already connected, using existing device info instead of scanning...",
                )

                # Get current device info
                try:
                    import asyncio

                    device_info = asyncio.run(
                        self.device_manager.device_interface.get_device_info()
                    )
                    connected_device_desc = f"Currently Connected: {device_info.name} (VID={hex(device_info.vendor_id)}, PID={hex(device_info.product_id)})"

                    # Update combobox with connected device
                    if (
                        hasattr(parent_window_for_dialogs, "settings_device_combobox")
                        and parent_window_for_dialogs.settings_device_combobox.winfo_exists()
                    ):
                        parent_window_for_dialogs.settings_device_combobox.configure(
                            values=[connected_device_desc]
                        )
                        parent_window_for_dialogs.settings_device_combobox.set(
                            connected_device_desc
                        )

                        # Update the selected VID/PID to match connected device
                        parent_window_for_dialogs.local_vars["selected_vid_var"].set(
                            device_info.vendor_id
                        )
                        parent_window_for_dialogs.local_vars["selected_pid_var"].set(
                            device_info.product_id
                        )

                    if change_callback:
                        change_callback()
                    return

                except Exception as e:
                    logger.warning(
                        "GUI",
                        "scan_usb_devices_for_settings",
                        f"Failed to get connected device info: {e}, falling back to scan",
                    )

            logger.info(
                "GUI",
                "scan_usb_devices_for_settings",
                "Scanning for USB devices (for settings dialog)...",
            )
            self.available_usb_devices.clear()
            if not self.backend_initialized_successfully:
                if (
                    parent_window_for_dialogs
                    and parent_window_for_dialogs.winfo_exists()
                ):
                    messagebox.showerror(
                        "USB Error",
                        "Libusb backend not initialized.",
                        parent=parent_window_for_dialogs,
                    )  # type: ignore
                if (
                    hasattr(parent_window_for_dialogs, "settings_device_combobox")
                    and parent_window_for_dialogs.settings_device_combobox.winfo_exists()
                ):
                    parent_window_for_dialogs.settings_device_combobox.configure(
                        values=["USB Backend Error"]
                    )  # type: ignore
                    parent_window_for_dialogs.settings_device_combobox.set(
                        "USB Backend Error"
                    )
                return

            # Try to acquire the USB lock with a timeout to prevent deadlocks during downloads
            usb_lock = self.device_manager.device_interface.jensen_device.get_usb_lock()
            lock_acquired = usb_lock.acquire(blocking=False)

            if not lock_acquired:
                # If we can't get the lock immediately, it means downloads are active
                logger.info(
                    "GUI",
                    "scan_usb_devices_for_settings",
                    "USB lock is busy (downloads active), skipping device scan",
                )
                if (
                    hasattr(parent_window_for_dialogs, "settings_device_combobox")
                    and parent_window_for_dialogs.settings_device_combobox.winfo_exists()
                ):
                    parent_window_for_dialogs.settings_device_combobox.configure(
                        values=["Device busy - downloads active"]
                    )
                    parent_window_for_dialogs.settings_device_combobox.set(
                        "Device busy - downloads active"
                    )
                return

            try:
                found_devices = usb.core.find(
                    find_all=True, backend=self.usb_backend_instance
                )
                if not found_devices:
                    if (
                        hasattr(parent_window_for_dialogs, "settings_device_combobox")
                        and parent_window_for_dialogs.settings_device_combobox.winfo_exists()
                    ):
                        parent_window_for_dialogs.settings_device_combobox.configure(
                            values=["No devices found"]
                        )  # type: ignore
                        parent_window_for_dialogs.settings_device_combobox.set(
                            "No devices found"
                        )
                    return

                processed_devices = []
                for dev in found_devices:
                    desc, vid, pid, is_problem = self._get_device_display_info(dev)
                    processed_devices.append((desc, vid, pid, is_problem))
            finally:
                usb_lock.release()

            good_devs = sorted(
                [d for d in processed_devices if not d[3]], key=lambda x: x[0]
            )
            problem_devs = sorted(
                [d for d in processed_devices if d[3]], key=lambda x: x[0]
            )

            # If a device is currently connected, move it to the top of the 'good' list
            if self.device_manager.device_interface.is_connected():
                for i, (desc, vid, pid, _) in enumerate(good_devs):
                    if (
                        vid
                        == self.device_manager.device_interface.jensen_device.device.idVendor
                        and pid
                        == self.device_manager.device_interface.jensen_device.device.idProduct
                    ):
                        name_disp = (
                            self.device_manager.device_interface.jensen_device.model
                            if self.device_manager.device_interface.jensen_device.model
                            != "unknown"
                            else "HiDock Device"
                        )
                        active_desc = f"Currently Connected: {name_disp} (VID={hex(vid)}, PID={hex(pid)})"
                        good_devs[i] = (active_desc, vid, pid, False)
                        good_devs.insert(0, good_devs.pop(i))
                        break

            self.available_usb_devices = good_devs + problem_devs

            if good_devs and "Currently Connected" in good_devs[0][0]:
                good_devs = [good_devs[0]] + sorted(good_devs[1:], key=lambda x: x[0])
            else:
                good_devs.sort(key=lambda x: x[0])
            problem_devs.sort(key=lambda x: x[0])

            all_devices_for_combo = list(good_devs)
            if problem_devs:
                if all_devices_for_combo:
                    all_devices_for_combo.append(
                        ("--- Devices with Issues ---", 0, 0, True)
                    )
                all_devices_for_combo.extend(problem_devs)

            self._update_settings_device_combobox(
                all_devices_for_combo,
                parent_window_for_dialogs,
                initial_load,
                change_callback,
            )

            logger.info(
                "GUI",
                "scan_usb_devices",
                f"Found {len(good_devs)} good, {len(problem_devs)} problem devices.",
            )  # pylint: disable=broad-except
        except (usb.core.USBError, AttributeError, TypeError, tkinter.TclError) as e:
            logger.error(
                "GUI",
                "scan_usb_devices_for_settings",
                f"Unhandled exception: {e}\n{traceback.format_exc()}",
            )
            if parent_window_for_dialogs and parent_window_for_dialogs.winfo_exists():
                messagebox.showerror(
                    "Scan Error",
                    f"Error during USB scan: {e}",
                    parent=parent_window_for_dialogs,
                )

    def _apply_device_settings_thread(
        self, settings_to_apply
    ):  # This is called by SettingsDialog
        if not settings_to_apply:
            logger.info(
                "GUI",
                "_apply_device_settings_thread",
                "No device behavior settings changed.",
            )
            return
        all_successful = True
        for name, value in settings_to_apply.items():
            result = (
                self.device_manager.device_interface.jensen_device.set_device_setting(
                    name, value
                )
            )
            if not result or result.get("result") != "success":
                all_successful = False
                logger.error(
                    "GUI",
                    "_apply_device_settings_thread",
                    f"Failed to set '{name}' to {value}.",
                )
                self.after(
                    0,
                    lambda n=name: messagebox.showwarning(
                        "Settings Error", f"Failed to apply setting: {n}", parent=self
                    ),
                )
        if all_successful:
            logger.info(
                "GUI",
                "_apply_device_settings_thread",
                "All changed device settings applied.",
            )

    def apply_device_settings_from_dialog(self, settings_to_apply):
        """Public wrapper to apply device settings from the settings dialog.

        Args:
        settings_to_apply (dict): A dictionary of settings to apply to the device.
        """
        # This method provides a public interface for the SettingsDialog
        # to request device settings application.
        self._apply_device_settings_thread(settings_to_apply)

    def log_to_gui_widget(self, message, level_name="INFO"):  # Identical to original
        """Logs a message to the GUI log text area.
        Args:
            message (str): The log message to display.
            level_name (str): The log level (e.g., "INFO", "DEBUG", "ERROR").
        """

        def _update_log_task(msg, lvl):
            if not (
                hasattr(self, "log_text_area") and self.log_text_area.winfo_exists()
            ):
                return
            gui_filter_val = Logger.LEVELS.get(
                self.gui_log_filter_level_var.get().upper(), Logger.LEVELS["DEBUG"]
            )
            msg_level_val = Logger.LEVELS.get(lvl.upper(), 0)
            if msg_level_val < gui_filter_val:
                return
            self.log_text_area.configure(state="normal")
            self.log_text_area.insert("end", msg, lvl)
            self.log_text_area.see("end")
            self.log_text_area.configure(state="disabled")

        if self.winfo_exists():
            self.after(0, _update_log_task, message, level_name)

    def clear_log_gui(self):  # Identical to original
        """Clears the log display in the GUI."""
        logger.info("GUI", "clear_log_gui", "Clearing log display.")
        if hasattr(self, "log_text_area") and self.log_text_area.winfo_exists():
            self.log_text_area.configure(state="normal")
            self.log_text_area.delete(1.0, "end")
            self.log_text_area.configure(state="disabled")
            logger.info("GUI", "clear_log_gui", "Log display cleared.")

    def on_gui_log_filter_change(self, _):  # Argument passed by CTkComboBox, not used
        """Handles changes to the GUI log filter level.
        Updates the log text area to reflect the new filter level.
        """
        logger.info(
            "GUI",
            "on_gui_log_filter_change",
            f"GUI log display filter to {self.gui_log_filter_level_var.get()}.",
        )

    def download_gui_logs(self):  # Identical to original, parent=self for dialogs
        """Downloads the GUI logs to a file."""
        if not (hasattr(self, "log_text_area") and self.log_text_area.winfo_exists()):
            return
        log_content = self.log_text_area.get(1.0, "end")
        if not log_content.strip():
            messagebox.showinfo("Download Logs", "Log display is empty.", parent=self)
            return
        filepath = filedialog.asksaveasfilename(
            defaultextension=".log",
            filetypes=[("Log files", "*.log"), ("Text", "*.txt")],
            title="Save GUI Logs",
            parent=self,
        )
        if filepath:
            try:
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(log_content)
                logger.info("GUI", "download_gui_logs", f"GUI logs saved to {filepath}")
                messagebox.showinfo("Download Logs", f"Logs saved to:\n{filepath}", parent=self)  # type: ignore
            except (IOError, OSError, tkinter.TclError) as e:
                logger.error("GUI", "download_gui_logs", f"Error saving logs: {e}")
                messagebox.showerror(
                    "Download Logs Error", f"Failed to save logs: {e}", parent=self
                )
