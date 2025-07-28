# gui_treeview.py
"""
TreeView Mixin for the HiDock Explorer Tool GUI.
"""
import time
import tkinter
from datetime import datetime
from tkinter import ttk

import customtkinter as ctk
from config_and_logger import logger


class TreeViewMixin:
    """A mixin for handling the file list Treeview."""

    def _create_file_tree_frame(self, parent_frame):
        """Creates the file treeview and its associated scrollbar."""
        tree_frame = ctk.CTkFrame(parent_frame, fg_color="transparent", border_width=0)
        tree_frame.grid(row=1, column=0, sticky="nsew", padx=5, pady=5)
        tree_frame.grid_columnconfigure(0, weight=1)
        tree_frame.grid_rowconfigure(0, weight=1)
        columns = ("num", "name", "datetime", "size", "duration", "status")
        self.file_tree = ttk.Treeview(
            tree_frame, columns=columns, show="headings", selectmode="extended"
        )
        self.file_tree.tag_configure("downloaded", foreground="blue")
        self.file_tree.tag_configure(
            "recording", foreground="red", font=("Arial", 10, "bold")
        )
        self.file_tree.tag_configure("size_mismatch", foreground="orange")
        self.file_tree.tag_configure("downloaded_ok", foreground="green")
        self.file_tree.tag_configure("downloading", foreground="dark orange")
        self.file_tree.tag_configure("queued", foreground="gray50")
        self.file_tree.tag_configure("cancelled", foreground="firebrick3")
        self.file_tree.tag_configure("playing", foreground="purple")
        if self.treeview_columns_display_order_str:
            loaded_column_order = self.treeview_columns_display_order_str.split(",")
            valid_loaded_order = [c for c in loaded_column_order if c in columns]
            if len(valid_loaded_order) == len(columns) and set(
                valid_loaded_order
            ) == set(columns):
                try:
                    self.file_tree["displaycolumns"] = valid_loaded_order
                except tkinter.TclError as e:
                    logger.warning(
                        "GUI",
                        "create_widgets",
                        f"Failed to apply saved column order '{valid_loaded_order}' (TclError): {e}. Using default.",
                    )
                    self.file_tree["displaycolumns"] = columns
            else:
                self.file_tree["displaycolumns"] = columns
        else:
            self.file_tree["displaycolumns"] = columns
        for col, text in self.original_tree_headings.items():
            is_numeric = col in ["size", "duration"]
            self.file_tree.heading(
                col,
                text=text,
                command=lambda c=col, n=is_numeric: self.sort_treeview_column(c, n),
            )
            if col == "num":
                self.file_tree.column(col, width=40, minwidth=40, stretch=False)
            elif col == "name":
                self.file_tree.column(col, width=250, minwidth=150, stretch=True)
            elif col in ["size", "duration"]:
                self.file_tree.column(col, width=80, minwidth=60, anchor="e")
            elif col == "datetime":
                self.file_tree.column(col, width=150, minwidth=120, anchor="center")
            else:
                self.file_tree.column(col, width=100, minwidth=80, anchor="w")
        self.file_tree.grid(row=0, column=0, sticky="nsew")
        scrollbar = ttk.Scrollbar(
            tree_frame, orient="vertical", command=self.file_tree.yview
        )
        scrollbar.grid(row=0, column=1, sticky="ns")
        self.file_tree.configure(yscrollcommand=scrollbar.set)

        # Ensure the tree_frame has proper column configuration for the scrollbar
        tree_frame.grid_columnconfigure(1, weight=0)
        self.file_tree.bind("<<TreeviewSelect>>", self.on_file_selection_change)
        self.file_tree.bind("<Double-1>", self._on_file_double_click_filtered)
        self.file_tree.bind("<Button-3>", self._on_file_right_click)
        self.file_tree.bind("<Control-a>", lambda event: self.select_all_files_action())
        self.file_tree.bind("<Control-A>", lambda event: self.select_all_files_action())
        self.file_tree.bind("<Delete>", self._on_delete_key_press)
        self.file_tree.bind("<Return>", self._on_enter_key_press)
        self.file_tree.bind("<ButtonPress-1>", self._on_file_button1_press)
        self.file_tree.bind("<B1-Motion>", self._on_file_b1_motion)
        self.file_tree.bind("<ButtonRelease-1>", self._on_file_button1_release)

    def _populate_treeview_from_data(self, files_data):
        """
        Populates the Treeview with file data, preserving selection and scroll position.

        Args:
            files_data (list): A list of dictionaries, where each dictionary
                               represents a file's details.
        """
        if not (hasattr(self, "file_tree") and self.file_tree.winfo_exists()):
            return
        selected_iids = self.file_tree.selection()
        scroll_pos = self.file_tree.yview()
        self.file_tree.delete(*self.file_tree.get_children())
        self.displayed_files_details = files_data
        for i, file_info in enumerate(files_data):
            tags = []
            status_text = file_info.get("gui_status", "On Device")
            if file_info.get("is_recording"):
                tags.append("recording")
                status_text = "Recording"
            elif status_text == "Downloaded":
                tags.append("downloaded_ok")
            elif status_text == "Mismatch":
                tags.append("size_mismatch")
            elif status_text == "Cancelled":
                tags.append("cancelled")
            elif "Error" in status_text:
                tags.append("size_mismatch")
            if (
                self.is_audio_playing
                and self.current_playing_filename_for_replay == file_info["name"]
            ):
                tags.append("playing")
                status_text = "Playing"
            elif (
                self.is_long_operation_active
                and self.active_operation_name == "Playback Preparation"
                and self.current_playing_filename_for_replay == file_info["name"]
            ):
                status_text = "Preparing Playback"
            file_info["gui_status"] = status_text

            # Format size in MB
            size_bytes = file_info.get("length", 0)
            size_mb_str = (
                f"{size_bytes / (1024*1024):.2f}"
                if isinstance(size_bytes, (int, float)) and size_bytes > 0
                else "0.00"
            )

            # Format duration in HH:MM:SS
            duration_sec = file_info.get("duration", 0)
            if isinstance(duration_sec, (int, float)):
                duration_str = time.strftime("%H:%M:%S", time.gmtime(duration_sec))
            else:
                duration_str = str(duration_sec)

            # Combine Date and Time
            datetime_str = f"{file_info.get('createDate', '')} {file_info.get('createTime', '')}".strip()
            if not datetime_str:
                datetime_str = "---"

            values = (
                file_info.get("original_index", i + 1),
                file_info["name"],
                datetime_str,
                size_mb_str,
                duration_str,
                status_text,
            )
            self.file_tree.insert(
                "", "end", iid=file_info["name"], values=values, tags=tags
            )
        if selected_iids:
            new_selection = [iid for iid in selected_iids if self.file_tree.exists(iid)]
            if new_selection:
                self.file_tree.selection_set(new_selection)
        self.file_tree.yview_moveto(scroll_pos[0])
        self.update_all_status_info()

    def _update_file_status_in_treeview(self, file_iid, status_text, tags_to_add):
        """
        Updates the status and tags for a specific file in the Treeview.

        Args:
            file_iid (str): The IID (item ID) of the file in the Treeview.
            status_text (str): The new status text to display.
            tags_to_add (tuple): A tuple of tags to add to the item.
        """
        if not (
            hasattr(self, "file_tree")
            and self.file_tree.winfo_exists()
            and self.file_tree.exists(file_iid)
        ):
            return
        current_values = list(self.file_tree.item(file_iid, "values"))
        status_col_index = self.file_tree["columns"].index("status")
        current_values[status_col_index] = status_text
        self.file_tree.item(file_iid, values=current_values, tags=tags_to_add)
        file_detail = next(
            (f for f in self.displayed_files_details if f["name"] == file_iid), None
        )
        if file_detail:
            file_detail["gui_status"] = status_text

    def _remove_file_from_treeview(self, file_iid):
        """
        Removes a file from the Treeview and the displayed_files_details list.

        Args:
            file_iid (str): The IID (item ID) of the file to remove from the Treeview.
        """
        if not (
            hasattr(self, "file_tree")
            and self.file_tree.winfo_exists()
            and self.file_tree.exists(file_iid)
        ):
            return

        # Remove from treeview
        self.file_tree.delete(file_iid)

        # Remove from displayed_files_details list
        self.displayed_files_details = [
            f for f in self.displayed_files_details if f["name"] != file_iid
        ]

        # Update status info to reflect the change
        self.update_all_status_info()

    def _sort_files_data(self, files_data, col, reverse):
        """
        Sorts the file data based on a specified column.

        Args:
            files_data (list): The list of file dictionaries to sort.
            col (str): The column ID to sort by.
            reverse (bool): True to sort in descending order, False for ascending.

        Returns:
            list: The sorted list of file dictionaries.
        """

        def sort_key(item):
            if col == "size":
                # Sort by raw byte length, not formatted string
                return item.get("length", 0)
            elif col == "duration":
                # Sort by raw seconds, handling non-numeric "Recording..."
                duration_val = item.get("duration")
                if isinstance(duration_val, (int, float)):
                    return float(duration_val)
                elif isinstance(duration_val, str) and duration_val == "Recording...":
                    return -1  # Recording files should appear first
                else:
                    return 0  # Default for invalid values
            elif col == "num":
                return item.get("original_index", 0)
            elif col == "datetime":
                # For sorting, we need a real datetime object.
                # We create it on the fly if it doesn't exist and cache it.
                if "time" not in item:
                    try:
                        datetime_str = f"{item.get('createDate', '')} {item.get('createTime', '')}".strip()
                        if datetime_str and datetime_str != "---":
                            item["time"] = datetime.strptime(
                                datetime_str, "%Y-%m-%d %H:%M:%S"
                            )
                        else:
                            item["time"] = datetime.min
                    except (ValueError, TypeError):
                        item["time"] = datetime.min
                return item["time"]
            else:
                # Fallback for other columns like 'name' or 'status'
                val = item.get(col)
                if val is None:
                    return ""
                # Ensure string comparison for text columns
                return str(val).lower() if isinstance(val, str) else str(val)

        return sorted(files_data, key=sort_key, reverse=reverse)

    def sort_treeview_column(self, col, is_numeric_sort):
        """
        Handles the sorting of the Treeview when a column header is clicked.

        Toggles the sort direction and re-populates the Treeview with sorted data.

        Args:
            col (str): The column ID that was clicked.
            is_numeric_sort (bool): True if the column should be sorted numerically.
        """
        if self.treeview_sort_column == col:
            self.treeview_sort_reverse = not self.treeview_sort_reverse
        else:
            self.treeview_sort_column = col
            self.treeview_sort_reverse = False
        sorted_files = self._sort_files_data(
            self.displayed_files_details, col, self.treeview_sort_reverse
        )
        self._populate_treeview_from_data(sorted_files)
        self._update_treeview_heading_indicator(col, self.treeview_sort_reverse)
        self.saved_treeview_sort_column = col
        self.saved_treeview_sort_reverse = self.treeview_sort_reverse

    def _update_treeview_heading_indicator(self, sorted_by_col, reverse):
        """
        Updates the visual indicator on the Treeview column headers to show
        the current sort order (e.g., with an arrow).

        Args:
            sorted_by_col (str): The column ID that is currently sorted.
            reverse (bool): True if the sort is descending, False otherwise.
        """
        if not (hasattr(self, "file_tree") and self.file_tree.winfo_exists()):
            return
        # Use basic ASCII characters that should display on all systems
        arrow = " v" if reverse else " ^"
        for col_id, text in self.original_tree_headings.items():
            if col_id == sorted_by_col:
                self.file_tree.heading(col_id, text=text + arrow)
            else:
                self.file_tree.heading(col_id, text=text)

    def _on_file_double_click_filtered(self, event):
        """
        Filters double-click events to only trigger on actual file rows, not headers.

        Args:
            event: The tkinter event object
        """
        # Check if the click is on a header by using identify_region
        region = self.file_tree.identify_region(event.x, event.y)
        if region == "heading":
            # Click is on a header, don't trigger double-click action
            return

        # Click is on actual tree content, proceed with normal double-click handling
        self._on_file_double_click(event)

    def _apply_saved_sort_state_to_tree_and_ui(self, files_data):
        """
        Applies the saved sort state to the file data and updates the UI.

        Args:
            files_data (list): The list of file dictionaries to sort.

        Returns:
            list: The sorted list of file dictionaries.
        """
        if self.saved_treeview_sort_column:
            sorted_files = self._sort_files_data(
                files_data,
                self.saved_treeview_sort_column,
                self.saved_treeview_sort_reverse,
            )
            self.after(
                0,
                self._update_treeview_heading_indicator,
                self.saved_treeview_sort_column,
                self.saved_treeview_sort_reverse,
            )
            return sorted_files
        return files_data
