# calendar_search_widget.py
"""
Calendar Search Widget for HiDock Desktop

Provides a search interface for filtering meetings by subject, participant, and other criteria.
"""

import tkinter as tk
from typing import Callable, Optional, Dict, Any
import customtkinter as ctk

from config_and_logger import logger


class CalendarSearchWidget(ctk.CTkFrame):
    """Search widget for filtering calendar meetings in the file list."""
    
    def __init__(self, parent, search_callback: Optional[Callable] = None, **kwargs):
        super().__init__(parent, **kwargs)
        
        self.search_callback = search_callback
        self.current_filters = {}
        
        # Configure the frame
        self.configure(fg_color="transparent", border_width=0)
        self.grid_columnconfigure(1, weight=1)
        
        # Create widgets
        self._create_widgets()
        
        logger.info("CalendarSearch", "init", "Calendar search widget initialized")
    
    def _create_widgets(self):
        """Create the search interface widgets."""
        
        # Search label
        self.search_label = ctk.CTkLabel(
            self,
            text="🔍 Search Meetings:",
            font=ctk.CTkFont(size=12, weight="bold")
        )
        self.search_label.grid(row=0, column=0, padx=(5, 10), pady=5, sticky="w")
        
        # Search entry with placeholder
        self.search_entry = ctk.CTkEntry(
            self,
            placeholder_text="Search by meeting subject...",
            width=300,
            height=32
        )
        self.search_entry.grid(row=0, column=1, padx=5, pady=5, sticky="ew")
        
        # Bind search events
        self.search_entry.bind("<KeyRelease>", self._on_search_changed)
        self.search_entry.bind("<Return>", self._on_search_enter)
        
        # Clear button
        self.clear_button = ctk.CTkButton(
            self,
            text="Clear",
            width=60,
            height=32,
            command=self._clear_search
        )
        self.clear_button.grid(row=0, column=2, padx=(5, 0), pady=5)
        
        # Status label (shows active filters and result count)
        self.status_label = ctk.CTkLabel(
            self,
            text="",
            font=ctk.CTkFont(size=10),
            text_color="gray"
        )
        self.status_label.grid(row=1, column=0, columnspan=3, padx=5, pady=(0, 5), sticky="w")
    
    def _on_search_changed(self, event=None):
        """Handle search text changes with debouncing."""
        search_text = self.search_entry.get().strip()
        
        # Cancel any existing search timer
        if hasattr(self, '_search_timer'):
            self.after_cancel(self._search_timer)
        
        # Set new timer for debounced search (300ms delay)
        self._search_timer = self.after(300, lambda: self._perform_search(search_text))
    
    def _on_search_enter(self, event=None):
        """Handle immediate search when Enter is pressed."""
        search_text = self.search_entry.get().strip()
        
        # Cancel any pending timer and search immediately
        if hasattr(self, '_search_timer'):
            self.after_cancel(self._search_timer)
        
        self._perform_search(search_text)
    
    def _perform_search(self, search_text: str):
        """Perform the actual search operation."""
        try:
            # Update current filters
            if search_text:
                self.current_filters = {
                    'subject': search_text,
                    'search_type': 'subject'
                }
            else:
                self.current_filters = {}
            
            # Call the search callback if provided
            if self.search_callback:
                self.search_callback(self.current_filters)
            
            # Update status
            self._update_status()
            
            logger.debug("CalendarSearch", "search", f"Search performed: '{search_text}'")
            
        except Exception as e:
            logger.error("CalendarSearch", "search", f"Error performing search: {e}")
    
    def _clear_search(self):
        """Clear the search and reset filters."""
        try:
            # Clear the search entry
            self.search_entry.delete(0, tk.END)
            
            # Clear filters
            self.current_filters = {}
            
            # Trigger search callback with empty filters
            if self.search_callback:
                self.search_callback(self.current_filters)
            
            # Update status
            self._update_status()
            
            logger.debug("CalendarSearch", "clear", "Search cleared")
            
        except Exception as e:
            logger.error("CalendarSearch", "clear", f"Error clearing search: {e}")
    
    def _update_status(self, result_count: Optional[int] = None):
        """Update the status label with current filter info."""
        try:
            status_text = ""
            
            if self.current_filters:
                if 'subject' in self.current_filters:
                    status_text = f"🔍 Filtering by subject: '{self.current_filters['subject']}'"
                
                if result_count is not None:
                    status_text += f" • {result_count} results"
            else:
                status_text = "Showing all meetings"
                if result_count is not None:
                    status_text += f" • {result_count} total"
            
            self.status_label.configure(text=status_text)
            
        except Exception as e:
            logger.error("CalendarSearch", "update_status", f"Error updating status: {e}")
    
    def set_result_count(self, count: int):
        """Update the status with search result count."""
        self._update_status(result_count=count)
    
    def get_current_filters(self) -> Dict[str, Any]:
        """Get the current active filters."""
        return self.current_filters.copy()
    
    def set_search_text(self, text: str):
        """Programmatically set the search text."""
        self.search_entry.delete(0, tk.END)
        self.search_entry.insert(0, text)
        self._perform_search(text)
    
    def focus_search(self):
        """Focus the search entry field."""
        self.search_entry.focus()
    
    def is_search_active(self) -> bool:
        """Check if any search filters are currently active."""
        return bool(self.current_filters)