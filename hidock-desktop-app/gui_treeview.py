# gui_treeview.py
"""
TreeView Mixin for the HiDock Explorer Tool GUI.
"""
import time
import tkinter
from datetime import datetime
from tkinter import ttk
from typing import List, Dict, Any, Optional

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
        columns = ("num", "name", "datetime", "size", "duration", "meeting", "version", "status")
        # Set initial selectmode based on configuration
        initial_selectmode = "browse" if self.single_selection_mode_var.get() else "extended"
        self.file_tree = ttk.Treeview(tree_frame, columns=columns, show="headings", selectmode=initial_selectmode)
        self.file_tree.tag_configure("downloaded", foreground="blue")
        self.file_tree.tag_configure("recording", foreground="red", font=("Arial", 10, "bold"))
        self.file_tree.tag_configure("size_mismatch", foreground="orange")
        self.file_tree.tag_configure("downloaded_ok", foreground="green")
        self.file_tree.tag_configure("downloading", foreground="dark orange")
        self.file_tree.tag_configure("download", foreground="dark orange")  # For download operations
        self.file_tree.tag_configure("deleting", foreground="red")
        self.file_tree.tag_configure("delete", foreground="red")  # For delete operations
        self.file_tree.tag_configure("queued", foreground="gray50")
        self.file_tree.tag_configure("cancelled", foreground="firebrick3")
        self.file_tree.tag_configure("playing", foreground="purple")
        if self.treeview_columns_display_order_str:
            loaded_column_order = self.treeview_columns_display_order_str.split(",")
            valid_loaded_order = [c for c in loaded_column_order if c in columns]
            if len(valid_loaded_order) == len(columns) and set(valid_loaded_order) == set(columns):
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
        for col in columns:
            if col in self.original_tree_headings:
                text = self.original_tree_headings[col]
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
            elif col == "meeting":
                self.file_tree.column(col, width=200, minwidth=150, anchor="w")
            elif col == "version":
                self.file_tree.column(col, width=70, minwidth=50, anchor="center")
            else:
                self.file_tree.column(col, width=100, minwidth=80, anchor="w")
        self.file_tree.grid(row=0, column=0, sticky="nsew")

        # Create and configure scrollbar - simplest possible approach
        self.tree_scrollbar = ttk.Scrollbar(tree_frame, orient="vertical", command=self.file_tree.yview)
        self.tree_scrollbar.grid(row=0, column=1, sticky="ns")
        self.file_tree.configure(yscrollcommand=self.tree_scrollbar.set)

        # Configure frame columns
        tree_frame.grid_columnconfigure(0, weight=1)
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

    def show_loading_state(self):
        """Show loading state - but preserve existing files if they're already displayed."""
        if not (hasattr(self, "file_tree") and self.file_tree.winfo_exists()):
            return

        # Only clear if there are no real files displayed (just show loading for empty state)
        existing_children = self.file_tree.get_children()
        has_real_files = any(not child.startswith("loading_") for child in existing_children)

        if not has_real_files:
            # No real files shown yet, display loading indicators
            self.file_tree.delete(*existing_children)

            loading_messages = [
                "🔄 Loading files from device...",
                "📡 Fetching file information...",
                "⏳ Please wait...",
            ]

            for i, message in enumerate(loading_messages):
                self.file_tree.insert(
                    "",
                    "end",
                    iid=f"loading_{i}",
                    values=("", message, "", "", "", "Loading..."),
                    tags=["loading"],
                )

            # Configure loading tag with distinctive styling
            self.file_tree.tag_configure("loading", foreground="blue", font=("Arial", 10, "italic"))
        else:
            # Files are already displayed - just update status bar, don't clear tree
            pass

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

        # Remove any loading indicators, but preserve real files if doing an update
        children_to_remove = [child for child in self.file_tree.get_children() if child.startswith("loading_")]
        for child in children_to_remove:
            self.file_tree.delete(child)

        # Only clear all if we're doing a full refresh (not an update)
        if not hasattr(self, "_is_incremental_update") or not self._is_incremental_update:
            remaining_children = [child for child in self.file_tree.get_children() if not child.startswith("loading_")]
            for child in remaining_children:
                self.file_tree.delete(child)

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
            if self.is_audio_playing and self.current_playing_filename_for_replay == file_info["name"]:
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
                f"{size_bytes / (1024 * 1024):.2f}"
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

            # Format version - display the raw value from the device
            version_str = str(file_info.get("version", "N/A"))
            
            # Get meeting information
            meeting_text = file_info.get("meeting_display_text", "")

            values = (
                file_info.get("original_index", i + 1),
                file_info["name"],
                datetime_str,
                size_mb_str,
                duration_str,
                meeting_text,
                version_str,
                status_text,
            )
            self.file_tree.insert("", "end", iid=file_info["name"], values=values, tags=tags)
        if selected_iids:
            new_selection = [iid for iid in selected_iids if self.file_tree.exists(iid)]
            if new_selection:
                self.file_tree.selection_set(new_selection)
        self.file_tree.yview_moveto(scroll_pos[0])
        self.update_all_status_info()

    def _update_file_status_in_treeview(self, file_iid, status_text, tags_to_add):
        """
        Updates the status and tags for a specific file in the Treeview.
        Maintains sort order if the treeview is currently sorted.

        Args:
            file_iid (str): The IID (item ID) of the file in the Treeview.
            status_text (str): The new status text to display.
            tags_to_add (tuple): A tuple of tags to add to the item.
        """
        if not (hasattr(self, "file_tree") and self.file_tree.winfo_exists() and self.file_tree.exists(file_iid)):
            return

        # Update the file detail in displayed_files_details first
        file_detail = next((f for f in self.displayed_files_details if f["name"] == file_iid), None)
        if file_detail:
            file_detail["gui_status"] = status_text

        # Update the treeview item
        current_values = list(self.file_tree.item(file_iid, "values"))
        status_col_index = self.file_tree["columns"].index("status")
        current_values[status_col_index] = status_text
        self.file_tree.item(file_iid, values=current_values, tags=tags_to_add)

        # If the treeview is currently sorted, maintain the sort order
        # Only re-sort if we're not sorting by status column to avoid infinite loops
        if (
            hasattr(self, "treeview_sort_column")
            and self.treeview_sort_column
            and self.treeview_sort_column != "status"
        ):
            # Re-sort the data to maintain order
            sorted_files = self._sort_files_data(
                self.displayed_files_details,
                self.treeview_sort_column,
                self.treeview_sort_reverse,
            )

            # Only repopulate if the order actually changed to avoid unnecessary updates
            current_order = [self.file_tree.item(child)["values"][1] for child in self.file_tree.get_children()]
            new_order = [f["name"] for f in sorted_files]

            if current_order != new_order:
                # Preserve selection and scroll position
                selected_iids = self.file_tree.selection()
                scroll_pos = self.file_tree.yview()

                # Repopulate with sorted data
                self._populate_treeview_from_data(sorted_files)

                # Restore selection and scroll position
                if selected_iids:
                    new_selection = [iid for iid in selected_iids if self.file_tree.exists(iid)]
                    if new_selection:
                        self.file_tree.selection_set(new_selection)
                self.file_tree.yview_moveto(scroll_pos[0])

    def _remove_file_from_treeview(self, file_iid):
        """
        Removes a file from the Treeview and the displayed_files_details list.

        Args:
            file_iid (str): The IID (item ID) of the file to remove from the Treeview.
        """
        if not (hasattr(self, "file_tree") and self.file_tree.winfo_exists() and self.file_tree.exists(file_iid)):
            return

        # Remove from treeview
        self.file_tree.delete(file_iid)

        # Remove from displayed_files_details list
        self.displayed_files_details = [f for f in self.displayed_files_details if f["name"] != file_iid]

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
                            item["time"] = datetime.strptime(datetime_str, "%Y-%m-%d %H:%M:%S")
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
        Works properly even during active download operations.

        Toggles the sort direction and re-populates the Treeview with sorted data.

        Args:
            col (str): The column ID that was clicked.
            is_numeric_sort (bool): True if the column should be sorted numerically.
        """
        # Preserve selection and scroll position
        selected_iids = self.file_tree.selection()
        scroll_pos = self.file_tree.yview()

        # Update sort parameters
        if self.treeview_sort_column == col:
            self.treeview_sort_reverse = not self.treeview_sort_reverse
        else:
            self.treeview_sort_column = col
            self.treeview_sort_reverse = False

        # Sort the data
        sorted_files = self._sort_files_data(self.displayed_files_details, col, self.treeview_sort_reverse)

        # Repopulate the treeview with sorted data
        self._populate_treeview_from_data(sorted_files)

        # Update the heading indicator
        self._update_treeview_heading_indicator(col, self.treeview_sort_reverse)

        # Save sort state for persistence
        self.saved_treeview_sort_column = col
        self.saved_treeview_sort_reverse = self.treeview_sort_reverse

        # Auto-save sort preferences
        from config_and_logger import update_config_settings

        update_config_settings({"treeview_sort_col_id": col, "treeview_sort_descending": self.treeview_sort_reverse})

        # Restore selection and scroll position
        if selected_iids:
            new_selection = [iid for iid in selected_iids if self.file_tree.exists(iid)]
            if new_selection:
                self.file_tree.selection_set(new_selection)
        self.file_tree.yview_moveto(scroll_pos[0])

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
        # Only update headings for columns that exist in the treeview
        treeview_columns = self.file_tree["columns"]
        for col_id in treeview_columns:
            if col_id in self.original_tree_headings:
                text = self.original_tree_headings[col_id]
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
            # Update current sort state to match saved state
            self.treeview_sort_column = self.saved_treeview_sort_column
            self.treeview_sort_reverse = self.saved_treeview_sort_reverse

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

    def _update_treeview_selectmode(self):
        """Updates the treeview selectmode based on current selection mode setting."""
        if not (hasattr(self, "file_tree") and self.file_tree.winfo_exists()):
            return

        is_single_mode = self.single_selection_mode_var.get()
        new_selectmode = "browse" if is_single_mode else "extended"

        self.file_tree.selection_set([])
        self.file_tree.configure(selectmode=new_selectmode)
        self._update_selection_buttons_visibility()

    def _update_selection_buttons_visibility(self):
        """Updates visibility of select all/clear buttons based on selection mode."""
        is_single_mode = self.single_selection_mode_var.get()

        if hasattr(self, "select_all_button_header") and self.select_all_button_header.winfo_exists():
            if is_single_mode:
                self.select_all_button_header.pack_forget()
            else:
                self.select_all_button_header.pack(side="right", padx=(2, 2), pady=2)

        if hasattr(self, "clear_selection_button_header") and self.clear_selection_button_header.winfo_exists():
            if is_single_mode:
                self.clear_selection_button_header.pack_forget()
            else:
                self.clear_selection_button_header.pack(side="right", padx=(2, 5), pady=2)

    # Calendar Search and Filtering Methods
    
    def initialize_calendar_filtering(self):
        """Initialize calendar filtering variables."""
        self.all_files_data = []  # Store all files (unfiltered)
        self.filtered_files_data = []  # Store currently filtered files
        self.calendar_filters_active = {}  # Store active filters
        self.calendar_filter_engine = None  # Will be initialized when needed
        
        logger.debug("TreeView", "init_filtering", "Calendar filtering initialized")
    
    def set_calendar_filter_engine(self, filter_engine):
        """Set the calendar filter engine instance."""
        self.calendar_filter_engine = filter_engine
        logger.debug("TreeView", "set_filter_engine", "Calendar filter engine set")
    
    def apply_calendar_filters(self, filters: Dict[str, Any]):
        """
        Apply calendar filters to the file list and update the TreeView.
        
        Args:
            filters: Dictionary of filter criteria
        """
        try:
            if not hasattr(self, 'all_files_data'):
                logger.warning("TreeView", "apply_filters", "Calendar filtering not initialized")
                return
            
            # Store active filters
            self.calendar_filters_active = filters.copy()
            
            # Apply filters using the filter engine
            if self.calendar_filter_engine and filters:
                self.filtered_files_data = self.calendar_filter_engine.apply_filters(
                    self.all_files_data, filters
                )
                logger.debug("TreeView", "apply_filters", 
                           f"Applied filters: {len(self.all_files_data)} -> {len(self.filtered_files_data)} files")
            else:
                # No filters active, show all files
                self.filtered_files_data = self.all_files_data.copy()
                logger.debug("TreeView", "apply_filters", "No filters active, showing all files")
            
            # Apply existing sort order to filtered data
            if hasattr(self, 'treeview_sort_column') and self.treeview_sort_column:
                self.filtered_files_data = self._sort_files_data(
                    self.filtered_files_data,
                    self.treeview_sort_column,
                    getattr(self, 'treeview_sort_reverse', False)
                )
            
            # Update the TreeView with filtered data
            self._populate_treeview_from_data(self.filtered_files_data)
            
            # Update calendar search widget result count if available
            if hasattr(self, 'calendar_search_widget') and self.calendar_search_widget:
                self.calendar_search_widget.set_result_count(len(self.filtered_files_data))
            
            # Update status bar
            self.update_all_status_info()
            
        except Exception as e:
            logger.error("TreeView", "apply_filters", f"Error applying calendar filters: {e}")
    
    def clear_calendar_filters(self):
        """Clear all calendar filters and show all files."""
        self.apply_calendar_filters({})
    
    def update_files_data_for_filtering(self, files_data: List[Dict[str, Any]]):
        """
        Update the files data for filtering. This should be called whenever
        new file data is loaded from the device.
        
        Args:
            files_data: Updated list of file dictionaries
        """
        try:
            if not hasattr(self, 'all_files_data'):
                self.initialize_calendar_filtering()
            
            # Store the complete file list
            self.all_files_data = files_data.copy()
            
            # Reapply current filters to the new data
            if self.calendar_filters_active:
                self.apply_calendar_filters(self.calendar_filters_active)
            else:
                # No filters active, just update the displayed data
                self.filtered_files_data = self.all_files_data.copy()
                self._populate_treeview_from_data(self.filtered_files_data)
                
                # Update search widget result count
                if hasattr(self, 'calendar_search_widget') and self.calendar_search_widget:
                    self.calendar_search_widget.set_result_count(len(self.filtered_files_data))
            
            logger.debug("TreeView", "update_files_data", 
                       f"Updated files data: {len(files_data)} total files")
            
        except Exception as e:
            logger.error("TreeView", "update_files_data", f"Error updating files data: {e}")
    
    def get_current_displayed_files(self) -> List[Dict[str, Any]]:
        """
        Get the currently displayed files (after filtering).
        
        Returns:
            List of currently displayed file dictionaries
        """
        if hasattr(self, 'filtered_files_data'):
            return self.filtered_files_data.copy()
        elif hasattr(self, 'displayed_files_details'):
            return self.displayed_files_details.copy()
        else:
            return []
    
    def get_all_files_data(self) -> List[Dict[str, Any]]:
        """
        Get all files data (before filtering).
        
        Returns:
            List of all file dictionaries
        """
        if hasattr(self, 'all_files_data'):
            return self.all_files_data.copy()
        elif hasattr(self, 'displayed_files_details'):
            return self.displayed_files_details.copy()
        else:
            return []
    
    def is_calendar_filter_active(self) -> bool:
        """
        Check if any calendar filters are currently active.
        
        Returns:
            True if filters are active, False otherwise
        """
        return bool(getattr(self, 'calendar_filters_active', {}))
    
    def get_calendar_filter_stats(self) -> Dict[str, Any]:
        """
        Get statistics about current filtering state.
        
        Returns:
            Dictionary with filtering statistics
        """
        try:
            total_files = len(getattr(self, 'all_files_data', []))
            filtered_files = len(getattr(self, 'filtered_files_data', []))
            
            return {
                'total_files': total_files,
                'filtered_files': filtered_files,
                'hidden_files': total_files - filtered_files,
                'filters_active': self.is_calendar_filter_active(),
                'active_filters': getattr(self, 'calendar_filters_active', {}).copy()
            }
        except Exception as e:
            logger.error("TreeView", "get_filter_stats", f"Error getting filter stats: {e}")
            return {
                'total_files': 0,
                'filtered_files': 0,
                'hidden_files': 0,
                'filters_active': False,
                'active_filters': {}
            }
