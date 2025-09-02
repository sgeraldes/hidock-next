# status_filter_widget.py
"""
Status Filter Widget for HiDock Desktop

Provides a dropdown interface for filtering files by their status.
"""

import tkinter as tk
from typing import Callable, Optional, Dict, Any, List
import customtkinter as ctk

from config_and_logger import logger


class StatusFilterWidget(ctk.CTkFrame):
    """Dropdown widget for filtering files by status."""
    
    # Define available filter options and their display names
    FILTER_OPTIONS = {
        "all": "All Files",
        "downloaded": "Downloaded",
        "on_device": "On Device", 
        "recording": "Recording",
        "in_progress": "In Progress",
        "issues": "Issues/Errors",
        "offline": "Offline Mode"
    }
    
    # Define which actual status values map to each filter option
    STATUS_MAPPINGS = {
        "all": None,  # Show all files
        "downloaded": ["Downloaded", "Cached"],
        "on_device": ["On Device"],
        "recording": ["Recording"],
        "in_progress": ["Downloading", "Queued", "Preparing Playback", "Playing"],
        "issues": ["Mismatch", "Cancelled", "Error"],
        "offline": ["On Device (Offline)"]
    }
    
    def __init__(self, parent, filter_callback: Optional[Callable] = None, **kwargs):
        super().__init__(parent, **kwargs)
        
        self.filter_callback = filter_callback
        self.current_filter = "all"
        
        # Configure the frame
        self.configure(fg_color="transparent", border_width=0)
        self.grid_columnconfigure(1, weight=1)
        
        # Create widgets
        self._create_widgets()
        
        # Load saved filter state
        self._load_filter_state()
        
        logger.info("StatusFilter", "init", "Status filter widget initialized")
    
    def _create_widgets(self):
        """Create the filter interface widgets."""
        
        # Filter label
        self.filter_label = ctk.CTkLabel(
            self,
            text="📁 Filter by Status:",
            font=ctk.CTkFont(size=12, weight="bold")
        )
        self.filter_label.grid(row=0, column=0, padx=(5, 10), pady=5, sticky="w")
        
        # Status dropdown
        self.status_dropdown = ctk.CTkOptionMenu(
            self,
            width=160,
            height=32,
            values=list(self.FILTER_OPTIONS.values()),
            command=self._on_filter_changed
        )
        self.status_dropdown.set(self.FILTER_OPTIONS["all"])  # Default to "All Files"
        self.status_dropdown.grid(row=0, column=1, padx=5, pady=5, sticky="w")
        
        # Status info label (shows count of filtered files)
        self.status_info_label = ctk.CTkLabel(
            self,
            text="",
            font=ctk.CTkFont(size=10),
            text_color="gray"
        )
        self.status_info_label.grid(row=1, column=0, columnspan=2, padx=5, pady=(0, 5), sticky="w")
    
    def _on_filter_changed(self, selected_display_name: str):
        """Handle filter dropdown selection changes."""
        try:
            # Find the filter key corresponding to the display name
            filter_key = None
            for key, display_name in self.FILTER_OPTIONS.items():
                if display_name == selected_display_name:
                    filter_key = key
                    break
            
            if filter_key is None:
                logger.warning("StatusFilter", "filter_changed", f"Unknown filter display name: {selected_display_name}")
                return
            
            # Update current filter
            self.current_filter = filter_key
            
            # Create filter criteria
            filter_criteria = {
                'status_filter': filter_key,
                'allowed_statuses': self.STATUS_MAPPINGS[filter_key]
            }
            
            # Save filter state to configuration
            self._save_filter_state()
            
            # Call the filter callback if provided
            if self.filter_callback:
                self.filter_callback(filter_criteria)
            
            # Update status info
            self._update_status_info()
            
            logger.debug("StatusFilter", "filter_changed", f"Filter changed to: {filter_key}")
            
        except Exception as e:
            logger.error("StatusFilter", "filter_changed", f"Error changing filter: {e}")
    
    def _update_status_info(self, result_count: Optional[int] = None):
        """Update the status info label with current filter info."""
        try:
            status_text = ""
            
            if self.current_filter != "all":
                filter_display_name = self.FILTER_OPTIONS[self.current_filter]
                status_text = f"📁 Showing: {filter_display_name}"
                
                if result_count is not None:
                    status_text += f" • {result_count} files"
            else:
                status_text = "Showing all files"
                
                if result_count is not None:
                    status_text += f" • {result_count} total"
            
            self.status_info_label.configure(text=status_text)
            
        except Exception as e:
            logger.error("StatusFilter", "update_status_info", f"Error updating status info: {e}")
    
    def set_filter(self, filter_key: str):
        """Programmatically set the filter without triggering callback."""
        try:
            if filter_key in self.FILTER_OPTIONS:
                self.current_filter = filter_key
                display_name = self.FILTER_OPTIONS[filter_key]
                self.status_dropdown.set(display_name)
                self._update_status_info()
                
                logger.debug("StatusFilter", "set_filter", f"Filter set to: {filter_key}")
            else:
                logger.warning("StatusFilter", "set_filter", f"Unknown filter key: {filter_key}")
                
        except Exception as e:
            logger.error("StatusFilter", "set_filter", f"Error setting filter: {e}")
    
    def get_current_filter(self) -> Dict[str, Any]:
        """Get the current filter criteria."""
        return {
            'status_filter': self.current_filter,
            'allowed_statuses': self.STATUS_MAPPINGS[self.current_filter]
        }
    
    def clear_filter(self):
        """Reset filter to show all files."""
        try:
            self.set_filter("all")
            
            # Save the cleared state
            self._save_filter_state()
            
            # Trigger callback to update display
            if self.filter_callback:
                self.filter_callback(self.get_current_filter())
            
            logger.debug("StatusFilter", "clear_filter", "Filter cleared to show all files")
            
        except Exception as e:
            logger.error("StatusFilter", "clear_filter", f"Error clearing filter: {e}")
    
    def update_result_count(self, count: int):
        """Update the displayed result count."""
        self._update_status_info(result_count=count)
    
    def should_show_file(self, file_status: str) -> bool:
        """Check if a file with given status should be shown based on current filter."""
        if self.current_filter == "all":
            return True
        
        allowed_statuses = self.STATUS_MAPPINGS[self.current_filter]
        if allowed_statuses is None:
            return True
        
        # Special handling for offline status - should only match "offline" filter
        if "Offline" in file_status and self.current_filter != "offline":
            return False
        
        # Check for exact matches first
        if file_status in allowed_statuses:
            return True
        
        # Check for partial matches (e.g., "Downloading (50%)" matches "Downloading")
        for allowed_status in allowed_statuses:
            if file_status.startswith(allowed_status):
                return True
        
        # Special case for "Error" status matching "issues" filter
        if self.current_filter == "issues" and ("Error" in file_status or "error" in file_status.lower()):
            return True
        
        return False
    
    def _load_filter_state(self):
        """Load the saved filter state from configuration."""
        try:
            from config_and_logger import load_config
            
            config = load_config()
            saved_filter = config.get('status_filter_selection', 'all')
            
            # Validate the saved filter
            if saved_filter in self.FILTER_OPTIONS:
                self.set_filter(saved_filter)
                logger.debug("StatusFilter", "load_state", f"Loaded saved filter: {saved_filter}")
            else:
                logger.warning("StatusFilter", "load_state", f"Invalid saved filter '{saved_filter}', using default")
                self.set_filter('all')
                
        except Exception as e:
            logger.error("StatusFilter", "load_state", f"Error loading filter state: {e}")
            # Fallback to default
            self.set_filter('all')
    
    def _save_filter_state(self):
        """Save the current filter state to configuration."""
        try:
            from config_and_logger import update_config_settings
            
            update_config_settings({'status_filter_selection': self.current_filter})
            logger.debug("StatusFilter", "save_state", f"Saved filter state: {self.current_filter}")
            
        except Exception as e:
            logger.error("StatusFilter", "save_state", f"Error saving filter state: {e}")