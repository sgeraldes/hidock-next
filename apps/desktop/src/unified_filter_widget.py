# unified_filter_widget.py
"""
Unified Filter Widget for HiDock Desktop

Provides a clean, horizontal interface combining calendar search and status filtering.
"""

import tkinter as tk
from typing import Callable, Optional, Dict, Any, List
import customtkinter as ctk

from config_and_logger import logger


class UnifiedFilterWidget(ctk.CTkFrame):
    """Unified widget combining calendar search and status filtering in a clean interface."""
    
    # Status filter options (same as before but more concise)
    STATUS_FILTERS = {
        "all": "All Files",
        "downloaded": "Downloaded", 
        "on_device": "On Device",
        "recording": "Recording",
        "in_progress": "In Progress",
        "issues": "Issues",
        "offline": "Offline"
    }
    
    STATUS_MAPPINGS = {
        "all": None,
        "downloaded": ["Downloaded", "Cached"],
        "on_device": ["On Device"],
        "recording": ["Recording"],
        "in_progress": ["Downloading", "Queued", "Preparing Playback", "Playing"],
        "issues": ["Mismatch", "Cancelled", "Error"],
        "offline": ["On Device (Offline)"]
    }
    
    def __init__(self, parent, 
                 calendar_callback: Optional[Callable] = None,
                 status_callback: Optional[Callable] = None, 
                 **kwargs):
        super().__init__(parent, **kwargs)
        
        self.calendar_callback = calendar_callback
        self.status_callback = status_callback
        
        # Filter state
        self.current_calendar_filters = {}
        self.current_status_filter = "all"
        self.file_count = 0
        self.total_files = 0
        
        # Configure frame for horizontal layout
        self.configure(fg_color="transparent", border_width=0, height=45)
        self.grid_columnconfigure(1, weight=1)  # Search entry expands
        self.grid_columnconfigure(5, weight=0)  # Status area fixed width
        
        # Create the unified interface
        self._create_unified_interface()
        
        # Load saved states
        self._load_saved_states()
        
        logger.info("UnifiedFilter", "init", "Unified filter widget initialized")
    
    def _create_unified_interface(self):
        """Create the clean, horizontal filter interface."""
        
        # === LEFT SIDE: Meeting Search ===
        # Search icon + label
        self.search_icon_label = ctk.CTkLabel(
            self, text="🔍", font=ctk.CTkFont(size=16)
        )
        self.search_icon_label.grid(row=0, column=0, padx=(0, 5), pady=8, sticky="w")
        
        # Search entry (compact, no placeholder needed)
        self.search_entry = ctk.CTkEntry(
            self,
            placeholder_text="Search meetings...",
            width=240,
            height=32
        )
        self.search_entry.grid(row=0, column=1, padx=0, pady=8, sticky="ew")
        self.search_entry.bind("<KeyRelease>", self._on_search_changed)
        self.search_entry.bind("<Return>", self._on_search_enter)
        
        # Clear search button (only shows when there's text)
        self.clear_search_button = ctk.CTkButton(
            self, text="×", width=28, height=28,
            font=ctk.CTkFont(size=16, weight="bold"),
            command=self._clear_search,
            fg_color="transparent",
            hover_color="gray30"
        )
        
        # === SEPARATOR ===
        self.separator = ctk.CTkLabel(
            self, text="│", 
            font=ctk.CTkFont(size=20),
            text_color="gray50"
        )
        self.separator.grid(row=0, column=2, padx=15, pady=8)
        
        # === RIGHT SIDE: Status Filter ===
        # Status icon + label
        self.status_icon_label = ctk.CTkLabel(
            self, text="📁", font=ctk.CTkFont(size=16)
        )
        self.status_icon_label.grid(row=0, column=3, padx=(0, 5), pady=8, sticky="w")
        
        # Status dropdown (compact)
        self.status_dropdown = ctk.CTkOptionMenu(
            self,
            width=130,
            height=32,
            values=list(self.STATUS_FILTERS.values()),
            command=self._on_status_changed
        )
        self.status_dropdown.set(self.STATUS_FILTERS["all"])
        self.status_dropdown.grid(row=0, column=4, padx=0, pady=8)
        
        # === UNIFIED STATUS DISPLAY ===
        self.status_display = ctk.CTkLabel(
            self,
            text="",
            font=ctk.CTkFont(size=11),
            text_color="gray60"
        )
        self.status_display.grid(row=0, column=5, padx=(15, 0), pady=8, sticky="e")
        
        # Update initial display
        self._update_status_display()
    
    def _on_search_changed(self, event=None):
        """Handle search text changes with debouncing."""
        search_text = self.search_entry.get().strip()
        
        # Show/hide clear button
        if search_text:
            self.clear_search_button.grid(row=0, column=1, padx=(205, 0), pady=8, sticky="e")
        else:
            self.clear_search_button.grid_remove()
        
        # Cancel existing timer
        if hasattr(self, '_search_timer'):
            self.after_cancel(self._search_timer)
        
        # Set new timer (200ms for more responsive feel)
        self._search_timer = self.after(200, lambda: self._perform_search(search_text))
    
    def _on_search_enter(self, event=None):
        """Handle immediate search when Enter is pressed."""
        search_text = self.search_entry.get().strip()
        
        if hasattr(self, '_search_timer'):
            self.after_cancel(self._search_timer)
        
        self._perform_search(search_text)
    
    def _perform_search(self, search_text: str):
        """Perform calendar search."""
        try:
            # Update calendar filters
            if search_text:
                self.current_calendar_filters = {
                    'subject': search_text,
                    'search_type': 'subject'
                }
            else:
                self.current_calendar_filters = {}
            
            # Call callback
            if self.calendar_callback:
                self.calendar_callback(self.current_calendar_filters)
            
            # Update display
            self._update_status_display()
            
            logger.debug("UnifiedFilter", "search", f"Search performed: '{search_text}'")
            
        except Exception as e:
            logger.error("UnifiedFilter", "search", f"Error performing search: {e}")
    
    def _clear_search(self):
        """Clear the search."""
        try:
            self.search_entry.delete(0, tk.END)
            self.clear_search_button.grid_remove()
            
            self.current_calendar_filters = {}
            
            if self.calendar_callback:
                self.calendar_callback(self.current_calendar_filters)
            
            self._update_status_display()
            
        except Exception as e:
            logger.error("UnifiedFilter", "clear_search", f"Error clearing search: {e}")
    
    def _on_status_changed(self, selected_display_name: str):
        """Handle status filter changes."""
        try:
            # Find filter key
            filter_key = None
            for key, display_name in self.STATUS_FILTERS.items():
                if display_name == selected_display_name:
                    filter_key = key
                    break
            
            if filter_key is None:
                return
            
            self.current_status_filter = filter_key
            
            # Save state
            self._save_status_state()
            
            # Create filter criteria
            filter_criteria = {
                'status_filter': filter_key,
                'allowed_statuses': self.STATUS_MAPPINGS[filter_key]
            }
            
            # Call callback
            if self.status_callback:
                self.status_callback(filter_criteria)
            
            # Update display
            self._update_status_display()
            
        except Exception as e:
            logger.error("UnifiedFilter", "status_changed", f"Error changing status filter: {e}")
    
    def _update_status_display(self):
        """Update the unified status display showing active filters and counts."""
        try:
            status_parts = []
            
            # Calendar search status
            if self.current_calendar_filters:
                search_term = self.current_calendar_filters.get('subject', '')
                status_parts.append(f"🔍 \"{search_term}\"")
            
            # Status filter (only show if not "all")
            if self.current_status_filter != "all":
                filter_name = self.STATUS_FILTERS[self.current_status_filter]
                status_parts.append(f"📁 {filter_name}")
            
            # File count
            if self.file_count != self.total_files and self.total_files > 0:
                # Filtered view
                status_parts.append(f"{self.file_count}/{self.total_files} files")
            elif self.total_files > 0:
                # All files view
                status_parts.append(f"{self.total_files} files")
            
            # Combine status parts
            if status_parts:
                status_text = " • ".join(status_parts)
            else:
                status_text = f"{self.total_files} files" if self.total_files > 0 else ""
            
            self.status_display.configure(text=status_text)
            
        except Exception as e:
            logger.error("UnifiedFilter", "update_status", f"Error updating status display: {e}")
    
    def update_file_counts(self, displayed_count: int, total_count: int = None):
        """Update file count display."""
        self.file_count = displayed_count
        if total_count is not None:
            self.total_files = total_count
        self._update_status_display()
    
    def set_status_filter(self, filter_key: str, trigger_callback: bool = True):
        """Programmatically set status filter."""
        if filter_key in self.STATUS_FILTERS:
            self.current_status_filter = filter_key
            display_name = self.STATUS_FILTERS[filter_key]
            self.status_dropdown.set(display_name)
            
            if trigger_callback and self.status_callback:
                filter_criteria = {
                    'status_filter': filter_key,
                    'allowed_statuses': self.STATUS_MAPPINGS[filter_key]
                }
                self.status_callback(filter_criteria)
            
            self._update_status_display()
    
    def clear_all_filters(self):
        """Clear both search and status filters."""
        self._clear_search()
        self.set_status_filter("all")
    
    def get_current_filters(self) -> Dict[str, Any]:
        """Get current filter state."""
        return {
            'calendar_filters': self.current_calendar_filters.copy(),
            'status_filter': self.current_status_filter,
            'status_criteria': {
                'status_filter': self.current_status_filter,
                'allowed_statuses': self.STATUS_MAPPINGS[self.current_status_filter]
            }
        }
    
    def should_show_file(self, file_status: str) -> bool:
        """Check if file should be shown based on status filter."""
        if self.current_status_filter == "all":
            return True
        
        allowed_statuses = self.STATUS_MAPPINGS[self.current_status_filter]
        if not allowed_statuses:
            return True
        
        # Special handling for offline files
        if "Offline" in file_status and self.current_status_filter != "offline":
            return False
        
        # Exact matches
        if file_status in allowed_statuses:
            return True
        
        # Partial matches
        for allowed_status in allowed_statuses:
            if file_status.startswith(allowed_status):
                return True
        
        # Error handling
        if self.current_status_filter == "issues" and ("Error" in file_status or "error" in file_status.lower()):
            return True
        
        return False
    
    def _load_saved_states(self):
        """Load saved filter states."""
        try:
            from config_and_logger import load_config
            
            config = load_config()
            
            # Load status filter
            saved_status = config.get('status_filter_selection', 'all')
            if saved_status in self.STATUS_FILTERS:
                self.set_status_filter(saved_status, trigger_callback=False)
            
        except Exception as e:
            logger.error("UnifiedFilter", "load_states", f"Error loading saved states: {e}")
    
    def _save_status_state(self):
        """Save status filter state."""
        try:
            from config_and_logger import update_config_settings
            
            update_config_settings({'status_filter_selection': self.current_status_filter})
            
        except Exception as e:
            logger.error("UnifiedFilter", "save_status", f"Error saving status state: {e}")