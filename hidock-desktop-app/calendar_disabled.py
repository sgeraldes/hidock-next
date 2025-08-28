# calendar_disabled.py
"""
Calendar Integration Disabled

This file provides stubs for calendar integration when the O365 dependency
is not available or when calendar integration is disabled for regular users.

For advanced users who want calendar integration:
1. Install the optional dependency: pip install hidock-next[calendar]
2. Enable in configuration: calendar_provider = "outlook"
3. Configure Azure AD credentials in Settings
"""

import logging

logger = logging.getLogger(__name__)

# Calendar integration availability flag
CALENDAR_INTEGRATION_AVAILABLE = False

def is_calendar_available() -> bool:
    """Check if calendar integration is available."""
    return False

class DisabledCalendarService:
    """Disabled calendar service for when O365 is not available."""
    
    def __init__(self, config=None):
        self.config = config or {}
        logger.info("Calendar integration is disabled - O365 dependency not available")
    
    def is_available(self) -> bool:
        """Calendar service is not available."""
        return False
    
    def is_enabled(self) -> bool:
        """Calendar service is not enabled."""
        return False
    
    def is_authenticated(self) -> bool:
        """Not authenticated - service disabled."""
        return False
    
    def get_status_info(self) -> dict:
        """Return status indicating service is disabled."""
        return {
            "available": False,
            "enabled": False,
            "authenticated": False,
            "status": "Calendar integration disabled - install with: pip install hidock-next[calendar]",
            "last_sync": "Never"
        }

class DisabledMeetingMetadata:
    """Disabled meeting metadata for when calendar is not available."""
    
    def __init__(self, *args, **kwargs):
        pass
    
    def to_dict(self) -> dict:
        return {}
    
    @classmethod
    def from_dict(cls, data):
        return cls()

# Provide disabled calendar service as default
def get_calendar_service(config=None):
    """Get a disabled calendar service."""
    return DisabledCalendarService(config)

# For backwards compatibility
OutlookCalendarService = DisabledCalendarService
MeetingMetadata = DisabledMeetingMetadata
