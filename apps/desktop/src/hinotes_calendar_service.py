# hinotes_calendar_service.py
"""
HiNotes Backend-Mediated Calendar Service.

This service integrates with Microsoft Outlook and Google Calendar via the HiNotes backend API
(hinotes.hidock.com). It uses OAuth2 authentication with a browser-based flow.

Key Features:
- Cross-platform (Windows, macOS, Linux)
- No local OAuth app registration needed
- Unified event format (backend normalizes Microsoft/Google events)
- Automatic token refresh handled by backend
- Supports both Microsoft Outlook and Google Calendar

Architecture:
    Desktop App → Browser (OAuth) → HiNotes Backend → Calendar API (Microsoft/Google)

Authentication Flow:
1. App opens browser to OAuth URL (hinotes.hidock.com/calendar/authorize)
2. User logs in with Microsoft/Google account
3. User grants calendar permissions
4. Backend receives authorization code and exchanges for tokens
5. App polls backend for connection status
6. App can now fetch calendar events via backend API

API Endpoints:
- POST /v1/calendar/status - Check connection status
- POST /v1/calendar/oauth2/authorize - Submit OAuth authorization code
- POST /v1/calendar/microsoft/sync - Trigger Microsoft calendar sync
- POST /v1/calendar/google/sync - Trigger Google calendar sync
- GET /v1/calendar/event/list - Fetch calendar events (date range)
"""

import json
import time
import webbrowser
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlencode

import requests

from config_and_logger import logger

# HiNotes Backend API Configuration
HINOTES_API_BASE = "https://hinotes.hidock.com"
HINOTES_API_VERSION = "v1"


@dataclass
class CalendarEvent:
    """Represents a calendar event from HiNotes backend (normalized format)."""

    title: str
    start_time: datetime
    end_time: datetime
    location: str = ""
    owner: str = ""
    status: str = ""  # accepted, tentative, declined
    meeting_way: str = ""  # teams, zoom, google-meet, in-person, etc.
    event_id: str = ""

    def to_dict(self) -> Dict:
        """Convert event to dictionary for storage."""
        return {
            "title": self.title,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "location": self.location,
            "owner": self.owner,
            "status": self.status,
            "meeting_way": self.meeting_way,
            "event_id": self.event_id,
        }

    @classmethod
    def from_hinotes_api(cls, event_data: Dict) -> "CalendarEvent":
        """Create CalendarEvent from HiNotes API response format."""
        calendar_event = event_data.get("calendarEvent", {})

        # Parse datetime strings from backend format: "2025-12-05 14:00:00.0"
        start_time = None
        end_time = None

        if calendar_event.get("startTime"):
            try:
                # Remove trailing .0 and parse
                start_str = calendar_event["startTime"].rsplit(".", 1)[0]
                start_time = datetime.strptime(start_str, "%Y-%m-%d %H:%M:%S")
            except Exception as e:
                logger.warning("HiNotesCalendar", "parse_start_time", f"Error parsing start time: {e}")

        if calendar_event.get("endTime"):
            try:
                end_str = calendar_event["endTime"].rsplit(".", 1)[0]
                end_time = datetime.strptime(end_str, "%Y-%m-%d %H:%M:%S")
            except Exception as e:
                logger.warning("HiNotesCalendar", "parse_end_time", f"Error parsing end time: {e}")

        return cls(
            title=calendar_event.get("title", "No Title"),
            start_time=start_time,
            end_time=end_time,
            location=calendar_event.get("location", ""),
            owner=calendar_event.get("owner", ""),
            status=calendar_event.get("status", ""),
            meeting_way=calendar_event.get("meetingWay", ""),
            event_id=calendar_event.get("id", ""),
        )


