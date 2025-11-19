#!/usr/bin/env python3
"""
Audio Metadata Mixin for HiDock Desktop GUI

Integrates audio metadata database with the GUI display, handling:
- Processing status display in TreeView
- Transcription and AI analysis integration
- User editing of metadata
"""

import os
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional

from audio_metadata_db import AudioMetadata, ProcessingStatus, get_audio_metadata_db
from config_and_logger import logger


class AudioMetadataMixin:
    """Mixin for integrating audio metadata with the GUI."""

    def _ensure_audio_metadata_initialized(self):
        """Initialize audio metadata system (lazy initialization)."""
        if not hasattr(self, "_audio_metadata_initialized"):
            self._audio_metadata_initialized = False
            self._audio_metadata_db = None

            # Initialize database
            self._audio_metadata_db = get_audio_metadata_db()
            self._audio_metadata_initialized = True

            logger.info("AudioMetadata", "init", "Audio metadata system initialized")

    def enhance_files_with_audio_metadata(self, files_dict: List[Dict]) -> List[Dict]:
        """Enhance file list with audio metadata and processing status."""
        self._ensure_audio_metadata_initialized()

        enhanced_files = []

        for file_data in files_dict:
            enhanced_file = file_data.copy()
            filename = file_data["name"]

            try:
                # Get metadata from database
                metadata = self._audio_metadata_db.get_metadata(filename)

                if metadata:
                    # File has metadata - use it
                    enhanced_file.update(self._create_metadata_display_fields(metadata))
                else:
                    # File not in database - create entry and use defaults
                    self._create_metadata_entry_for_file(file_data)
                    enhanced_file.update(self._create_empty_metadata_fields())

            except Exception as e:
                logger.warning("AudioMetadata", "enhance_files", f"Error enhancing {filename} with metadata: {e}")
                enhanced_file.update(self._create_empty_metadata_fields())

            enhanced_files.append(enhanced_file)

        return enhanced_files

    def _create_metadata_entry_for_file(self, file_data: Dict):
        """Create a metadata entry for a new file."""
        try:
            filename = file_data["name"]
            file_path = file_data.get("local_path", "")

            # If no local path is available (file not downloaded), use a placeholder path
            if not file_path:
                # Use download directory as base path for potential future downloads
                download_dir = getattr(self, "download_directory", os.path.expanduser("~/Downloads"))
                file_path = os.path.join(download_dir, filename)

            file_size = file_data.get("length", 0)
            duration_seconds = file_data.get("duration", 0)

            # Parse date created
            date_created = file_data.get("time")
            if not isinstance(date_created, datetime):
                date_created = datetime.now()

            self._audio_metadata_db.create_file_entry(
                filename=filename,
                file_path=file_path,
                file_size=file_size,
                duration_seconds=duration_seconds,
                date_created=date_created,
            )

        except Exception as e:
            logger.warning("AudioMetadata", "_create_metadata_entry", f"Error creating metadata entry: {e}")

    def _create_metadata_display_fields(self, metadata: AudioMetadata) -> Dict[str, Any]:
        """Create display fields from audio metadata."""
        fields = {
            # Processing status for meeting column
            "audio_processing_status": metadata.processing_status.value,
            "audio_processing_display": self._audio_metadata_db.get_status_display_text(metadata),
            # Content fields
            "audio_title": metadata.display_title or "",
            "audio_description": metadata.display_description or "",
            "audio_transcription": metadata.transcription_text or "",
            "audio_ai_summary": metadata.ai_summary or "",
            "audio_user_title": metadata.user_title or "",
            "audio_user_description": metadata.user_description or "",
            # Participants and action items
            "audio_ai_participants": metadata.ai_participants or [],
            "audio_user_participants": metadata.user_participants or [],
            "audio_ai_action_items": metadata.ai_action_items or [],
            "audio_user_action_items": metadata.user_action_items or [],
            # Other fields
            "audio_topics": metadata.ai_topics or [],
            "audio_sentiment": metadata.ai_sentiment or "",
            "audio_user_tags": metadata.user_tags or [],
            "audio_user_notes": metadata.user_notes or "",
            "description_display_text": metadata.display_description or "",
        }

        # Only override meeting display if we have processed content
        meeting_display = self._get_meeting_column_display(metadata)
        if meeting_display is not None:
            fields["meeting_display_text"] = meeting_display
        # If meeting_display is None, don't add the field to preserve existing calendar data

        return fields

    def _create_empty_metadata_fields(self) -> Dict[str, Any]:
        """Create empty metadata fields for new files."""
        return {
            "audio_processing_status": ProcessingStatus.NOT_PROCESSED.value,
            "audio_processing_display": "",
            "audio_title": "",
            "audio_description": "",
            "audio_transcription": "",
            "audio_ai_summary": "",
            "audio_user_title": "",
            "audio_user_description": "",
            "audio_ai_participants": [],
            "audio_user_participants": [],
            "audio_ai_action_items": [],
            "audio_user_action_items": [],
            "audio_topics": [],
            "audio_sentiment": "",
            "audio_user_tags": [],
            "audio_user_notes": "",
            # Note: Don't include 'meeting_display_text' here to preserve calendar data
            "description_display_text": "",
        }

    def _get_meeting_column_display(self, metadata: AudioMetadata) -> str:
        """Get text to display in the meeting column of TreeView."""
        # Priority system for meeting column display:
        # 1. User title (if set)
        # 2. Short AI-generated meeting subject (5-8 words max)
        # 3. Calendar meeting info (from calendar cache - keep existing)
        # 4. Blank
        #
        # NOTE: Processing status (Transcribing..., Analyzing..., etc.) should NOT appear here
        # They belong in the Transcription column instead

        if metadata.user_title:
            return metadata.user_title
        elif metadata.ai_summary and metadata.processing_status in [
            ProcessingStatus.COMPLETED,
            ProcessingStatus.AI_ANALYZED,
        ]:
            # Generate a short subject line from the AI summary (5-8 words max)
            # Extract first sentence or first 40-50 characters
            first_line = metadata.ai_summary.split("\n")[0].strip()
            first_sentence = first_line.split(".")[0].strip()

            # Truncate to approximately 5-8 words (40-50 characters)
            words = first_sentence.split()
            if len(words) <= 8:
                return first_sentence
            else:
                return " ".join(words[:8]) + "..."
        else:
            # Return None to preserve existing calendar meeting display
            # Do NOT show processing status messages here
            return None

    def start_audio_processing(self, filename: str) -> bool:
        """Start processing an audio file (transcription + AI analysis)."""
        self._ensure_audio_metadata_initialized()

        try:
            # Update status to transcribing
            success = self._audio_metadata_db.update_processing_status(filename, ProcessingStatus.TRANSCRIBING)

            if success:
                # Trigger GUI update
                self.after(0, self._refresh_file_display_for_metadata_change, filename)

                # Start background processing
                threading.Thread(
                    target=self._process_audio_file_background,
                    args=(filename,),
                    daemon=True,
                    name=f"AudioProcessor-{filename}",
                ).start()

                logger.info("AudioMetadata", "start_processing", f"Started processing for {filename}")
                return True

            return False

        except Exception as e:
            logger.error("AudioMetadata", "start_processing", f"Error starting processing for {filename}: {e}")
            return False

    def _process_audio_file_background(self, filename: str):
        """Background processing of audio file (transcription + AI analysis)."""
        try:
            # Step 1: Transcription
            self._audio_metadata_db.update_processing_status(filename, ProcessingStatus.TRANSCRIBING)
            self.after(0, self._refresh_file_display_for_metadata_change, filename)

            # Get file path for transcription
            metadata = self._audio_metadata_db.get_metadata(filename)
            if not metadata:
                logger.error("AudioMetadata", "_process_background", f"No metadata found for {filename}")
                return

            # Find local file path
            local_path = self._find_local_file_path(filename)
            if not local_path:
                logger.error("AudioMetadata", "_process_background", f"No local file found for {filename}")
                self._audio_metadata_db.update_processing_status(
                    filename, ProcessingStatus.ERROR, "Local file not found"
                )
                return

            # Transcribe audio
            transcription_result = self._transcribe_audio_file(local_path)
            if transcription_result:
                # Save transcription
                self._audio_metadata_db.save_transcription(
                    filename=filename,
                    transcription_text=transcription_result["text"],
                    confidence=transcription_result.get("confidence"),
                    language=transcription_result.get("language"),
                )

                self.after(0, self._refresh_file_display_for_metadata_change, filename)

                # Step 2: AI Analysis
                self._audio_metadata_db.update_processing_status(filename, ProcessingStatus.AI_ANALYZING)
                self.after(0, self._refresh_file_display_for_metadata_change, filename)

                ai_result = self._analyze_transcription_with_ai(transcription_result["text"])
                if ai_result:
                    # Save AI analysis
                    self._audio_metadata_db.save_ai_analysis(
                        filename=filename,
                        summary=ai_result.get("summary"),
                        participants=ai_result.get("participants"),
                        action_items=ai_result.get("action_items"),
                        topics=ai_result.get("topics"),
                        sentiment=ai_result.get("sentiment"),
                        key_quotes=ai_result.get("key_quotes"),
                    )

                    # Mark as completed
                    self._audio_metadata_db.update_processing_status(filename, ProcessingStatus.COMPLETED)

                    logger.info("AudioMetadata", "_process_background", f"Completed processing for {filename}")
                else:
                    self._audio_metadata_db.update_processing_status(
                        filename, ProcessingStatus.ERROR, "AI analysis failed"
                    )
            else:
                self._audio_metadata_db.update_processing_status(
                    filename, ProcessingStatus.ERROR, "Transcription failed"
                )

            # Final GUI update
            self.after(0, self._refresh_file_display_for_metadata_change, filename)

        except Exception as e:
            logger.error("AudioMetadata", "_process_background", f"Error processing {filename}: {e}")
            self._audio_metadata_db.update_processing_status(filename, ProcessingStatus.ERROR, str(e))
            self.after(0, self._refresh_file_display_for_metadata_change, filename)

    def _find_local_file_path(self, filename: str) -> Optional[str]:
        """Find local path for an audio file."""
        try:
            # Check if file is downloaded
            for file_detail in getattr(self, "displayed_files_details", []):
                if file_detail.get("name") == filename:
                    local_path = file_detail.get("local_path")
                    if local_path and os.path.exists(local_path):
                        logger.debug(
                            "AudioMetadata", "_find_local_file", f"Found local path from file details: {local_path}"
                        )
                        return local_path
                    elif local_path:
                        logger.debug(
                            "AudioMetadata",
                            "_find_local_file",
                            f"Local path in details but file doesn't exist: {local_path}",
                        )

            # Check download directory (primary location)
            download_dir = getattr(self, "download_directory", None)
            if not download_dir:
                # Fallback to config
                download_dir = self.config.get("download_directory", os.path.expanduser("~/Downloads"))

            # Make download_dir absolute if it's relative
            if not os.path.isabs(download_dir):
                # Relative to app root
                app_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                download_dir = os.path.abspath(os.path.join(app_root, download_dir))

            logger.debug("AudioMetadata", "_find_local_file", f"Checking download directory: {download_dir}")

            potential_path = os.path.join(download_dir, filename)
            if os.path.exists(potential_path):
                logger.debug("AudioMetadata", "_find_local_file", f"Found file in download directory: {potential_path}")
                return potential_path

            logger.warning("AudioMetadata", "_find_local_file", f"File not found. Checked: {potential_path}")
            return None

        except Exception as e:
            logger.error("AudioMetadata", "_find_local_file", f"Error finding local file for {filename}: {e}")
            return None

    def _transcribe_audio_file(self, file_path: str) -> Optional[Dict[str, Any]]:
        """Transcribe audio file using the transcription module."""
        try:
            # Import transcription module and asyncio
            import asyncio

            from transcription_module import process_audio_file_for_insights

            logger.info("AudioMetadata", "_transcribe", f"Starting transcription of {file_path}")

            # Get API key, provider, and model from config
            provider = self.config.get("ai_api_provider", "gemini")
            model = self.config.get("ai_model", "gemini-2.0-flash-exp")

            # Get decrypted API key (supports encrypted keys from settings)
            if hasattr(self, "get_decrypted_api_key"):
                api_key = self.get_decrypted_api_key(provider)
            else:
                # Fallback: try direct key (unencrypted)
                api_key = self.config.get("gemini_api_key", "")

            if not api_key:
                logger.error("AudioMetadata", "_transcribe", f"No API key configured for provider: {provider}")
                return None

            # Process the audio file (async function needs asyncio.run)
            # Pass model in config dict
            provider_config = {"model": model}
            result = asyncio.run(
                process_audio_file_for_insights(file_path, provider=provider, api_key=api_key, config=provider_config)
            )

            if result and "transcription" in result:
                transcription_text = result["transcription"]

                return {
                    "text": transcription_text,
                    "confidence": result.get("transcription_confidence"),
                    "language": result.get("language", "en"),
                }
            else:
                logger.warning("AudioMetadata", "_transcribe", f"No transcription result for {file_path}")
                return None

        except Exception as e:
            logger.error("AudioMetadata", "_transcribe", f"Error transcribing {file_path}: {e}")
            return None

    def _analyze_transcription_with_ai(self, transcription_text: str) -> Optional[Dict[str, Any]]:
        """Analyze transcription using AI service."""
        try:
            # Import AI service
            from ai_service import ai_service

            logger.info(
                "AudioMetadata",
                "_analyze_ai",
                f"Starting AI analysis of transcription ({len(transcription_text)} chars)",
            )

            # Get provider and API key
            provider = self.config.get("ai_api_provider", "gemini")
            model = self.config.get("ai_model", "gemini-2.5-flash")  # Use Flash to avoid rate limits

            # Get decrypted API key
            if hasattr(self, "get_decrypted_api_key"):
                api_key = self.get_decrypted_api_key(provider)
            else:
                api_key = self.config.get("gemini_api_key", "")

            if not api_key:
                logger.error("AudioMetadata", "_analyze_ai", "No API key configured")
                return None

            # Configure provider
            provider_config = {"model": model}
            if not ai_service.configure_provider(provider, api_key, provider_config):
                logger.error("AudioMetadata", "_analyze_ai", f"Failed to configure {provider}")
                return None

            # Analyze with AI
            result = ai_service.analyze_text(provider, transcription_text, "meeting_insights")

            if result.get("success"):
                analysis = result.get("analysis", {})
                return {
                    "summary": analysis.get("summary", ""),
                    "participants": [],  # Not provided by default analyze
                    "action_items": analysis.get("action_items", []),
                    "topics": analysis.get("topics", []),
                    "sentiment": analysis.get("sentiment", ""),
                    "key_quotes": [],  # Not provided by default analyze
                }
            else:
                logger.warning("AudioMetadata", "_analyze_ai", f"AI analysis failed: {result.get('error')}")
                return None

        except Exception as e:
            logger.error("AudioMetadata", "_analyze_ai", f"Error in AI analysis: {e}")
            return None

    def _refresh_file_display_for_metadata_change(self, filename: str):
        """Refresh the display for a specific file when its metadata changes."""
        try:
            # Find the file in displayed_files_details and update it
            if hasattr(self, "displayed_files_details"):
                for i, file_detail in enumerate(self.displayed_files_details):
                    if file_detail.get("name") == filename:
                        # Get updated metadata
                        metadata = self._audio_metadata_db.get_metadata(filename)
                        if metadata:
                            # Update the file detail with new metadata
                            file_detail.update(self._create_metadata_display_fields(metadata))

                            # Update the TreeView item directly
                            if hasattr(self, "file_tree") and self.file_tree.winfo_exists():
                                if self.file_tree.exists(filename):
                                    self._update_treeview_item_with_metadata(filename, file_detail)
                        break

        except Exception as e:
            logger.warning("AudioMetadata", "_refresh_display", f"Error refreshing display for {filename}: {e}")

    def _update_treeview_item_with_metadata(self, filename: str, file_detail: Dict):
        """Update a specific TreeView item with new metadata."""
        try:
            # Get current values
            current_values = list(self.file_tree.item(filename, "values"))

            # Update meeting column (index 5) with processing status or result
            meeting_text = file_detail.get("meeting_display_text", "")
            if meeting_text is None:
                # Use existing calendar meeting text if no override
                meeting_text = current_values[5] if len(current_values) > 5 else ""

            # Update the meeting column
            if len(current_values) > 5:
                current_values[5] = meeting_text
                self.file_tree.item(filename, values=current_values)

        except Exception as e:
            logger.warning("AudioMetadata", "_update_treeview_item", f"Error updating TreeView item {filename}: {e}")

    def get_audio_metadata_for_file(self, filename: str) -> Optional[AudioMetadata]:
        """Get audio metadata for a specific file."""
        self._ensure_audio_metadata_initialized()
        return self._audio_metadata_db.get_metadata(filename)

    def update_user_audio_title(self, filename: str, title: str) -> bool:
        """Update user-defined title for an audio file."""
        self._ensure_audio_metadata_initialized()

        success = self._audio_metadata_db.update_user_fields(filename, user_title=title)
        if success:
            self.after(0, self._refresh_file_display_for_metadata_change, filename)
        return success

    def update_user_audio_description(self, filename: str, description: str) -> bool:
        """Update user-defined description for an audio file."""
        self._ensure_audio_metadata_initialized()

        success = self._audio_metadata_db.update_user_fields(filename, user_description=description)
        if success:
            self.after(0, self._refresh_file_display_for_metadata_change, filename)
        return success

    def update_user_audio_metadata(
        self,
        filename: str,
        title: str = None,
        description: str = None,
        participants: List[str] = None,
        action_items: List[str] = None,
        tags: List[str] = None,
        notes: str = None,
    ) -> bool:
        """Update multiple user fields for an audio file."""
        self._ensure_audio_metadata_initialized()

        success = self._audio_metadata_db.update_user_fields(
            filename=filename,
            user_title=title,
            user_description=description,
            user_participants=participants,
            user_action_items=action_items,
            user_tags=tags,
            user_notes=notes,
        )

        if success:
            self.after(0, self._refresh_file_display_for_metadata_change, filename)

        return success

    def get_audio_processing_statistics(self) -> Dict[str, int]:
        """Get statistics about audio processing status."""
        self._ensure_audio_metadata_initialized()
        return self._audio_metadata_db.get_processing_statistics()

    def search_audio_content(self, query: str) -> List[AudioMetadata]:
        """Search audio content by transcription, summaries, or user notes."""
        self._ensure_audio_metadata_initialized()
        return self._audio_metadata_db.search_metadata(query)

    def cleanup_audio_metadata(self, current_filenames: List[str]) -> int:
        """Clean up metadata for files that no longer exist."""
        self._ensure_audio_metadata_initialized()
        return self._audio_metadata_db.cleanup_orphaned_entries(current_filenames)

    def can_process_audio_file(self, filename: str) -> bool:
        """Check if an audio file can be processed (is downloaded locally)."""
        local_path = self._find_local_file_path(filename)
        return local_path is not None

    def get_files_ready_for_processing(self) -> List[str]:
        """Get list of downloaded files that haven't been processed yet."""
        self._ensure_audio_metadata_initialized()

        ready_files = []

        try:
            # Get unprocessed files from database
            unprocessed = self._audio_metadata_db.get_files_by_status(ProcessingStatus.NOT_PROCESSED)

            for metadata in unprocessed:
                # Check if file is available locally
                if self.can_process_audio_file(metadata.filename):
                    ready_files.append(metadata.filename)

        except Exception as e:
            logger.warning("AudioMetadata", "get_ready_files", f"Error getting ready files: {e}")

        return ready_files

    def batch_process_ready_files(self, max_files: int = 5) -> int:
        """Start batch processing of ready files."""
        ready_files = self.get_files_ready_for_processing()[:max_files]

        started_count = 0
        for filename in ready_files:
            if self.start_audio_processing(filename):
                started_count += 1

        if started_count > 0:
            logger.info("AudioMetadata", "batch_process", f"Started processing {started_count} files")

        return started_count

    # GUI Integration Methods

    def show_audio_metadata_dialog(self, filename: str):
        """Show dialog for editing audio metadata."""
        # This will be implemented as a separate dialog window
        # For now, just log the action
        logger.info("AudioMetadata", "show_dialog", f"Metadata dialog requested for {filename}")

        # TODO: Implement AudioMetadataDialog class
        pass

    def on_audio_file_right_click_metadata(self, event, filename: str):
        """Handle right-click context menu for audio metadata."""
        # Add metadata-specific menu items
        try:
            import tkinter as tk

            menu = tk.Menu(self, tearoff=0)

            # Get metadata to determine available actions
            metadata = self.get_audio_metadata_for_file(filename)

            if metadata:
                if metadata.processing_status == ProcessingStatus.NOT_PROCESSED:
                    if self.can_process_audio_file(filename):
                        menu.add_command(
                            label="Process Audio (Transcribe + Analyze)",
                            command=lambda: self.start_audio_processing(filename),
                        )
                    else:
                        menu.add_command(label="Download First to Process", state="disabled")

                menu.add_command(label="Edit Metadata...", command=lambda: self.show_audio_metadata_dialog(filename))

                if metadata.transcription_text:
                    menu.add_command(
                        label="View Transcription", command=lambda: self._show_transcription_viewer(filename)
                    )

            # Show menu
            menu.tk_popup(event.x_root, event.y_root)

        except Exception as e:
            logger.warning("AudioMetadata", "right_click_menu", f"Error showing metadata menu: {e}")

    def _show_transcription_viewer(self, filename: str):
        """Show transcription in a viewer window."""
        # TODO: Implement transcription viewer
        logger.info("AudioMetadata", "show_transcription", f"Transcription viewer requested for {filename}")
        pass

    def export_transcription_to_file(self, filename: str) -> Optional[str]:
        """Export transcription from database to .txt file for viewing.

        Args:
            filename: Audio filename

        Returns:
            Path to exported .txt file, or None if export failed
        """
        self._ensure_audio_metadata_initialized()

        try:
            # Get metadata from database
            metadata = self._audio_metadata_db.get_metadata(filename)
            if not metadata or not metadata.transcription_text:
                logger.warning("AudioMetadata", "export_transcription", f"No transcription found for {filename}")
                return None

            # Determine output path (same location as audio file)
            audio_path = self._find_local_file_path(filename)
            if not audio_path:
                # Fallback to download directory
                download_dir = getattr(self, "download_directory", os.path.expanduser("~/Downloads"))
                audio_path = os.path.join(download_dir, filename)

            # Generate .txt filename
            base_path = os.path.splitext(audio_path)[0]
            txt_path = f"{base_path}_transcription.txt"

            # Check if file already exists and is up-to-date
            if os.path.exists(txt_path):
                txt_mtime = os.path.getmtime(txt_path)
                db_mtime = metadata.updated_at.timestamp()
                if txt_mtime >= db_mtime:
                    # File is up-to-date
                    logger.debug(
                        "AudioMetadata", "export_transcription", f"Using existing transcription file: {txt_path}"
                    )
                    return txt_path

            # Write transcription to file
            with open(txt_path, "w", encoding="utf-8") as f:
                # Header
                f.write("=" * 60 + "\n")
                f.write("AUDIO TRANSCRIPTION\n")
                f.write("=" * 60 + "\n\n")
                f.write(f"File: {filename}\n")
                f.write(f"Date: {metadata.date_created.strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write(f"Duration: {int(metadata.duration_seconds // 60)}m {int(metadata.duration_seconds % 60)}s\n")

                if metadata.transcription_language:
                    f.write(f"Language: {metadata.transcription_language}\n")

                if metadata.transcription_confidence:
                    f.write(f"Confidence: {metadata.transcription_confidence:.1%}\n")

                f.write(f"Exported: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("\n" + "=" * 60 + "\n\n")

                # Transcription text
                f.write(metadata.transcription_text)

                # Optional: Add AI summary if available
                if metadata.ai_summary:
                    f.write("\n\n" + "=" * 60 + "\n")
                    f.write("AI SUMMARY\n")
                    f.write("=" * 60 + "\n\n")
                    f.write(metadata.ai_summary)

                # Optional: Add action items if available
                if metadata.ai_action_items or metadata.user_action_items:
                    f.write("\n\n" + "=" * 60 + "\n")
                    f.write("ACTION ITEMS\n")
                    f.write("=" * 60 + "\n\n")

                    action_items = metadata.user_action_items or metadata.ai_action_items
                    for i, item in enumerate(action_items, 1):
                        f.write(f"{i}. {item}\n")

            logger.info("AudioMetadata", "export_transcription", f"Exported transcription to {txt_path}")
            return txt_path

        except Exception as e:
            logger.error("AudioMetadata", "export_transcription", f"Error exporting transcription for {filename}: {e}")
            return None

    def open_transcription_in_notepad(self, filename: str) -> bool:
        """Open transcription file in Windows Notepad.

        Args:
            filename: Audio filename

        Returns:
            True if opened successfully, False otherwise
        """
        import subprocess
        import sys
        from tkinter import messagebox

        try:
            # Export transcription to file
            txt_path = self.export_transcription_to_file(filename)

            if not txt_path:
                messagebox.showerror(
                    "No Transcription",
                    f"No transcription available for {filename}.\n\n"
                    "Please transcribe the file first by right-clicking and selecting 'Quick Transcribe'.",
                    parent=self,
                )
                return False

            # Open in notepad (Windows only for now)
            if sys.platform == "win32":
                subprocess.Popen(["notepad.exe", txt_path])
                logger.info("AudioMetadata", "open_transcription", f"Opened transcription in notepad: {txt_path}")
                return True
            else:
                # For other platforms, open with default text editor
                import platform

                if platform.system() == "Darwin":  # macOS
                    subprocess.Popen(["open", "-e", txt_path])
                else:  # Linux
                    subprocess.Popen(["xdg-open", txt_path])

                logger.info("AudioMetadata", "open_transcription", f"Opened transcription: {txt_path}")
                return True

        except Exception as e:
            logger.error("AudioMetadata", "open_transcription", f"Error opening transcription for {filename}: {e}")
            messagebox.showerror(
                "Error Opening Transcription",
                f"Could not open transcription for {filename}.\n\nError: {str(e)}",
                parent=self,
            )
            return False

    def _delete_transcription(self, filename: str) -> bool:
        """Delete transcription and analysis data for a file.

        Args:
            filename: Audio filename

        Returns:
            True if deleted successfully, False otherwise
        """
        from tkinter import messagebox

        try:
            # Confirm deletion
            result = messagebox.askyesno(
                "Delete Transcription",
                f"Delete transcription and AI analysis for {filename}?\n\n"
                "This will remove all transcription text, summaries, and insights.\n"
                "This action cannot be undone.",
                parent=self,
            )

            if not result:
                return False

            # Delete from database
            self._ensure_audio_metadata_initialized()
            success = self._audio_metadata_db.delete_metadata(filename)

            if success:
                logger.info("AudioMetadata", "delete_transcription", f"Deleted transcription for {filename}")

                # Delete exported text file if it exists
                local_path = self._find_local_file_path(filename)
                if local_path:
                    base_path = os.path.splitext(local_path)[0]
                    txt_path = f"{base_path}_transcription.txt"
                    if os.path.exists(txt_path):
                        try:
                            os.remove(txt_path)
                            logger.info("AudioMetadata", "delete_transcription", f"Deleted text file: {txt_path}")
                        except Exception as e:
                            logger.warning("AudioMetadata", "delete_transcription", f"Could not delete text file: {e}")

                # Refresh display
                self.after(0, self._refresh_file_display_for_metadata_change, filename)

                messagebox.showinfo(
                    "Transcription Deleted", f"Transcription and analysis data deleted for {filename}.", parent=self
                )
                return True
            else:
                messagebox.showerror("Delete Failed", f"Could not delete transcription for {filename}.", parent=self)
                return False

        except Exception as e:
            logger.error("AudioMetadata", "delete_transcription", f"Error deleting transcription for {filename}: {e}")
            messagebox.showerror(
                "Error", f"Error deleting transcription for {filename}.\n\nError: {str(e)}", parent=self
            )
            return False
