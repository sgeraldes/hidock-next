"""
HiNotes API Service - Calendar and User Integration

This module provides integration with the HiNotes cloud service for:
- User authentication
- Calendar event synchronization
- Device status checking

Based on analysis of HiNotes API (see docs/transcription-feature/HINOTES_AUTHENTICATION_ANALYSIS.md)
"""

import requests
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class HiNotesService:
    """
    HiNotes API integration service.

    This is a Phase 1 implementation using manual token configuration.
    Future versions will implement automatic login flow.
    """

    BASE_URL = "https://hinotes.hidock.com"

    def __init__(self, config):
        """
        Initialize HiNotes service.

        Args:
            config: Application config dict (from config_and_logger.py)
        """
        self.config = config
        self.token = config.get("hinotes_access_token", None)

    # ─────────────────────────────────────────────────────────────────
    # Configuration & Authentication
    # ─────────────────────────────────────────────────────────────────

    def is_configured(self) -> bool:
        """
        Check if HiNotes integration is configured.

        Returns:
            True if AccessToken is set
        """
        return bool(self.token)

    def configure_token(self, token: str) -> bool:
        """
        Set AccessToken from user input.

        This is the Phase 1 approach where users manually extract
        the token from browser DevTools.

        Args:
            token: 64-character AccessToken from HiNotes web app

        Returns:
            True if token is valid format

        Raises:
            ValueError: If token format is invalid
        """
        if not token or len(token) != 64:
            raise ValueError("AccessToken must be exactly 64 characters")

        # Basic validation - should be alphanumeric
        if not token.isalnum():
            raise ValueError("AccessToken should only contain letters and numbers")

        self.token = token
        logger.info("HiNotes AccessToken configured")

        # Save to config
        from config_and_logger import save_config

        self.config["hinotes_access_token"] = token
        save_config(self.config)

        return True

    def clear_configuration(self):
        """Remove stored AccessToken."""
        self.token = None

        if "hinotes_access_token" in self.config:
            del self.config["hinotes_access_token"]

        from config_and_logger import save_config

        save_config(self.config)

        logger.info("HiNotes configuration cleared")

    # ─────────────────────────────────────────────────────────────────
    # Core API Request Methods
    # ─────────────────────────────────────────────────────────────────

    def _make_request(
        self, method: str, endpoint: str, require_auth: bool = True, **kwargs
    ) -> Optional[requests.Response]:
        """
        Make HTTP request to HiNotes API.

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint path (e.g., '/v1/user/info')
            require_auth: Whether request requires AccessToken
            **kwargs: Additional arguments for requests.request()

        Returns:
            Response object or None on error

        Raises:
            RuntimeError: If authentication required but not configured
        """
        if require_auth:
            if not self.token:
                raise RuntimeError(
                    "HiNotes not configured. Please set AccessToken in Settings."
                )

            # Add AccessToken header
            headers = kwargs.get("headers", {})
            headers["AccessToken"] = self.token
            kwargs["headers"] = headers

        url = f"{self.BASE_URL}{endpoint}"

        try:
            logger.debug(f"HiNotes API: {method} {endpoint}")
            response = requests.request(method, url, timeout=10, **kwargs)

            # Log response status
            logger.debug(f"HiNotes API response: {response.status_code}")

            # Check for authentication errors
            if response.status_code == 401:
                logger.error("HiNotes AccessToken expired or invalid")
                # Clear invalid token
                self.clear_configuration()
                raise RuntimeError(
                    "HiNotes AccessToken expired. Please reconfigure in Settings."
                )

            return response

        except requests.RequestException as e:
            logger.error(f"HiNotes API request failed: {e}")
            return None

    def _parse_response(self, response: Optional[requests.Response]) -> Optional[Any]:
        """
        Parse HiNotes API response.

        HiNotes responses follow this format:
        {
            "error": 0,  // 0 = success
            "message": "success",
            "data": { ... }
        }

        Args:
            response: Response object from _make_request

        Returns:
            Response data on success, None on error
        """
        if response is None:
            return None

        try:
            data = response.json()

            if data.get("error") == 0:
                return data.get("data")
            else:
                logger.error(f"HiNotes API error: {data.get('message')}")
                return None

        except ValueError as e:
            logger.error(f"Failed to parse HiNotes response: {e}")
            return None

    # ─────────────────────────────────────────────────────────────────
    # User Information
    # ─────────────────────────────────────────────────────────────────

    def get_user_info(self) -> Optional[Dict[str, Any]]:
        """
        Fetch current user information.

        This is useful for:
        - Validating the AccessToken
        - Displaying user email/name in UI
        - Checking account type (free/pro)

        Returns:
            User info dict with keys:
            - id: User ID
            - email: User's email
            - name: User's display name
            - type: Account type ('free' or 'pro')
            - avatar: Avatar URL
            - totalNoteCount: Number of notes
            - totalNoteDuration: Total recording duration (seconds)
            - region: User's region code
            - limitations: List of account limitations

        Example:
            {
                "id": "5459419178391982080",
                "type": "pro",
                "name": "John Doe",
                "email": "john@example.com",
                "language": "en",
                "avatar": "https://hinotes.hidock.com/.../avatar.jpg",
                "totalNoteCount": 50,
                "totalNoteDuration": 1687
            }
        """
        response = self._make_request("POST", "/v1/user/info")
        user_info = self._parse_response(response)

        if user_info:
            logger.info(f"User: {user_info.get('name')} ({user_info.get('email')})")

        return user_info

    def validate_token(self) -> bool:
        """
        Validate AccessToken by making API request.

        Returns:
            True if token is valid, False otherwise
        """
        user_info = self.get_user_info()
        return user_info is not None

    # ─────────────────────────────────────────────────────────────────
    # Calendar Integration
    # ─────────────────────────────────────────────────────────────────

    def get_calendar_events(
        self,
        start_time: datetime,
        end_time: datetime,
        tz_offset_minutes: int = 0,
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Fetch calendar events in date range.

        This retrieves events from Microsoft/Google calendars that are
        linked to the user's HiNotes account.

        Args:
            start_time: Start of date range
            end_time: End of date range
            tz_offset_minutes: Timezone offset in minutes from UTC
                              (e.g., -300 for EST, +60 for CET)

        Returns:
            List of calendar events or None on error

        Example:
            start = datetime.now()
            end = start + timedelta(days=7)
            events = service.get_calendar_events(start, end, tz_offset_minutes=-300)

            for event in events:
                print(f"{event['title']} at {event['start']}")
        """
        params = {
            "start_time": start_time.strftime("%Y-%m-%d %H:%M:%S"),
            "end_time": end_time.strftime("%Y-%m-%d %H:%M:%S"),
            "tz_offset": tz_offset_minutes,
        }

        logger.debug(
            f"Fetching calendar events: {params['start_time']} to {params['end_time']}"
        )

        response = self._make_request("GET", "/v1/calendar/event/list", params=params)

        events = self._parse_response(response)

        if events:
            logger.info(f"Retrieved {len(events)} calendar events")

        return events

    def get_calendar_status(self) -> Optional[Dict[str, Any]]:
        """
        Get calendar integration status.

        Returns info about which calendar providers are connected
        (Microsoft, Google) and their sync status.

        Returns:
            Calendar status dict or None on error
        """
        response = self._make_request("POST", "/v1/calendar/status")
        return self._parse_response(response)

    def sync_calendar_to_device(
        self,
        start_time: datetime,
        end_time: datetime,
        tz_offset_minutes: int = 0,
    ) -> bool:
        """
        Sync calendar events to HiDock device.

        This tells the HiNotes backend to push calendar events to
        the connected HiDock device.

        Args:
            start_time: Start of date range
            end_time: End of date range
            tz_offset_minutes: Timezone offset in minutes

        Returns:
            True if sync successful
        """
        params = {
            "start_time": start_time.strftime("%Y-%m-%d %H:%M:%S"),
            "end_time": end_time.strftime("%Y-%m-%d %H:%M:%S"),
            "tz_offset": tz_offset_minutes,
        }

        response = self._make_request(
            "GET", "/v1/calendar/event/sync/device", params=params
        )

        success = self._parse_response(response) is not None

        if success:
            logger.info("Calendar synced to device")

        return success

    # ─────────────────────────────────────────────────────────────────
    # Device Status
    # ─────────────────────────────────────────────────────────────────

    def check_device_status(self, device_sn: str) -> Optional[Dict[str, Any]]:
        """
        Check device ownership and status.

        Args:
            device_sn: Device serial number (e.g., "HD1E243505435")

        Returns:
            Device status dict with keys:
            - owner: Owner info (or None if current user owns it)
            - ownership: "mine" | "shared" | "other"
            - accessibility: "read-write" | "read-only"
            - name: Device name

        Example:
            {
                "owner": null,
                "ownership": "mine",
                "accessibility": "read-write",
                "name": "HiDock Workstation"
            }
        """
        response = self._make_request(
            "POST",
            "/v1/user/device/status",
            data=f"deviceSn={device_sn}",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        device_status = self._parse_response(response)

        if device_status:
            logger.info(
                f"Device {device_sn}: ownership={device_status.get('ownership')}"
            )

        return device_status

    # ─────────────────────────────────────────────────────────────────
    # Notes & Folders
    # ─────────────────────────────────────────────────────────────────

    def get_notes_list(self) -> Optional[List[Dict[str, Any]]]:
        """
        Get list of user's notes.

        Returns:
            List of note metadata dicts or None on error
        """
        response = self._make_request("POST", "/v2/note/list")
        return self._parse_response(response)

    def get_latest_note(self) -> Optional[Dict[str, Any]]:
        """
        Get most recent note.

        Returns:
            Note metadata dict or None
        """
        response = self._make_request("POST", "/v2/note/latest")
        return self._parse_response(response)

    def get_folders_list(self) -> Optional[List[Dict[str, Any]]]:
        """
        Get list of user's folders.

        Returns:
            List of folder dicts or None on error
        """
        response = self._make_request("POST", "/v1/folder/list")
        return self._parse_response(response)


# ─────────────────────────────────────────────────────────────────────
# Module-level convenience functions
# ─────────────────────────────────────────────────────────────────────


def get_hinotes_service(config) -> HiNotesService:
    """
    Get HiNotesService instance.

    Args:
        config: Application config dict

    Returns:
        Initialized HiNotesService
    """
    return HiNotesService(config)


# ─────────────────────────────────────────────────────────────────────
# CLI Testing
# ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    """Test HiNotes service from command line."""
    import sys
    from config_and_logger import load_config

    # Load config
    config = load_config()

    service = HiNotesService(config)

    if not service.is_configured():
        print("HiNotes not configured.")
        print("\nTo configure:")
        print("1. Login to https://hinotes.hidock.com")
        print("2. Open DevTools (F12) → Network tab")
        print("3. Trigger any request (click Notes)")
        print("4. Click on a request → Headers")
        print("5. Find 'AccessToken' header")
        print("6. Copy the 64-character value")
        print()

        token = input("Paste AccessToken (or press Enter to skip): ").strip()

        if token:
            try:
                service.configure_token(token)
                print("✅ Token configured")
            except ValueError as e:
                print(f"❌ Invalid token: {e}")
                sys.exit(1)
        else:
            sys.exit(0)

    # Validate token
    print("\n🔍 Validating token...")
    if not service.validate_token():
        print("❌ Token is invalid or expired")
        sys.exit(1)

    print("✅ Token is valid")

    # Get user info
    print("\n👤 User Info:")
    user = service.get_user_info()
    if user:
        print(f"  Name: {user['name']}")
        print(f"  Email: {user['email']}")
        print(f"  Type: {user['type']}")
        print(f"  Notes: {user['totalNoteCount']}")
        print(f"  Duration: {user['totalNoteDuration']}s")

    # Get calendar status
    print("\n📅 Calendar Status:")
    cal_status = service.get_calendar_status()
    if cal_status:
        print(f"  {cal_status}")
    else:
        print("  No calendar configured")

    # Get calendar events (next 7 days)
    print("\n📆 Upcoming Events (next 7 days):")
    start = datetime.now()
    end = start + timedelta(days=7)

    # Assuming timezone offset (adjust based on your location)
    import time

    tz_offset = -int(time.timezone / 60)  # Get local timezone offset in minutes

    events = service.get_calendar_events(start, end, tz_offset_minutes=tz_offset)

    if events:
        print(f"  Found {len(events)} events")
        for event in events[:5]:  # Show first 5
            print(f"  - {event.get('title', 'Untitled')}")
    else:
        print("  No events found (or calendar not configured)")

    print("\n✅ All tests passed!")