class HiNotesCalendarService:
    """
    Calendar service using HiNotes backend API.

    This service mediates calendar access through the HiNotes backend, which handles
    OAuth2 authentication and token management for both Microsoft and Google calendars.
    """

    # OAuth2 Configuration (from HAR analysis)
    MICROSOFT_CLIENT_ID = "287048ad-e335-4cbd-8d76-658acb0785d5"
    MICROSOFT_SCOPES = "openid offline_access Calendars.Read"

    GOOGLE_CLIENT_ID = "122776600569-vi9kuatv0lltcut7f8hrpq5e5ln7qf3j.apps.googleusercontent.com"
    GOOGLE_SCOPES = "openid https://www.googleapis.com/auth/calendar"

    def __init__(self, config, access_token: str):
        """
        Initialize HiNotes calendar service.

        Args:
            config: Application configuration object
            access_token: HiDock user session token (from HiDock account login)
        """
        self.config = config
        self.access_token = access_token
        self.session = requests.Session()
        self.session.headers.update(
            {
                "AccessToken": access_token,
                "Content-Type": "application/json",
            }
        )

    def _make_api_request(self, method: str, endpoint: str, **kwargs) -> Optional[Dict]:
        """
        Make API request to HiNotes backend.

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint (e.g., '/v1/calendar/status')
            **kwargs: Additional arguments passed to requests

        Returns:
            JSON response as dictionary, or None on error
        """
        url = f"{HINOTES_API_BASE}{endpoint}"

        try:
            response = self.session.request(method, url, **kwargs)
            response.raise_for_status()

            # Parse JSON response
            data = response.json()

            # Check for API-level errors
            if data.get("code") != 200:
                error_msg = data.get("msg", "Unknown error")
                logger.error("HiNotesCalendar", "api_request", f"API error: {error_msg}")
                return None

            return data

        except requests.exceptions.RequestException as e:
            logger.error("HiNotesCalendar", "api_request", f"Request error: {e}")
            return None
        except json.JSONDecodeError as e:
            logger.error("HiNotesCalendar", "api_request", f"JSON decode error: {e}")
            return None

    def get_oauth_url(self, provider: str = "microsoft") -> str:
        """
        Get OAuth2 authorization URL for user to visit in browser.

        Args:
            provider: 'microsoft' or 'google'

        Returns:
            Full OAuth2 authorization URL
        """
        if provider == "microsoft":
            params = {
                "client_id": self.MICROSOFT_CLIENT_ID,
                "response_type": "code",
                "redirect_uri": f"{HINOTES_API_BASE}/auth",
                "scope": self.MICROSOFT_SCOPES,
                "response_mode": "query",
            }
            auth_url = f"https://login.microsoftonline.com/common/oauth2/v2.0/authorize?{urlencode(params)}"

        elif provider == "google":
            params = {
                "client_id": self.GOOGLE_CLIENT_ID,
                "response_type": "code",
                "redirect_uri": f"{HINOTES_API_BASE}/auth",
                "scope": self.GOOGLE_SCOPES,
                "access_type": "offline",
                "prompt": "consent",
            }
            auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"

        else:
            raise ValueError(f"Unsupported provider: {provider}")

        return auth_url

    def open_oauth_in_browser(self, provider: str = "microsoft") -> bool:
        """
        Open OAuth2 authorization URL in user's default browser.

        Args:
            provider: 'microsoft' or 'google'

        Returns:
            True if browser opened successfully, False otherwise
        """
        try:
            oauth_url = self.get_oauth_url(provider)
            webbrowser.open(oauth_url)
            logger.info("HiNotesCalendar", "open_oauth", f"Opened {provider} OAuth in browser")
            return True

        except Exception as e:
            logger.error("HiNotesCalendar", "open_oauth", f"Error opening browser: {e}")
            return False

    def check_connection_status(self, provider: str = "microsoft") -> Tuple[bool, Optional[str]]:
        """
        Check if calendar is connected for specified provider.

        Args:
            provider: 'microsoft' or 'google'

        Returns:
            Tuple of (is_connected, user_email)
        """
        payload = {"calendarWay": "microsoft" if provider == "microsoft" else "google"}

        response = self._make_api_request("POST", f"/{HINOTES_API_VERSION}/calendar/status", json=payload)

        if not response:
            return False, None

        data = response.get("data", {})
        is_connected = data.get("isConnect", False)
        user_email = data.get("email", "")

        return is_connected, user_email

    def wait_for_oauth_completion(
        self, provider: str = "microsoft", timeout_seconds: int = 120, poll_interval: float = 2.0
    ) -> Tuple[bool, Optional[str]]:
        """
        Poll backend until OAuth connection is established or timeout.

        Use this after opening OAuth URL in browser to wait for user to complete login.

        Args:
            provider: 'microsoft' or 'google'
            timeout_seconds: Maximum time to wait (default 120 seconds = 2 minutes)
            poll_interval: Time between status checks (default 2 seconds)

        Returns:
            Tuple of (success, user_email)
        """
        start_time = time.time()
        last_log_time = start_time

        logger.info(
            "HiNotesCalendar", "wait_oauth", f"Waiting for {provider} OAuth completion (timeout: {timeout_seconds}s)"
        )

        while time.time() - start_time < timeout_seconds:
            is_connected, user_email = self.check_connection_status(provider)

            if is_connected:
                logger.info("HiNotesCalendar", "wait_oauth", f"OAuth completed successfully: {user_email}")
                return True, user_email

            # Log every 10 seconds to show progress
            if time.time() - last_log_time >= 10:
                elapsed = int(time.time() - start_time)
                logger.info("HiNotesCalendar", "wait_oauth", f"Still waiting... ({elapsed}s elapsed)")
                last_log_time = time.time()

            time.sleep(poll_interval)

        logger.warning("HiNotesCalendar", "wait_oauth", f"OAuth timeout after {timeout_seconds}s")
        return False, None

    def trigger_sync(self, provider: str = "microsoft") -> bool:
        """
        Trigger calendar sync on backend (fetches latest events from provider).

        Args:
            provider: 'microsoft' or 'google'

        Returns:
            True if sync triggered successfully, False otherwise
        """
        endpoint = (
            f"/{HINOTES_API_VERSION}/calendar/microsoft/sync"
            if provider == "microsoft"
            else f"/{HINOTES_API_VERSION}/calendar/google/sync"
        )

        response = self._make_api_request("POST", endpoint, json={})

        if response:
            logger.info("HiNotesCalendar", "trigger_sync", f"Calendar sync triggered for {provider}")
            return True
        else:
            logger.error("HiNotesCalendar", "trigger_sync", f"Failed to trigger sync for {provider}")
            return False

    def get_events(self, start_date: datetime, end_date: datetime, provider: str = "microsoft") -> List[CalendarEvent]:
        """
        Fetch calendar events from backend for specified date range.

        Args:
            start_date: Start of date range
            end_date: End of date range
            provider: 'microsoft' or 'google'

        Returns:
            List of CalendarEvent objects
        """
        # Format dates as YYYY-MM-DD
        payload = {
            "startDate": start_date.strftime("%Y-%m-%d"),
            "endDate": end_date.strftime("%Y-%m-%d"),
            "calendarWay": "microsoft" if provider == "microsoft" else "google",
        }

        response = self._make_api_request("GET", f"/{HINOTES_API_VERSION}/calendar/event/list", params=payload)

        if not response:
            return []

        data = response.get("data", {})
        events_by_date = data.get("calendarEventPageResult", {})

        # Parse date-grouped events
        all_events = []

        for date_str, events_list in events_by_date.items():
            if not isinstance(events_list, list):
                continue

            for event_data in events_list:
                try:
                    event = CalendarEvent.from_hinotes_api(event_data)
                    all_events.append(event)
                except Exception as e:
                    logger.warning("HiNotesCalendar", "parse_event", f"Error parsing event: {e}")

        logger.info(
            "HiNotesCalendar",
            "get_events",
            f"Retrieved {len(all_events)} events from {start_date.date()} to {end_date.date()}",
        )
        return all_events

    def find_event_for_recording(
        self,
        recording_time: datetime,
        duration_seconds: int = None,
        provider: str = "microsoft",
        tolerance_minutes: int = 30,
    ) -> Optional[CalendarEvent]:
        """
        Find calendar event that matches a recording timestamp.

        Args:
            recording_time: When the recording started
            duration_seconds: Recording duration (optional, for better matching)
            provider: 'microsoft' or 'google'
            tolerance_minutes: How far before/after event start to search (default 30)

        Returns:
            CalendarEvent if match found, None otherwise
        """
        # Search window: tolerance before recording, 6 hours after
        search_start = recording_time - timedelta(minutes=tolerance_minutes)
        search_end = recording_time + timedelta(hours=6)

        events = self.get_events(search_start, search_end, provider)

        if not events:
            return None

        # Find best matching event
        best_match = None
        best_score = 0

        for event in events:
            if not event.start_time or not event.end_time:
                continue

            # Score 1: Recording starts during event
            if event.start_time <= recording_time <= event.end_time:
                score = 1.0
                if score > best_score:
                    best_score = score
                    best_match = event

            # Score 2: Recording starts near event start
            else:
                start_diff_minutes = abs((recording_time - event.start_time).total_seconds() / 60)
                if start_diff_minutes <= tolerance_minutes:
                    score = (tolerance_minutes - start_diff_minutes) / tolerance_minutes
                    if score > best_score:
                        best_score = score
                        best_match = event

        if best_match:
            logger.info(
                "HiNotesCalendar",
                "find_event",
                f"Found event '{best_match.title}' for recording at {recording_time} (score: {best_score:.2f})",
            )

        return best_match

    def disconnect(self, provider: str = "microsoft") -> bool:
        """
        Disconnect calendar integration (revoke backend tokens).

        Args:
            provider: 'microsoft' or 'google'

        Returns:
            True if disconnected successfully, False otherwise
        """
        # Note: Backend API endpoint for disconnect not observed in HAR file
        # May need to implement or request backend support
        logger.warning("HiNotesCalendar", "disconnect", "Disconnect endpoint not yet implemented")
        return False


