# gui_event_handlers.py
"""
Event Handlers Mixin for the HiDock Explorer Tool GUI.

This module provides the `EventHandlersMixin` class, which contains methods
for handling GUI events such as button clicks, key presses, and selection changes.
"""
import os
import subprocess
import sys
import tkinter
from tkinter import filedialog, messagebox

import customtkinter as ctk
from config_and_logger import logger


class EventHandlersMixin:
    """A mixin for handling GUI events."""

    def _open_download_dir_in_explorer(self, _event=None):
        """
        Opens the configured download directory in the system's file explorer.

        Handles different platforms (Windows, macOS, Linux). Shows a warning
        if the directory is not set or does not exist.

        Args:
            event: The event object (optional, typically from a bind).
        """
        if not self.download_directory or not os.path.isdir(self.download_directory):
            messagebox.showwarning(
                "Open Directory",
                f"Download directory is not set or does not exist:\n{self.download_directory}",
                parent=self,
            )
            logger.warning(
                "GUI",
                "_open_download_dir_in_explorer",
                f"Download directory '{self.download_directory}' not valid or not set.",
            )
            return
        try:
            logger.info(
                "GUI",
                "_open_download_dir_in_explorer",
                f"Opening download directory: {self.download_directory}",
            )
            if sys.platform == "win32":
                os.startfile(os.path.realpath(self.download_directory))
            elif sys.platform == "darwin":
                subprocess.call(["open", self.download_directory])
            else:
                subprocess.call(["xdg-open", self.download_directory])
        except FileNotFoundError:
            messagebox.showerror(
                "Open Directory",
                f"Could not open directory. Associated command not found for your system ('{sys.platform}').",
                parent=self,
            )
            logger.error(
                "GUI",
                "_open_download_dir_in_explorer",
                f"File explorer command not found for {sys.platform}.",
            )
        except OSError as e:
            messagebox.showerror(
                "Open Directory",
                f"Failed to open directory:\n{self.download_directory}\nError: {e}",
                parent=self,
            )
            logger.error(
                "GUI",
                "_open_download_dir_in_explorer",
                f"Failed to open directory '{self.download_directory}': {e}",
            )

    def _select_download_dir_from_header_button(self, _event=None):
        """
        Handles selecting the download directory via a button, typically in the header.

        Prompts the user to select a directory, updates the configuration,
        and refreshes relevant UI elements.

        Args:
            event: The event object (optional, typically from a bind).
        """
        new_dir = self._prompt_for_directory(
            initial_dir=self.download_directory, parent_window_for_dialog=self
        )
        if new_dir and new_dir != self.download_directory:
            self.download_directory = new_dir

            self.config["download_directory"] = new_dir
            self.save_config(self.config)
            if (
                hasattr(self, "download_dir_button_header")
                and self.download_dir_button_header.winfo_exists()
            ):
                self.download_dir_button_header.configure(
                    text=f"Dir: {os.path.basename(self.download_directory)}"
                )
            logger.info(
                "GUI",
                "_select_download_dir_from_header_button",
                f"Download directory changed to: {new_dir}",
            )
            self.update_all_status_info()

    def _prompt_for_directory(self, initial_dir, parent_window_for_dialog):
        """
        Prompts the user to select a directory using a standard dialog.

        Args:
            initial_dir (str): The directory to initially display in the dialog.
            parent_window_for_dialog (tkinter.Tk or tkinter.Toplevel): The parent window for the dialog.

        Returns:
            str or None: The path to the selected directory, or None if cancelled.
        """
        new_dir = filedialog.askdirectory(
            initialdir=initial_dir,
            title="Select Download Directory",
            parent=parent_window_for_dialog,
        )
        return new_dir

    def _on_file_button1_press(self, event):  # Identical to original logic
        """
        Handles the Button-1 press event on the file Treeview.

        Manages item selection, deselection, and sets up for potential drag-selection.
        Handles Ctrl and Shift modifiers for selection behavior.
        """
        item_iid = self.file_tree.identify_row(event.y)
        self._is_button1_pressed_on_item = item_iid
        self._last_dragged_over_iid = item_iid
        self._drag_action_is_deselect = False
        if not item_iid:
            self._is_button1_pressed_on_item = None
            logger.debug(
                "GUI", "_on_file_button1_press", "Button 1 pressed on empty space."
            )
            return
        current_selection = self.file_tree.selection()
        is_currently_selected_before_toggle = item_iid in current_selection
        if is_currently_selected_before_toggle:
            self._drag_action_is_deselect = True
            logger.debug(
                "GUI",
                "_on_file_button1_press",
                f"Drag will DESELECT. Anchor '{item_iid}' was selected.",
            )
        else:
            logger.debug(
                "GUI",
                "_on_file_button1_press",
                f"Drag will SELECT. Anchor '{item_iid}' was not selected.",
            )
        ctrl_pressed = (event.state & 0x0004) != 0
        shift_pressed = (event.state & 0x0001) != 0
        if shift_pressed:
            logger.debug(
                "GUI",
                "_on_file_button1_press",
                f"Shift+Click on item: {item_iid}. Allowing default range selection.",
            )
            return
        if is_currently_selected_before_toggle:
            self.file_tree.selection_remove(item_iid)
            logger.debug(
                "GUI",
                "_on_file_button1_press",
                f"Toggled OFF item: {item_iid} (Modifier: {'Ctrl' if ctrl_pressed else 'None'})",
            )
        else:
            self.file_tree.selection_add(item_iid)
            logger.debug(
                "GUI",
                "_on_file_button1_press",
                f"Toggled ON item: {item_iid} (Modifier: {'Ctrl' if ctrl_pressed else 'None'})",
            )
        return "break"

    def _on_file_b1_motion(self, event):  # Identical to original logic
        """
        Handles the Button-1 motion (drag) event on the file Treeview.

        Performs drag-selection or drag-deselection of items based on the
        initial state of the anchor item when the drag started.
        """
        if (
            not hasattr(self, "_is_button1_pressed_on_item")
            or not self._is_button1_pressed_on_item
        ):
            return
        item_iid_under_cursor = self.file_tree.identify_row(event.y)
        if item_iid_under_cursor != self._last_dragged_over_iid:
            self._last_dragged_over_iid = item_iid_under_cursor
            if self._is_button1_pressed_on_item:
                all_children = self.file_tree.get_children("")
                try:
                    anchor_index = all_children.index(self._is_button1_pressed_on_item)
                    current_motion_index = -1
                    if item_iid_under_cursor and item_iid_under_cursor in all_children:
                        current_motion_index = all_children.index(item_iid_under_cursor)
                    else:
                        if not item_iid_under_cursor:
                            return
                    start_range_idx = min(anchor_index, current_motion_index)
                    end_range_idx = max(anchor_index, current_motion_index)
                    items_in_current_drag_sweep = all_children[
                        start_range_idx : end_range_idx + 1
                    ]
                    if self._drag_action_is_deselect:
                        logger.debug(
                            "GUI",
                            "_on_file_b1_motion",
                            f"Drag-DESELECTING items in sweep: {items_in_current_drag_sweep}",
                        )
                        for item_to_process in items_in_current_drag_sweep:
                            self.file_tree.selection_remove(item_to_process)
                    else:
                        logger.debug(
                            "GUI",
                            "_on_file_b1_motion",
                            f"Drag-SELECTING items in sweep: {items_in_current_drag_sweep}",
                        )
                        for item_to_process in items_in_current_drag_sweep:
                            self.file_tree.selection_add(item_to_process)
                except ValueError:
                    logger.warning(
                        "GUI",
                        "_on_file_b1_motion",
                        "Anchor or current item not found in tree children during drag.",
                    )

    def _on_file_button1_release(self, _event):  # Identical to original logic
        """
        Handles the Button-1 release event on the file Treeview.

        Finalizes any drag-selection operation and resets drag state variables.
        Updates menu states based on the new selection.
        """
        logger.debug(
            "GUI",
            "_on_file_button1_release",
            f"Button 1 released. Final selection: {self.file_tree.selection()}",
        )
        self._is_button1_pressed_on_item = None
        self._last_dragged_over_iid = None
        self._drag_action_is_deselect = False
        self._update_menu_states()

    def _update_optional_panes_visibility(self):  # Identical to original logic
        """
        Updates the visibility of optional panes (e.g., Logs pane).

        Manages the grid layout and row weights to show or hide panes as configured.
        """

        if (
            not hasattr(self, "main_content_frame")
            or not self.main_content_frame.winfo_exists()
        ):
            logger.error(
                "GUI",
                "_update_optional_panes_visibility",
                "main_content_frame not found.",
            )
            return
        if not hasattr(self, "log_frame") or not self.log_frame.winfo_exists():
            logger.error(
                "GUI", "_update_optional_panes_visibility", "log_frame not found."
            )
            return
        logs_are_visible = self.logs_visible_var.get()
        if logs_are_visible:
            if not self.log_frame.winfo_ismapped():
                self.log_frame.grid(row=1, column=0, sticky="nsew", padx=5, pady=(5, 0))
            self.main_content_frame.grid_rowconfigure(0, weight=3)
            self.main_content_frame.grid_rowconfigure(1, weight=1)
        else:
            if self.log_frame.winfo_ismapped():
                self.log_frame.grid_forget()
            self.main_content_frame.grid_rowconfigure(0, weight=1)
            self.main_content_frame.grid_rowconfigure(1, weight=0)

    def toggle_logs(self):  # Identical to original logic
        """
        Toggles the visibility of the Logs pane.

        Reads the state from `self.logs_visible_var` and calls
        `_update_optional_panes_visibility` to apply the change.
        """
        # self.logs_visible = self.logs_visible_var.get() # This line was redundant in original
        self._update_optional_panes_visibility()

    def _on_file_double_click(self, event):  # Identical to original
        if (
            not self.device_manager.device_interface.jensen_device.is_connected()
            and not self.is_audio_playing
        ):
            return
        item_iid = self.file_tree.identify_row(event.y)
        if not item_iid:
            return
        self.file_tree.selection_set(item_iid)
        file_detail = next(
            (f for f in self.displayed_files_details if f["name"] == item_iid), None
        )
        if not file_detail:
            return
        status = file_detail.get("gui_status", "On Device")
        if (
            self.is_audio_playing
            and self.current_playing_filename_for_replay == item_iid
        ):
            self._stop_audio_playback()
            return
        elif status in ["Downloaded", "Downloaded OK", "downloaded_ok"]:
            self.play_selected_audio_gui()
        elif status in ["On Device", "Mismatch", "Cancelled"] or "Error" in status:
            if not file_detail.get("is_recording"):
                self.download_selected_files_gui()

    def _create_styled_context_menu(self):
        """Creates and styles a tkinter.Menu to match the CTk theme."""
        context_menu = tkinter.Menu(self, tearoff=0)
        try:
            menu_bg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkFrame"]["fg_color"]
            )
            menu_fg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkLabel"]["text_color"]
            )
            active_menu_bg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkButton"]["hover_color"]
            )
            active_menu_fg_candidate = ctk.ThemeManager.theme["CTkButton"].get(
                "text_color_hover"
            )
            active_menu_fg = self.apply_appearance_mode_theme_color(
                active_menu_fg_candidate
                if active_menu_fg_candidate
                else ctk.ThemeManager.theme["CTkButton"]["text_color"]
            )
            disabled_fg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkLabel"].get(
                    "text_color_disabled", ("gray70", "gray30")
                )
            )
            context_menu.configure(
                background=menu_bg,
                foreground=menu_fg,
                activebackground=active_menu_bg,
                activeforeground=active_menu_fg,
                disabledforeground=disabled_fg,
                relief="flat",
                borderwidth=0,
            )
        except (tkinter.TclError, KeyError) as e:
            logger.warning(
                "GUI",
                "_create_styled_context_menu",
                f"Could not style context menu: {e}",
            )
        return context_menu

    def _add_single_file_context_menu_items(self, context_menu, item_iid, file_detail):
        """Adds context menu items for a single selected file."""
        status = file_detail.get("gui_status", "On Device")
        is_playable = file_detail["name"].lower().endswith((".wav", ".hda"))

        if (
            self.is_audio_playing
            and self.current_playing_filename_for_replay == item_iid
        ):
            context_menu.add_command(
                label="Stop Playback",
                command=self._stop_audio_playback,
                image=self.menu_icons.get("stop"),
                compound="left",
            )
        elif is_playable and status not in ["Recording", "Downloading", "Queued"]:
            context_menu.add_command(
                label="Play",
                command=self.play_selected_audio_gui,
                image=self.menu_icons.get("play"),
                compound="left",
            )

        if status in ["On Device", "Mismatch", "Cancelled"] or "Error" in status:
            if not file_detail.get("is_recording"):
                context_menu.add_command(
                    label="Download",
                    command=self.download_selected_files_gui,
                    image=self.menu_icons.get("download"),
                    compound="left",
                )
        elif status in ["Downloaded", "Downloaded OK", "downloaded_ok"]:
            context_menu.add_command(
                label="Re-download",
                command=self.download_selected_files_gui,
                image=self.menu_icons.get("download"),
                compound="left",
            )
            context_menu.add_command(
                label="Transcribe (Gemini)",
                command=lambda: self._transcribe_selected_audio_gemini(file_iid),
            )
        context_menu.add_command(
            label="Process Audio",
            command=lambda: self._process_selected_audio(file_iid),
        )

        if (
            status in ["Downloading", "Queued"]
            or "Preparing Playback" in status
            or self.active_operation_name
        ):
            context_menu.add_command(
                label="Cancel Operation",
                command=self.request_cancel_operation,
                image=self.menu_icons.get("stop"),
                compound="left",
            )

        if not file_detail.get("is_recording"):
            context_menu.add_command(
                label="Delete",
                command=self.delete_selected_files_gui,
                image=self.menu_icons.get("delete"),
                compound="left",
            )

    def _add_multi_file_context_menu_items(self, context_menu, selection):
        """Adds context menu items for multiple selected files."""
        num_selected = len(selection)
        context_menu.add_command(
            label=f"Download Selected ({num_selected})",
            command=self.download_selected_files_gui,
            image=self.menu_icons.get("download"),
            compound="left",
        )

        # Check if any of the selected files are currently recording
        is_any_recording = any(
            next((f for f in self.displayed_files_details if f["name"] == iid), {}).get(
                "is_recording"
            )
            for iid in selection
        )

        if not is_any_recording:
            context_menu.add_command(
                label=f"Delete Selected ({num_selected})",
                command=self.delete_selected_files_gui,
                image=self.menu_icons.get("delete"),
                compound="left",
            )

    def _on_file_right_click(
        self, event
    ):  # Identical to original, uses self._apply_appearance_mode_theme_color
        clicked_item_iid = self.file_tree.identify_row(event.y)
        current_selection = self.file_tree.selection()

        if clicked_item_iid and clicked_item_iid not in current_selection:
            self.file_tree.selection_set(clicked_item_iid)
            current_selection = (clicked_item_iid,)

        self._update_menu_states()
        context_menu = self._create_styled_context_menu()

        num_selected = len(current_selection)
        if num_selected == 1:
            item_iid = current_selection[0]
            file_detail = next(
                (f for f in self.displayed_files_details if f["name"] == item_iid), None
            )
            if file_detail:
                self._add_single_file_context_menu_items(
                    context_menu, item_iid, file_detail
                )
        elif num_selected > 1:
            self._add_multi_file_context_menu_items(context_menu, current_selection)

        if context_menu.index("end") is not None:
            context_menu.add_separator()
        context_menu.add_command(
            label="Refresh List",
            command=self.refresh_file_list_gui,
            state=(
                "normal"
                if self.device_manager.device_interface.jensen_device.is_connected()
                else "disabled"
            ),
            image=self.menu_icons.get("refresh"),
            compound="left",
        )
        if context_menu.index("end") is None:
            return
        try:
            context_menu.tk_popup(event.x_root, event.y_root)
        finally:
            context_menu.grab_release()

    def select_all_files_action(self):  # Identical to original
        """Selects all files in the file treeview."""
        if hasattr(self, "file_tree") and self.file_tree.winfo_exists():
            self.file_tree.selection_set(self.file_tree.get_children())

    def clear_selection_action(self):  # Identical to original
        """Clears the current selection in the file treeview."""
        if hasattr(self, "file_tree") and self.file_tree.winfo_exists():
            self.file_tree.selection_set([])

    def on_file_selection_change(self, _event=None):  # Identical to original
        """Handles changes in file selection in the treeview."""
        try:
            self.update_all_status_info()
            self._update_menu_states()
        except tkinter.TclError as e:
            logger.error(
                "GUI",
                "on_file_selection_change",
                f"Unhandled: {e}\n{traceback.format_exc()}",
            )

    def _on_delete_key_press(self, _event):  # Identical to original
        """Handles the delete key press event in the file treeview."""
        if (
            self.device_manager.device_interface.jensen_device.is_connected()
            and self.file_tree.selection()
            and self.actions_menu.entrycget("Delete Selected", "state") == "normal"
        ):
            self.delete_selected_files_gui()
        return "break"

    def _on_enter_key_press(self, _event):  # Identical to original
        """Handles the Enter key press event in the file treeview."""
        if (
            not self.device_manager.device_interface.jensen_device.is_connected()
            or len(self.file_tree.selection()) != 1
        ):
            return "break"
        try:

            class DummyEvent:
                """A dummy event class to simulate double-click events."""

                y = 0

            dummy_event = DummyEvent()
            bbox = self.file_tree.bbox(self.file_tree.selection()[0])
            if bbox:
                dummy_event.y = bbox[1] + bbox[3] // 2
                self._on_file_double_click(dummy_event)
        except tkinter.TclError as e:
            logger.warning(
                "GUI", "_on_enter_key_press", f"Could not simulate double click: {e}"
            )
        return "break"

    def _on_f5_key_press(self, _event=None):  # Identical to original
        """Handles the F5 key press event to refresh the file list."""
        if (
            self.device_manager.device_interface.jensen_device.is_connected()
            and self.view_menu.entrycget("Refresh File List", "state") == "normal"
        ):
            self.refresh_file_list_gui()
