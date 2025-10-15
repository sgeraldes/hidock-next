# gui_actions_file.py
"""
File Actions Mixin for the HiDock Explorer Tool GUI.

This module provides the `FileActionsMixin` class, which contains methods
for handling file operations such as downloading, deleting, and transcribing.
"""
import json
import os
import subprocess
import sys
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
            # Create proper display text and tags for different operation types
            if operation.operation_type.value == "delete":
                display_text = f"Deleting ({operation.progress:.0f}%)"
                status_text = f"Deleting {operation.filename}: {operation.progress:.0f}%"
                tags = ("delete",)
            elif operation.operation_type.value == "download":
                display_text = f"Downloading ({operation.progress:.0f}%)"
                status_text = f"Downloading {operation.filename}: {operation.progress:.0f}%"
                tags = ("download",)
            else:
                # Fallback for other operation types
                display_text = f"{operation.operation_type.value.capitalize()} ({operation.progress:.0f}%)"
                status_text = f"{operation.operation_type.value.capitalize()} {operation.filename}: {operation.progress:.0f}%"
                tags = (operation.operation_type.value,)
                
            self.update_status_bar(progress_text=status_text)
            self._update_file_status_in_treeview(
                operation.filename,
                display_text,
                tags,
            )
        elif operation.status == FileOperationStatus.COMPLETED:
            status_text = f"{operation.operation_type.value.capitalize()} {operation.filename} complete."
            self.update_status_bar(progress_text=status_text)
            # For downloads, show "Downloaded" status instead of "Completed"
            if operation.operation_type.value == "download":
                # Update the metadata cache with the local file path
                local_filepath = self._get_local_filepath(operation.filename)
                cached_metadata = self.file_operations_manager.metadata_cache.get_metadata(operation.filename)
                if cached_metadata:
                    cached_metadata.local_path = local_filepath
                    self.file_operations_manager.metadata_cache.set_metadata(cached_metadata)
                
                # Update the displayed file details
                for file_detail in self.displayed_files_details:
                    if file_detail["name"] == operation.filename:
                        file_detail["local_path"] = local_filepath
                        file_detail["gui_status"] = "Downloaded"
                        break
                
                self._update_file_status_in_treeview(operation.filename, "Downloaded", ("downloaded_ok",))
                
                # Refresh the file status to ensure consistency
                self._refresh_single_file_status(operation.filename)
            elif operation.operation_type.value == "delete":
                # For deletions, remove the file from the treeview and update local state
                # The file_iid is the filename for our treeview implementation
                self._remove_file_from_treeview(operation.filename)
                # Note: _remove_file_from_treeview already removes from displayed_files_details
                
                # Remove from metadata cache
                self.file_operations_manager.metadata_cache.remove_metadata(operation.filename)
                
                # Update file count in status bar
                file_count = len(self.displayed_files_details)
                self.update_status_bar(file_count=file_count)
                
                # NO NEED TO REFRESH! We've already removed the file from all local state.
                # The old code called _schedule_post_deletion_refresh() which would fetch 
                # the entire file list again after 2 seconds - causing the 30+ second delay
                # for large file collections.
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

            # Note: File list refresh is not needed for cancellations
            # Files remain on device, only local operation status changes

    def _open_file_locally(self, filename):
        """Open a downloaded file in the system's default application."""
        try:
            local_filepath = self._get_local_filepath(filename)
            if not os.path.exists(local_filepath):
                messagebox.showerror(
                    "File Not Found",
                    f"Local file not found: {local_filepath}\nPlease download the file first.",
                    parent=self,
                )
                return
            
            # Open file with system default application
            import sys
            import subprocess
            
            if sys.platform == "win32":
                os.startfile(local_filepath)
            elif sys.platform == "darwin":  # macOS
                subprocess.call(["open", local_filepath])
            else:  # Linux
                subprocess.call(["xdg-open", local_filepath])
                
            logger.info("FileActionsMixin", "_open_file_locally", f"Opened file locally: {local_filepath}")
            
        except Exception as e:
            logger.error("FileActionsMixin", "_open_file_locally", f"Error opening file {filename}: {e}")
            messagebox.showerror(
                "Open File Error",
                f"Could not open file '{filename}' locally.\nError: {e}",
                parent=self,
            )

    def _delete_from_device(self, filenames):
        """Delete files from the HiDock device with comprehensive validation and error handling."""
        if not filenames:
            return
            
        # Pre-deletion validation
        try:
            self._validate_device_for_deletion(filenames)
        except Exception as e:
            messagebox.showerror(
                "Cannot Delete from Device",
                f"Device deletion not possible:\n\n{str(e)}",
                parent=self,
            )
            return
            
        count = len(filenames)
        file_list = "\n".join([f"• {name}" for name in filenames[:5]])
        if count > 5:
            file_list += f"\n... and {count - 5} more files"
            
        # Enhanced confirmation with device status
        device_status = self._get_device_status_for_deletion()
        if not messagebox.askyesno(
            "Delete from Device",
            f"Are you sure you want to permanently delete {count} file(s) from the HiDock device?\n\n"
            f"{file_list}\n\n"
            f"Device Status: {device_status}\n\n"
            "⚠️ This action cannot be undone!",
            parent=self,
        ):
            return
            
        # Execute with proper error handling
        try:
            self.file_operations_manager.queue_batch_delete(filenames, self._update_operation_progress)
        except Exception as e:
            logger.error("FileActionsMixin", "_delete_from_device", f"Device deletion failed: {e}")
            messagebox.showerror(
                "Device Deletion Failed",
                f"Failed to delete files from device:\n\n{str(e)}",
                parent=self,
            )
    
    def _validate_device_for_deletion(self, filenames):
        """Validate device state and files before deletion."""
        # Check device connection
        if not self.device_manager.device_interface.is_connected():
            raise RuntimeError("Device is not connected. Please connect the device and try again.")
            
        # Check for active recordings
        recording_files = []
        for filename in filenames:
            file_detail = next((f for f in self.displayed_files_details if f["name"] == filename), None)
            if file_detail and file_detail.get("is_recording"):
                recording_files.append(filename)
                
        if recording_files:
            raise RuntimeError(f"Cannot delete active recordings: {', '.join(recording_files[:3])}")
            
        # Check for files currently being downloaded
        downloading_files = []
        for filename in filenames:
            if self.file_operations_manager.is_file_operation_active(filename, FileOperationType.DOWNLOAD):
                downloading_files.append(filename)
                
        if downloading_files:
            raise RuntimeError(f"Cannot delete files currently being downloaded: {', '.join(downloading_files[:3])}")
    
    def _get_device_status_for_deletion(self):
        """Get device status information for deletion confirmation."""
        try:
            if hasattr(self, 'device_manager') and self.device_manager.device_interface.is_connected():
                return "Connected and Ready"
            else:
                return "Disconnected"
        except Exception:
            return "Status Unknown"
        
    def _delete_local_copy(self, filenames):
        """Delete local copies of files with confirmation."""
        if not filenames:
            return
            
        # Check for files that are currently in use and cannot be deleted
        locked_files = self._check_file_locks(filenames)
        if locked_files:
            self._handle_locked_files(locked_files)
            # Remove locked files from the deletion list
            filenames = [f for f in filenames if f not in [lf[0] for lf in locked_files]]
            if not filenames:
                return  # No files left to delete
            
        # Comprehensive file handle release for any files to be deleted
        files_to_release = set(filenames)
        handles_released = False
        
        for filename in files_to_release:
            if hasattr(self, 'current_playing_filename_for_replay') and self.current_playing_filename_for_replay == filename:
                self.stop_audio_playback_gui()
                handles_released = True
                
        # Stop any ongoing waveform/spectrum analysis that might hold file handles
        if hasattr(self, 'audio_visualization_widget'):
            self.audio_visualization_widget.clear()
            self.audio_visualization_widget.stop_spectrum_analysis()
            handles_released = True
            
        # Stop any ongoing transcription that might hold file handles
        if hasattr(self, 'is_long_operation_active') and self.is_long_operation_active:
            # Cancel transcription if active
            if hasattr(self, '_cancel_transcription'):
                self._cancel_transcription()
            handles_released = True
            
        # Force garbage collection to release any remaining handles
        if handles_released:
            import gc
            import time
            gc.collect()
            time.sleep(0.5)  # Increased delay for comprehensive handle release
            
        # Filter to only files that actually exist locally
        existing_files = []
        for filename in filenames:
            local_path = self._get_local_filepath(filename)
            if os.path.exists(local_path):
                existing_files.append(filename)
                
        if not existing_files:
            messagebox.showinfo(
                "No Local Files",
                "No local copies found for the selected files.",
                parent=self,
            )
            return
            
        count = len(existing_files)
        file_list = "\n".join([f"• {name}" for name in existing_files[:5]])
        if count > 5:
            file_list += f"\n... and {count - 5} more files"
            
        if not messagebox.askyesno(
            "Delete Local Copies",
            f"Are you sure you want to delete {count} local file(s)?\n\n"
            f"{file_list}\n\n"
            "Files will remain on the device and can be re-downloaded.",
            parent=self,
        ):
            return
            
        # Delete local files
        deleted_count = 0
        failed_files = []
        for filename in existing_files:
            try:
                local_path = self._get_local_filepath(filename)
                
                # Remove read-only attribute if present (cross-platform)
                if os.path.exists(local_path):
                    import stat
                    # Set read/write permissions for owner (works on Windows, macOS, Linux)
                    os.chmod(local_path, stat.S_IWRITE | stat.S_IREAD)
                
                os.remove(local_path)
                deleted_count += 1
                
                # Update metadata cache
                cached_metadata = self.file_operations_manager.metadata_cache.get_metadata(filename)
                if cached_metadata:
                    cached_metadata.local_path = None
                    self.file_operations_manager.metadata_cache.set_metadata(cached_metadata)
                
                # Update displayed file details
                for file_detail in self.displayed_files_details:
                    if file_detail["name"] == filename:
                        file_detail["local_path"] = None
                        # Check if we're in offline mode to set appropriate status
                        if hasattr(self, 'offline_mode_manager') and self.offline_mode_manager.is_offline_mode:
                            file_detail["gui_status"] = "On Device (Offline)"
                        else:
                            file_detail["gui_status"] = "On Device"
                        break
                        
                # Update treeview with appropriate offline status
                if hasattr(self, 'offline_mode_manager') and self.offline_mode_manager.is_offline_mode:
                    self._update_file_status_in_treeview(filename, "On Device (Offline)", ())
                else:
                    self._update_file_status_in_treeview(filename, "On Device", ())
                
            except Exception as e:
                logger.error("FileActionsMixin", "_delete_local_copy", f"Error deleting {filename}: {e}")
                failed_files.append((filename, str(e)))
                
        # Show appropriate message based on results
        if failed_files:
            if deleted_count > 0:
                error_details = "\n".join([f"• {name}: {error}" for name, error in failed_files[:3]])
                if len(failed_files) > 3:
                    error_details += f"\n... and {len(failed_files) - 3} more errors"
                    
                messagebox.showwarning(
                    "Partial Success",
                    f"Successfully deleted {deleted_count} file(s).\n\nFailed to delete {len(failed_files)} file(s):\n{error_details}",
                    parent=self,
                )
            else:
                error_details = "\n".join([f"• {name}: {error}" for name, error in failed_files[:3]])
                if len(failed_files) > 3:
                    error_details += f"\n... and {len(failed_files) - 3} more errors"
                    
                messagebox.showerror(
                    "Deletion Failed",
                    f"Failed to delete {len(failed_files)} local file(s):\n\n{error_details}",
                    parent=self,
                )
        else:
            messagebox.showinfo(
                "Local Files Deleted",
                f"Successfully deleted {deleted_count} local file(s).",
                parent=self,
            )
    
    def _check_file_locks(self, filenames):
        """Check for file locks that would prevent deletion."""
        locked_files = []
        
        for filename in filenames:
            local_path = self._get_local_filepath(filename)
            
            # If file is currently being played, stop playback automatically
            if hasattr(self, 'current_playing_filename_for_replay') and self.current_playing_filename_for_replay == filename:
                logger.info("FileActionsMixin", "_check_file_locks", f"Stopping audio playback to delete {filename}")
                self.stop_audio_playback_gui()
                # Continue to check other locks after stopping playback
                
            # Check if file is being downloaded
            if self.file_operations_manager.is_file_operation_active(filename, FileOperationType.DOWNLOAD):
                locked_files.append((filename, "File is currently being downloaded"))
                continue
                
            # Check if file is locked by another process
            if self._is_file_locked(local_path):
                locked_files.append((filename, "File is locked by another process"))
                continue
                
            # Check if file is being used by transcription
            if self._is_file_in_transcription(filename):
                locked_files.append((filename, "File is being transcribed"))
                continue
                
        return locked_files
    
    def _is_file_locked(self, file_path):
        """Check if a file is locked by another process."""
        if not os.path.exists(file_path):
            return False
            
        try:
            # Try to open the file in exclusive mode with multiple attempts
            for attempt in range(3):
                try:
                    with open(file_path, 'r+b') as f:
                        pass
                    return False  # File is not locked
                except (IOError, OSError, PermissionError):
                    if attempt < 2:  # Not the last attempt
                        import time
                        time.sleep(0.2)  # Brief delay before retry
                        continue
                    return True  # File is locked after all attempts
        except Exception:
            # Any other exception means we can't access the file
            return True
    
    def _is_file_in_transcription(self, filename):
        """Check if file is currently being transcribed."""
        # Check if there's an active transcription operation
        return hasattr(self, 'is_long_operation_active') and self.is_long_operation_active
    
    def _handle_locked_files(self, locked_files):
        """Handle files that are locked and cannot be deleted."""
        if not locked_files:
            return
            
        error_details = "\n".join([f"• {name}: {reason}" for name, reason in locked_files[:5]])
        if len(locked_files) > 5:
            error_details += f"\n... and {len(locked_files) - 5} more files"
            
        messagebox.showwarning(
            "Files Cannot Be Deleted",
            f"Cannot delete {len(locked_files)} file(s) because they are in use:\n\n{error_details}\n\n"
            "Please close any applications using these files and try again.",
            parent=self,
        )
    
    def _delete_single_local_file_with_retry(self, filename, max_retries=3):
        """Delete a single local file with retry mechanism."""
        local_path = self._get_local_filepath(filename)
        
        for attempt in range(max_retries):
            try:
                # Remove read-only attribute if present (cross-platform)
                if os.path.exists(local_path):
                    import stat
                    # Set read/write permissions for owner (works on Windows, macOS, Linux)
                    os.chmod(local_path, stat.S_IWRITE | stat.S_IREAD)
                
                os.remove(local_path)
                
                # Update metadata cache
                cached_metadata = self.file_operations_manager.metadata_cache.get_metadata(filename)
                if cached_metadata:
                    cached_metadata.local_path = None
                    self.file_operations_manager.metadata_cache.set_metadata(cached_metadata)
                
                # Update displayed file details
                for file_detail in self.displayed_files_details:
                    if file_detail["name"] == filename:
                        file_detail["local_path"] = None
                        # Check if we're in offline mode to set appropriate status
                        if hasattr(self, 'offline_mode_manager') and self.offline_mode_manager.is_offline_mode:
                            file_detail["gui_status"] = "On Device (Offline)"
                        else:
                            file_detail["gui_status"] = "On Device"
                        break
                        
                # Update treeview with appropriate offline status
                if hasattr(self, 'offline_mode_manager') and self.offline_mode_manager.is_offline_mode:
                    self._update_file_status_in_treeview(filename, "On Device (Offline)", ())
                else:
                    self._update_file_status_in_treeview(filename, "On Device", ())
                
                logger.info("FileActionsMixin", "_delete_single_local_file_with_retry", 
                           f"Successfully deleted {filename} on attempt {attempt + 1}")
                return True
                
            except PermissionError as e:
                self._last_deletion_error = f"Permission denied: {str(e)}"
                if attempt < max_retries - 1:
                    import time
                    time.sleep(0.5)  # Brief delay before retry
                    continue
                    
            except FileNotFoundError:
                # File already deleted - consider this success
                logger.info("FileActionsMixin", "_delete_single_local_file_with_retry", 
                           f"File {filename} already deleted")
                return True
                
            except Exception as e:
                self._last_deletion_error = str(e)
                break
                
        logger.error("FileActionsMixin", "_delete_single_local_file_with_retry", 
                    f"Failed to delete {filename} after {max_retries} attempts: {self._last_deletion_error}")
        return False

    def _refresh_single_file_status(self, filename):
        """Refresh the status of a single file to ensure proper display."""
        try:
            # Get the cached metadata
            cached_metadata = self.file_operations_manager.metadata_cache.get_metadata(filename)
            if not cached_metadata:
                return
            
            # Check if file exists locally
            local_filepath = self._get_local_filepath(filename)
            file_exists = os.path.exists(local_filepath)
            
            # Update the cached metadata if needed
            if file_exists and not cached_metadata.local_path:
                cached_metadata.local_path = local_filepath
                self.file_operations_manager.metadata_cache.set_metadata(cached_metadata)
            elif not file_exists and cached_metadata.local_path:
                cached_metadata.local_path = None
                self.file_operations_manager.metadata_cache.set_metadata(cached_metadata)
            
            # Update the displayed file details
            for file_detail in self.displayed_files_details:
                if file_detail["name"] == filename:
                    file_detail["local_path"] = local_filepath if file_exists else None
                    if file_exists:
                        file_detail["gui_status"] = "Downloaded"
                    else:
                        # Check if we're in offline mode to set appropriate status
                        if hasattr(self, 'offline_mode_manager') and self.offline_mode_manager.is_offline_mode:
                            file_detail["gui_status"] = "On Device (Offline)"
                        else:
                            file_detail["gui_status"] = "On Device"
                    break
            
            # Update the treeview display
            if file_exists:
                self._update_file_status_in_treeview(filename, "Downloaded", ("downloaded_ok",))
            else:
                # Check if we're in offline mode to set appropriate status
                if hasattr(self, 'offline_mode_manager') and self.offline_mode_manager.is_offline_mode:
                    self._update_file_status_in_treeview(filename, "On Device (Offline)", ())
                else:
                    self._update_file_status_in_treeview(filename, "On Device", ())
                
        except Exception as e:
            logger.error("FileActionsMixin", "_refresh_single_file_status", f"Error refreshing status for {filename}: {e}")

    def _schedule_post_deletion_refresh(self):
        """Schedule a file list refresh after all deletions are complete (batched refresh)."""
        # Cancel any existing refresh timer
        if hasattr(self, '_deletion_refresh_timer'):
            try:
                self.after_cancel(self._deletion_refresh_timer)
            except:
                pass  # Timer already executed or cancelled
        
        # Schedule a new refresh with a short delay to batch multiple deletions
        self._deletion_refresh_timer = self.after(2000, self._perform_post_deletion_refresh)  # 2 second delay
    
    def _perform_post_deletion_refresh(self):
        """Perform the actual file list refresh after batch deletions are complete."""
        try:
            # Check if there are any active delete operations still running
            active_operations = self.file_operations_manager.get_all_active_operations()
            active_deletes = [
                op for op in active_operations 
                if op.operation_type == FileOperationType.DELETE 
                and op.status in [FileOperationStatus.PENDING, FileOperationStatus.IN_PROGRESS]
            ]
            
            if active_deletes:
                # Still have active deletions, reschedule
                logger.debug("FileActionsMixin", "_perform_post_deletion_refresh", 
                           f"Still {len(active_deletes)} active deletions, rescheduling refresh")
                self._deletion_refresh_timer = self.after(1000, self._perform_post_deletion_refresh)
                return
            
            # All deletions complete, perform refresh
            logger.info("FileActionsMixin", "_perform_post_deletion_refresh", 
                       "All deletions complete, refreshing file list")
            self.refresh_file_list_gui()
            
        except Exception as e:
            logger.error("FileActionsMixin", "_perform_post_deletion_refresh", 
                        f"Error during post-deletion refresh: {e}")
            # Fallback: still try to refresh even if there was an error
            try:
                self.refresh_file_list_gui()
            except Exception as refresh_error:
                logger.error("FileActionsMixin", "_perform_post_deletion_refresh", 
                           f"Fallback refresh also failed: {refresh_error}")

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

            # Note: File list refresh is not needed for cancellations
            # Files remain on device, only local operation status changes
    
    def cancel_all_operations_gui(self):
        """Cancels ALL active operations (downloads, deletions, etc.)."""
        active_operations = self.file_operations_manager.get_all_active_operations()
        pending_operations = [
            op for op in active_operations
            if op.status in [FileOperationStatus.PENDING, FileOperationStatus.IN_PROGRESS]
        ]
        
        if not pending_operations:
            messagebox.showinfo("No Active Operations", "No active operations to cancel.", parent=self)
            return
        
        # Count operations by type
        downloads = [op for op in pending_operations if op.operation_type == FileOperationType.DOWNLOAD]
        deletions = [op for op in pending_operations if op.operation_type == FileOperationType.DELETE]
        
        # Build informative message
        message_parts = []
        if downloads:
            message_parts.append(f"{len(downloads)} download(s)")
        if deletions:
            message_parts.append(f"{len(deletions)} deletion(s)")
        
        if messagebox.askyesno(
            "Cancel All Operations",
            f"Are you sure you want to cancel {' and '.join(message_parts)}?\n\n"
            "This will stop all active file operations.",
            parent=self,
        ):
            cancelled_count = 0
            for operation in pending_operations:
                if self.file_operations_manager.cancel_operation(operation.operation_id):
                    cancelled_count += 1
                    # Update the file status in the treeview based on operation type
                    if operation.operation_type == FileOperationType.DELETE:
                        # For cancelled deletions, restore to "On Device" status
                        self._update_file_status_in_treeview(operation.filename, "On Device", ())
                    else:
                        # For other operations, show "Cancelled" status
                        self._update_file_status_in_treeview(operation.filename, "Cancelled", ("cancelled",))
            
            self.update_status_bar(progress_text=f"Cancelled {cancelled_count} operation(s).")
    
    def cancel_active_deletions_gui(self):
        """Cancels all active deletion operations."""
        active_operations = self.file_operations_manager.get_all_active_operations()
        delete_operations = [
            op for op in active_operations
            if op.operation_type == FileOperationType.DELETE
            and op.status in [FileOperationStatus.PENDING, FileOperationStatus.IN_PROGRESS]
        ]
        
        if not delete_operations:
            messagebox.showinfo("No Deletions", "No active deletions to cancel.", parent=self)
            return
        
        if messagebox.askyesno(
            "Cancel Deletions",
            f"Are you sure you want to cancel {len(delete_operations)} active deletion(s)?",
            parent=self,
        ):
            cancelled_count = 0
            for operation in delete_operations:
                if self.file_operations_manager.cancel_operation(operation.operation_id):
                    cancelled_count += 1
                    # Restore status to "On Device" since deletion was cancelled
                    self._update_file_status_in_treeview(operation.filename, "On Device", ())
            
            self.update_status_bar(progress_text=f"Cancelled {cancelled_count} deletion(s).")