# Convenience function for quick testing
def test_calendar_integration(access_token: str, provider: str = "microsoft"):
    """
    Test calendar integration with HiNotes backend.

    Args:
        access_token: HiDock user session token
        provider: 'microsoft' or 'google'
    """
    from config_and_logger import config

    service = HiNotesCalendarService(config, access_token)

    print(f"\n=== Testing {provider.title()} Calendar Integration ===\n")

    # 1. Check current connection status
    print("1. Checking connection status...")
    is_connected, email = service.check_connection_status(provider)
    print(f"   Connected: {is_connected}")
    if email:
        print(f"   Account: {email}")

    # 2. If not connected, open OAuth flow
    if not is_connected:
        print("\n2. Opening OAuth in browser...")
        if service.open_oauth_in_browser(provider):
            print("   Browser opened. Please complete login and grant permissions.")
            print("   Waiting for OAuth completion (up to 2 minutes)...")

            success, email = service.wait_for_oauth_completion(provider, timeout_seconds=120)

            if success:
                print(f"   ✓ Connected successfully as {email}")
            else:
                print("   ✗ OAuth timeout or cancelled")
                return
        else:
            print("   ✗ Failed to open browser")
            return

    # 3. Trigger sync
    print("\n3. Triggering calendar sync...")
    if service.trigger_sync(provider):
        print("   ✓ Sync triggered")
    else:
        print("   ✗ Sync failed")

    # 4. Fetch events
    print("\n4. Fetching events for next 7 days...")
    start_date = datetime.now()
    end_date = start_date + timedelta(days=7)

    events = service.get_events(start_date, end_date, provider)
    print(f"   Found {len(events)} events")

    if events:
        print("\n   Recent events:")
        for i, event in enumerate(events[:5], 1):
            print(f"   {i}. {event.title}")
            print(f"      {event.start_time.strftime('%Y-%m-%d %H:%M')} - {event.end_time.strftime('%H:%M')}")
            if event.location:
                print(f"      Location: {event.location}")

    print("\n=== Test Complete ===\n")


if __name__ == "__main__":
    # Example usage
    print("HiNotes Calendar Service")
    print("========================")
    print("\nTo test this service, you need a HiDock user access token.")
    print("Get it from: https://hinotes.hidock.com (login and extract from browser dev tools)")
    print("\nExample:")
    print('  test_calendar_integration("your_access_token_here", provider="microsoft")')
