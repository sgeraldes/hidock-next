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
from typing import Dict, List, Optional, Any, Callable

from config_and_logger import logger
from audio_metadata_db import AudioMetadataDB, AudioMetadata, ProcessingStatus, get_audio_metadata_db


class AudioMetadataMixin:
    """Mixin for integrating audio metadata with the GUI."""
    
    def _ensure_audio_metadata_initialized(self):
        """Initialize audio metadata system (lazy initialization)."""
        if not hasattr(self, '_audio_metadata_initialized'):
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
            filename = file_data['name']
            
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
                logger.warning("AudioMetadata", "enhance_files", 
                             f"Error enhancing {filename} with metadata: {e}")
                enhanced_file.update(self._create_empty_metadata_fields())
            
            enhanced_files.append(enhanced_file)
        
        return enhanced_files
    
    def _create_metadata_entry_for_file(self, file_data: Dict):
        """Create a metadata entry for a new file."""
        try:
            filename = file_data['name']
            file_path = file_data.get('local_path', '')
            
            # If no local path is available (file not downloaded), use a placeholder path
            if not file_path:
                # Use download directory as base path for potential future downloads
                download_dir = getattr(self, 'download_directory', os.path.expanduser('~/Downloads'))
                file_path = os.path.join(download_dir, filename)
            
            file_size = file_data.get('length', 0)
            duration_seconds = file_data.get('duration', 0)
            
            # Parse date created
            date_created = file_data.get('time')
            if not isinstance(date_created, datetime):
                date_created = datetime.now()
            
            self._audio_metadata_db.create_file_entry(
                filename=filename,
                file_path=file_path,
                file_size=file_size,
                duration_seconds=duration_seconds,
                date_created=date_created
            )
            
        except Exception as e:
            logger.warning("AudioMetadata", "_create_metadata_entry", 
                         f"Error creating metadata entry: {e}")
    
    def _create_metadata_display_fields(self, metadata: AudioMetadata) -> Dict[str, Any]:
        """Create display fields from audio metadata."""
        fields = {
            # Processing status for meeting column
            'audio_processing_status': metadata.processing_status.value,
            'audio_processing_display': self._audio_metadata_db.get_status_display_text(metadata),
            
            # Content fields
            'audio_title': metadata.display_title or '',
            'audio_description': metadata.display_description or '',
            'audio_transcription': metadata.transcription_text or '',
            'audio_ai_summary': metadata.ai_summary or '',
            'audio_user_title': metadata.user_title or '',
            'audio_user_description': metadata.user_description or '',
            
            # Participants and action items
            'audio_ai_participants': metadata.ai_participants or [],
            'audio_user_participants': metadata.user_participants or [],
            'audio_ai_action_items': metadata.ai_action_items or [],
            'audio_user_action_items': metadata.user_action_items or [],
            
            # Other fields
            'audio_topics': metadata.ai_topics or [],
            'audio_sentiment': metadata.ai_sentiment or '',
            'audio_user_tags': metadata.user_tags or [],
            'audio_user_notes': metadata.user_notes or '',
            
            'description_display_text': metadata.display_description or '',
        }
        
        # Only override meeting display if we have processed content
        meeting_display = self._get_meeting_column_display(metadata)
        if meeting_display is not None:
            fields['meeting_display_text'] = meeting_display
        # If meeting_display is None, don't add the field to preserve existing calendar data
        
        return fields
    
    def _create_empty_metadata_fields(self) -> Dict[str, Any]:
        """Create empty metadata fields for new files."""
        return {
            'audio_processing_status': ProcessingStatus.NOT_PROCESSED.value,
            'audio_processing_display': '',
            'audio_title': '',
            'audio_description': '',
            'audio_transcription': '',
            'audio_ai_summary': '',
            'audio_user_title': '',
            'audio_user_description': '',
            'audio_ai_participants': [],
            'audio_user_participants': [],
            'audio_ai_action_items': [],
            'audio_user_action_items': [],
            'audio_topics': [],
            'audio_sentiment': '',
            'audio_user_tags': [],
            'audio_user_notes': '',
            # Note: Don't include 'meeting_display_text' here to preserve calendar data
            'description_display_text': '',
        }
    
    def _get_meeting_column_display(self, metadata: AudioMetadata) -> str:
        """Get text to display in the meeting column of TreeView."""
        # Priority system for meeting column display:
        # 1. Processing status messages (Transcribing..., Analyzing...)
        # 2. User title (if set)
        # 3. AI summary (first line)
        # 4. Calendar meeting info (from calendar cache - keep existing)
        # 5. Blank
        
        if metadata.processing_status == ProcessingStatus.TRANSCRIBING:
            return "Transcribing..."
        elif metadata.processing_status == ProcessingStatus.AI_ANALYZING:
            return "Analyzing..."
        elif metadata.processing_status == ProcessingStatus.ERROR:
            return "Processing Error"
        elif metadata.user_title:
            return metadata.user_title
        elif metadata.ai_summary:
            # Use first line of AI summary, truncated
            first_line = metadata.ai_summary.split('\n')[0]
            return first_line[:45] + "..." if len(first_line) > 45 else first_line
        else:
            # Return None to use existing calendar meeting display
            return None
    
    def start_audio_processing(self, filename: str) -> bool:
        """Start processing an audio file (transcription + AI analysis)."""
        self._ensure_audio_metadata_initialized()
        
        try:
            # Update status to transcribing
            success = self._audio_metadata_db.update_processing_status(
                filename, ProcessingStatus.TRANSCRIBING
            )
            
            if success:
                # Trigger GUI update
                self.after(0, self._refresh_file_display_for_metadata_change, filename)
                
                # Start background processing
                threading.Thread(
                    target=self._process_audio_file_background,
                    args=(filename,),
                    daemon=True,
                    name=f"AudioProcessor-{filename}"
                ).start()
                
                logger.info("AudioMetadata", "start_processing", 
                          f"Started processing for {filename}")
                return True
            
            return False
            
        except Exception as e:
            logger.error("AudioMetadata", "start_processing", 
                       f"Error starting processing for {filename}: {e}")
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
                logger.error("AudioMetadata", "_process_background", 
                           f"No metadata found for {filename}")
                return
            
            # Find local file path
            local_path = self._find_local_file_path(filename)
            if not local_path:
                logger.error("AudioMetadata", "_process_background", 
                           f"No local file found for {filename}")
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
                    transcription_text=transcription_result['text'],
                    confidence=transcription_result.get('confidence'),
                    language=transcription_result.get('language')
                )
                
                self.after(0, self._refresh_file_display_for_metadata_change, filename)
                
                # Step 2: AI Analysis
                self._audio_metadata_db.update_processing_status(filename, ProcessingStatus.AI_ANALYZING)
                self.after(0, self._refresh_file_display_for_metadata_change, filename)
                
                ai_result = self._analyze_transcription_with_ai(transcription_result['text'])
                if ai_result:
                    # Save AI analysis
                    self._audio_metadata_db.save_ai_analysis(
                        filename=filename,
                        summary=ai_result.get('summary'),
                        participants=ai_result.get('participants'),
                        action_items=ai_result.get('action_items'),
                        topics=ai_result.get('topics'),
                        sentiment=ai_result.get('sentiment'),
                        key_quotes=ai_result.get('key_quotes')
                    )
                    
                    # Mark as completed
                    self._audio_metadata_db.update_processing_status(filename, ProcessingStatus.COMPLETED)
                    
                    logger.info("AudioMetadata", "_process_background", 
                              f"Completed processing for {filename}")
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
            logger.error("AudioMetadata", "_process_background", 
                       f"Error processing {filename}: {e}")
            self._audio_metadata_db.update_processing_status(
                filename, ProcessingStatus.ERROR, str(e)
            )
            self.after(0, self._refresh_file_display_for_metadata_change, filename)
    
    def _find_local_file_path(self, filename: str) -> Optional[str]:
        """Find local path for an audio file."""
        try:
            # Check if file is downloaded
            for file_detail in getattr(self, 'displayed_files_details', []):
                if file_detail.get('name') == filename:
                    local_path = file_detail.get('local_path')
                    if local_path and os.path.exists(local_path):
                        return local_path
            
            # Check common download locations
            import os
            download_dir = getattr(self, 'download_directory', os.path.expanduser("~/Downloads"))
            potential_path = os.path.join(download_dir, filename)
            if os.path.exists(potential_path):
                return potential_path
            
            return None
            
        except Exception as e:
            logger.warning("AudioMetadata", "_find_local_file", 
                         f"Error finding local file for {filename}: {e}")
            return None
    
    def _transcribe_audio_file(self, file_path: str) -> Optional[Dict[str, Any]]:
        """Transcribe audio file using the transcription module."""
        try:
            # Import transcription module
            from transcription_module import process_audio_file_for_insights
            
            logger.info("AudioMetadata", "_transcribe", f"Starting transcription of {file_path}")
            
            # Process the audio file
            result = process_audio_file_for_insights(file_path)
            
            if result and 'transcription' in result:
                transcription_text = result['transcription']
                
                return {
                    'text': transcription_text,
                    'confidence': result.get('transcription_confidence'),
                    'language': result.get('language', 'en')
                }
            else:
                logger.warning("AudioMetadata", "_transcribe", 
                             f"No transcription result for {file_path}")
                return None
                
        except Exception as e:
            logger.error("AudioMetadata", "_transcribe", 
                       f"Error transcribing {file_path}: {e}")
            return None
    
    def _analyze_transcription_with_ai(self, transcription_text: str) -> Optional[Dict[str, Any]]:
        """Analyze transcription using AI service."""
        try:
            # Import AI service
            from ai_service import process_audio_insights
            
            logger.info("AudioMetadata", "_analyze_ai", 
                       f"Starting AI analysis of transcription ({len(transcription_text)} chars)")
            
            # Analyze with AI
            result = process_audio_insights(transcription_text)
            
            if result:
                return {
                    'summary': result.get('summary', ''),
                    'participants': result.get('participants', []),
                    'action_items': result.get('action_items', []),
                    'topics': result.get('topics', []),
                    'sentiment': result.get('sentiment', ''),
                    'key_quotes': result.get('key_quotes', [])
                }
            else:
                logger.warning("AudioMetadata", "_analyze_ai", "No AI analysis result")
                return None
                
        except Exception as e:
            logger.error("AudioMetadata", "_analyze_ai", f"Error in AI analysis: {e}")
            return None
    
    def _refresh_file_display_for_metadata_change(self, filename: str):
        """Refresh the display for a specific file when its metadata changes."""
        try:
            # Find the file in displayed_files_details and update it
            if hasattr(self, 'displayed_files_details'):
                for i, file_detail in enumerate(self.displayed_files_details):
                    if file_detail.get('name') == filename:
                        # Get updated metadata
                        metadata = self._audio_metadata_db.get_metadata(filename)
                        if metadata:
                            # Update the file detail with new metadata
                            file_detail.update(self._create_metadata_display_fields(metadata))
                            
                            # Update the TreeView item directly
                            if hasattr(self, 'file_tree') and self.file_tree.winfo_exists():
                                if self.file_tree.exists(filename):
                                    self._update_treeview_item_with_metadata(filename, file_detail)
                        break
            
        except Exception as e:
            logger.warning("AudioMetadata", "_refresh_display", 
                         f"Error refreshing display for {filename}: {e}")
    
    def _update_treeview_item_with_metadata(self, filename: str, file_detail: Dict):
        """Update a specific TreeView item with new metadata."""
        try:
            # Get current values
            current_values = list(self.file_tree.item(filename, "values"))
            
            # Update meeting column (index 5) with processing status or result
            meeting_text = file_detail.get('meeting_display_text', '')
            if meeting_text is None:
                # Use existing calendar meeting text if no override
                meeting_text = current_values[5] if len(current_values) > 5 else ''
            
            # Update the meeting column
            if len(current_values) > 5:
                current_values[5] = meeting_text
                self.file_tree.item(filename, values=current_values)
            
        except Exception as e:
            logger.warning("AudioMetadata", "_update_treeview_item", 
                         f"Error updating TreeView item {filename}: {e}")
    
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
    
    def update_user_audio_metadata(self, filename: str, title: str = None, 
                                  description: str = None, participants: List[str] = None,
                                  action_items: List[str] = None, tags: List[str] = None,
                                  notes: str = None) -> bool:
        """Update multiple user fields for an audio file."""
        self._ensure_audio_metadata_initialized()
        
        success = self._audio_metadata_db.update_user_fields(
            filename=filename,
            user_title=title,
            user_description=description,
            user_participants=participants,
            user_action_items=action_items,
            user_tags=tags,
            user_notes=notes
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
            logger.warning("AudioMetadata", "get_ready_files", 
                         f"Error getting ready files: {e}")
        
        return ready_files
    
    def batch_process_ready_files(self, max_files: int = 5) -> int:
        """Start batch processing of ready files."""
        ready_files = self.get_files_ready_for_processing()[:max_files]
        
        started_count = 0
        for filename in ready_files:
            if self.start_audio_processing(filename):
                started_count += 1
        
        if started_count > 0:
            logger.info("AudioMetadata", "batch_process", 
                       f"Started processing {started_count} files")
        
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
                            command=lambda: self.start_audio_processing(filename)
                        )
                    else:
                        menu.add_command(
                            label="Download First to Process",
                            state="disabled"
                        )
                
                menu.add_command(
                    label="Edit Metadata...",
                    command=lambda: self.show_audio_metadata_dialog(filename)
                )
                
                if metadata.transcription_text:
                    menu.add_command(
                        label="View Transcription",
                        command=lambda: self._show_transcription_viewer(filename)
                    )
            
            # Show menu
            menu.tk_popup(event.x_root, event.y_root)
            
        except Exception as e:
            logger.warning("AudioMetadata", "right_click_menu", 
                         f"Error showing metadata menu: {e}")
    
    def _show_transcription_viewer(self, filename: str):
        """Show transcription in a viewer window."""
        # TODO: Implement transcription viewer
        logger.info("AudioMetadata", "show_transcription", 
                   f"Transcription viewer requested for {filename}")
        pass
