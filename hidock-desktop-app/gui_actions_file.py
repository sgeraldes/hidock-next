# gui_actions_file.py
"""
File Actions Mixin for the HiDock Explorer Tool GUI.

This module provides the `FileActionsMixin` class, which contains methods
for handling file operations such as downloading, deleting, and transcribing.
"""
import json
import os
import threading

# import time  # Commented out - not used in current implementation
# import tkinter  # Commented out - not used directly, only tkinter.messagebox is used
import traceback
from tkinter import messagebox

from config_and_logger import logger
from file_operations_manager import FileOperationStatus, FileOperationType
from transcription_module import process_audio_file_for_insights


class FileActionsMixin:
    """A mixin for handling file-related actions."""

    def _get_local_filepath(self, device_filename):  # Identical to original
        """Generates a safe local file path for the given device filename.
        Args:
            device_filename (str): The filename from the device.
        Returns:
            str: A safe local file path.
        """
        safe_filename = device_filename.replace(":", "-").replace(" ", "_").replace("\\", "_").replace("/", "_")
        return os.path.join(self.download_directory, safe_filename)

    def download_selected_files_gui(self):
        """Handles the download of selected files in the GUI by setting up a queue."""
        selected_iids = self.file_tree.selection()
        if not selected_iids:
            messagebox.showinfo("No Selection", "Please select files to download.", parent=self)
            return
        if not self.download_directory or not os.path.isdir(self.download_directory):
            messagebox.showerror("Error", "Invalid download directory.", parent=self)
            return
        if self.is_long_operation_active:
            messagebox.showwarning("Busy", "Another operation in progress.", parent=self)
            return

        filenames_to_download = [self.file_tree.item(iid)["values"][1] for iid in selected_iids]

        # Immediately update status to "Queued" for selected files
        for iid in selected_iids:
            filename = self.file_tree.item(iid)["values"][1]
            # Check if file is already being downloaded
            if not self.file_operations_manager.is_file_operation_active(filename, FileOperationType.DOWNLOAD):
                self._update_file_status_in_treeview(filename, "Queued", ("queued",))

        self.file_operations_manager.queue_batch_download(filenames_to_download, self._update_operation_progress)

        # No need to refresh file list - downloads work with existing metadata
        # and status updates are handled by the progress callback

    def delete_selected_files_gui(self):
        """Handles the deletion of selected files in the GUI."""
        selected_iids = self.file_tree.selection()
        if not selected_iids:
            messagebox.showinfo("No Selection", "Please select files to delete.", parent=self)
            return

        if not messagebox.askyesno(
            "Confirm Deletion",
            f"Are you sure you want to permanently delete {len(selected_iids)} file(s) from the device?",
            parent=self,
        ):
            return

        filenames_to_delete = [self.file_tree.item(iid)["values"][1] for iid in selected_iids]

        # Immediately update status to "Queued" for selected files to be deleted
        for iid in selected_iids:
            filename = self.file_tree.item(iid)["values"][1]
            # Check if file is already being deleted
            if not self.file_operations_manager.is_file_operation_active(filename, FileOperationType.DELETE):
                self._update_file_status_in_treeview(filename, "Delete Queued", ("queued",))

        self.file_operations_manager.queue_batch_delete(filenames_to_delete, self._update_operation_progress)

    def _update_operation_progress(self, operation):
        """
        Callback to update GUI with operation progress. Called from a worker thread.
        Schedules the actual UI update on the main thread to prevent freezes.
        """
        # This is called from a worker thread. Schedule the actual GUI update
        # on the main thread to prevent UI freezes and race conditions.
        self.after(0, self._perform_gui_update_for_operation, operation)

    def _perform_gui_update_for_operation(self, operation):
        """Performs the actual GUI update on the main thread."""
        if operation.status == FileOperationStatus.IN_PROGRESS:
            status_text = (
                f"{operation.operation_type.value.capitalize()} " f"{operation.filename}: {operation.progress:.0f}%"
            )
            self.update_status_bar(progress_text=status_text)
            self._update_file_status_in_treeview(
                operation.filename,
                f"{operation.operation_type.value.capitalize()} ({operation.progress:.0f}%)",
                (operation.operation_type.value,),
            )
        elif operation.status == FileOperationStatus.COMPLETED:
            status_text = f"{operation.operation_type.value.capitalize()} {operation.filename} complete."
            self.update_status_bar(progress_text=status_text)
            # For downloads, show "Downloaded" status instead of "Completed"
            if operation.operation_type.value == "download":
                self._update_file_status_in_treeview(operation.filename, "Downloaded", ("downloaded_ok",))
            elif operation.operation_type.value == "delete":
                # For deletions, remove the file from the treeview and refresh the file list
                self._remove_file_from_treeview(operation.filename)
                # Refresh the file list to ensure consistency with device state
                self.refresh_file_list_gui()
            else:
                self._update_file_status_in_treeview(operation.filename, "Completed", ("completed",))
        elif operation.status == FileOperationStatus.FAILED:
            status_text = f"Failed to {operation.operation_type.value} {operation.filename}: {operation.error_message}"
            self.update_status_bar(progress_text=status_text)
            self._update_file_status_in_treeview(operation.filename, "Failed", ("failed",))
        elif operation.status == FileOperationStatus.CANCELLED:
            status_text = f"{operation.operation_type.value.capitalize()} {operation.filename} cancelled."
            self.update_status_bar(progress_text=status_text)
            self._update_file_status_in_treeview(operation.filename, "Cancelled", ("cancelled",))

    def _transcribe_selected_audio_gemini(self, file_iid):
        file_detail = next((f for f in self.displayed_files_details if f["name"] == file_iid), None)
        if not file_detail:
            messagebox.showerror("Transcription Error", "File details not found.", parent=self)
            return

        local_filepath = self._get_local_filepath(file_detail["name"])
        if not os.path.exists(local_filepath):
            messagebox.showwarning(
                "Transcription",
                "File not downloaded. Please download it first.",
                parent=self,
            )
            return

        # Get API key securely (e.g., from config or environment variable)
        gemini_api_key = os.environ.get("GEMINI_API_KEY")  # Or load from self.config
        if not gemini_api_key:
            messagebox.showerror(
                "API Key Missing",
                "Gemini API Key not found. Please set GEMINI_API_KEY environment variable.",
                parent=self,
            )
            return

        self._set_long_operation_active_state(True, "Transcription")
        self.update_status_bar(progress_text=f"Transcribing {file_detail['name']} with Gemini...")

        threading.Thread(
            target=self._transcription_worker,
            args=(local_filepath, gemini_api_key, file_detail["name"]),
            daemon=True,
        ).start()

    def _transcription_worker(self, file_path, api_key, original_filename):
        try:
            results = process_audio_file_for_insights(file_path, api_key)
            self.after(0, self._on_transcription_complete, results, original_filename)
        except Exception as e:  # pylint: disable=broad-except
            # Catching broad exception is acceptable here as this is a worker thread.
            # The exception is logged with a traceback and reported to the user via the UI,
            # preventing the thread from crashing silently.
            logger.error(
                "GUI",
                "_transcription_worker",
                f"Error during transcription: {e}\n{traceback.format_exc()}",
            )
            self.after(0, self._on_transcription_complete, {"error": str(e)}, original_filename)

    def _on_transcription_complete(self, results, original_filename):
        self._set_long_operation_active_state(False, "Transcription")
        if "error" in results:
            messagebox.showerror(
                "Transcription Error",
                f"Failed to transcribe {original_filename}: {results['error']}",
                parent=self,
            )
            self.update_status_bar(progress_text=f"Transcription failed for {original_filename}.")
        else:
            transcription_text = results.get("transcription", "No transcription found.")
            insights = results.get("insights", {})

            # Display results in a new window
            result_window = self.CTkToplevel(self)
            result_window.title(f"Transcription & Insights for {original_filename}")
            result_window.geometry("800x600")

            tabview = self.CTkTabview(result_window)
            tabview.pack(fill="both", expand=True, padx=10, pady=10)

            # Transcription Tab
            transcription_tab = tabview.add("Transcription")
            transcription_textbox = self.CTkTextbox(transcription_tab, wrap="word")
            transcription_textbox.insert("1.0", transcription_text)
            transcription_textbox.configure(state="disabled")
            transcription_textbox.pack(fill="both", expand=True, padx=5, pady=5)

            # Insights Tab
            insights_tab = tabview.add("Insights")
            insights_textbox = self.CTkTextbox(insights_tab, wrap="word")
            insights_textbox.insert("1.0", json.dumps(insights, indent=2))
            insights_textbox.configure(state="disabled")
            insights_textbox.pack(fill="both", expand=True, padx=5, pady=5)

            self.update_status_bar(progress_text=f"Transcription complete for {original_filename}.")

    def cancel_all_downloads_gui(self):
        """Cancels all active download operations."""
        active_operations = self.file_operations_manager.get_all_active_operations()
        download_operations = [
            op
            for op in active_operations
            if op.operation_type == FileOperationType.DOWNLOAD
            and op.status in [FileOperationStatus.PENDING, FileOperationStatus.IN_PROGRESS]
        ]

        if not download_operations:
            messagebox.showinfo("No Downloads", "No active downloads to cancel.", parent=self)
            return

        if messagebox.askyesno(
            "Cancel Downloads",
            f"Are you sure you want to cancel {len(download_operations)} active download(s)?",
            parent=self,
        ):
            cancelled_count = 0
            for operation in download_operations:
                if self.file_operations_manager.cancel_operation(operation.operation_id):
                    cancelled_count += 1
                    # Update the file status in the treeview
                    self._update_file_status_in_treeview(operation.filename, "Cancelled", ("cancelled",))

            self.update_status_bar(progress_text=f"Cancelled {cancelled_count} download(s).")

            # Refresh the file list to ensure consistent state
            self.refresh_file_list_gui()

    def cancel_selected_downloads_gui(self):
        """Cancels download operations for selected files."""
        selected_iids = self.file_tree.selection()
        if not selected_iids:
            messagebox.showinfo(
                "No Selection",
                "Please select files to cancel downloads for.",
                parent=self,
            )
            return

        # Get filenames from selected items
        selected_filenames = [self.file_tree.item(iid)["values"][1] for iid in selected_iids]

        # Find active download operations for selected files
        active_operations = self.file_operations_manager.get_all_active_operations()
        download_operations_to_cancel = [
            op
            for op in active_operations
            if (
                op.operation_type == FileOperationType.DOWNLOAD
                and op.filename in selected_filenames
                and op.status in [FileOperationStatus.PENDING, FileOperationStatus.IN_PROGRESS]
            )
        ]

        if not download_operations_to_cancel:
            messagebox.showinfo(
                "No Active Downloads",
                "No active downloads found for the selected files.",
                parent=self,
            )
            return

        if messagebox.askyesno(
            "Cancel Downloads",
            f"Are you sure you want to cancel {len(download_operations_to_cancel)} download(s) for the selected files?",
            parent=self,
        ):
            cancelled_count = 0
            for operation in download_operations_to_cancel:
                if self.file_operations_manager.cancel_operation(operation.operation_id):
                    cancelled_count += 1
                    # Update the file status in the treeview
                    self._update_file_status_in_treeview(operation.filename, "Cancelled", ("cancelled",))

            self.update_status_bar(progress_text=f"Cancelled {cancelled_count} download(s) for selected files.")

            # Refresh the file list to ensure consistent state
            self.refresh_file_list_gui()
