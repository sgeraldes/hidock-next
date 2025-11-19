# microsoft_graph_api.py
"""
Microsoft Graph API Client for Calendar Access.

Provides direct access to Microsoft Graph API for reading calendar events.
Uses OAuth2 access tokens for authentication.

API Documentation:
https://learn.microsoft.com/en-us/graph/api/calendar-list-events

Endpoints:
- GET /me/calendarview - Get calendar events in date range
- GET /me/events - Get all events
- GET /me/calendars - List calendars
"""

import requests
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from dataclasses import dataclass

from config_and_logger import logger


@dataclass
class GraphCalendarEvent:
    """Represents a calendar event from Microsoft Graph API."""

    id: str
    subject: str
    start_time: datetime
    end_time: datetime
    location: str = ""
    organizer: str = ""
    attendees: List[str] = None
    body: str = ""
    is_all_day: bool = False
    is_recurring: bool = False
    web_link: str = ""
    online_meeting_url: str = ""

    def __post_init__(self):
        if self.attendees is None:
            self.attendees = []

    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            'id': self.id,
            'subject': self.subject,
            'start_time': self.start_time.isoformat() if self.start_time else None,
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'location': self.location,
            'organizer': self.organizer,
            'attendees': self.attendees,
            'body': self.body,
            'is_all_day': self.is_all_day,
            'is_recurring': self.is_recurring,
            'web_link': self.web_link,
            'online_meeting_url': self.online_meeting_url,
        }


class MicrosoftGraphAPI:
    """
    Client for Microsoft Graph API calendar operations.

    Usage:
        api = MicrosoftGraphAPI(access_token)
        events = api.get_calendar_events(start_date, end_date)
    """

    BASE_URL = 'https://graph.microsoft.com/v1.0'

    def __init__(self, access_token: str):
        """
        Initialize Graph API client.

        Args:
            access_token: OAuth2 access token
        """
        self.access_token = access_token
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
        })

    def get_calendar_events(
        self,
        start_date: datetime,
        end_date: datetime,
        max_results: int = 100
    ) -> List[GraphCalendarEvent]:
        """
        Get calendar events in date range.

        Uses the /me/calendarview endpoint which expands recurring events.

        Args:
            start_date: Start of date range (inclusive)
            end_date: End of date range (exclusive)
            max_results: Maximum number of events to return (default 100)

        Returns:
            List of GraphCalendarEvent objects

        Raises:
            Exception: If API call fails
        """
        url = f"{self.BASE_URL}/me/calendarview"

        # Format dates as ISO 8601 with timezone
        params = {
            'startDateTime': start_date.isoformat(),
            'endDateTime': end_date.isoformat(),
            '$select': 'id,subject,start,end,location,organizer,attendees,bodyPreview,isAllDay,recurrence,webLink,onlineMeeting',
            '$orderby': 'start/dateTime',
            '$top': max_results,
        }

        logger.info("GraphAPI", "get_events",
                   f"Fetching events from {start_date.date()} to {end_date.date()}")

        try:
            response = self.session.get(url, params=params, timeout=30)
            response.raise_for_status()

            data = response.json()
            events_data = data.get('value', [])

            logger.info("GraphAPI", "get_events", f"Retrieved {len(events_data)} events")

            # Parse events
            events = []
            for event_data in events_data:
                try:
                    event = self._parse_event(event_data)
                    events.append(event)
                except Exception as e:
                    logger.warning("GraphAPI", "parse_event", f"Error parsing event: {e}")
                    continue

            return events

        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 401:
                logger.error("GraphAPI", "get_events", "Access token expired or invalid")
                raise Exception("Access token expired. Please re-authenticate.")
            else:
                logger.error("GraphAPI", "get_events", f"HTTP error {e.response.status_code}: {e}")
                raise Exception(f"Failed to fetch calendar events: {e}")

        except Exception as e:
            logger.error("GraphAPI", "get_events", f"Unexpected error: {e}")
            raise

    def _parse_event(self, event_data: Dict) -> GraphCalendarEvent:
        """Parse event data from Graph API response."""

        # Parse start and end times
        start_time = None
        end_time = None

        if 'start' in event_data and event_data['start']:
            start_str = event_data['start'].get('dateTime')
            if start_str:
                # Graph API returns datetime with timezone info
                start_time = datetime.fromisoformat(start_str.replace('Z', '+00:00'))

        if 'end' in event_data and event_data['end']:
            end_str = event_data['end'].get('dateTime')
            if end_str:
                end_time = datetime.fromisoformat(end_str.replace('Z', '+00:00'))

        # Parse organizer
        organizer = ""
        if 'organizer' in event_data and event_data['organizer']:
            email_address = event_data['organizer'].get('emailAddress', {})
            organizer = email_address.get('address', '')

        # Parse attendees
        attendees = []
        if 'attendees' in event_data and event_data['attendees']:
            for attendee in event_data['attendees']:
                email_address = attendee.get('emailAddress', {})
                email = email_address.get('address', '')
                if email:
                    attendees.append(email)

        # Parse location
        location = ""
        if 'location' in event_data and event_data['location']:
            location = event_data['location'].get('displayName', '')

        # Parse online meeting URL
        online_meeting_url = ""
        if 'onlineMeeting' in event_data and event_data['onlineMeeting']:
            online_meeting_url = event_data['onlineMeeting'].get('joinUrl', '')

        # Check if recurring
        is_recurring = bool(event_data.get('recurrence'))

        return GraphCalendarEvent(
            id=event_data.get('id', ''),
            subject=event_data.get('subject', 'No Subject'),
            start_time=start_time,
            end_time=end_time,
            location=location,
            organizer=organizer,
            attendees=attendees,
            body=event_data.get('bodyPreview', ''),
            is_all_day=event_data.get('isAllDay', False),
            is_recurring=is_recurring,
            web_link=event_data.get('webLink', ''),
            online_meeting_url=online_meeting_url,
        )

    def get_user_profile(self) -> Dict:
        """
        Get user profile information.

        Returns:
            Dictionary with user info (email, name, etc.)
        """
        url = f"{self.BASE_URL}/me"

        params = {
            '$select': 'id,displayName,mail,userPrincipalName',
        }

        try:
            response = self.session.get(url, params=params, timeout=10)
            response.raise_for_status()

            user_data = response.json()

            return {
                'id': user_data.get('id', ''),
                'name': user_data.get('displayName', ''),
                'email': user_data.get('mail') or user_data.get('userPrincipalName', ''),
            }

        except Exception as e:
            logger.error("GraphAPI", "get_user", f"Error: {e}")
            return {}

    def find_event_for_recording(
        self,
        recording_time: datetime,
        duration_seconds: Optional[int] = None,
        tolerance_minutes: int = 30
    ) -> Optional[GraphCalendarEvent]:
        """
        Find calendar event matching a recording timestamp.

        Args:
            recording_time: When the recording started
            duration_seconds: Recording duration (optional)
            tolerance_minutes: Search window before/after (default 30)

        Returns:
            Best matching GraphCalendarEvent or None
        """
        # Search window
        search_start = recording_time - timedelta(minutes=tolerance_minutes)
        search_end = recording_time + timedelta(hours=6)  # 6 hours after

        events = self.get_calendar_events(search_start, search_end)

        if not events:
            return None

        # Find best match
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
            logger.info("GraphAPI", "find_event",
                       f"Found match: '{best_match.subject}' (score: {best_score:.2f})")

        return best_match


# Testing interface
if __name__ == '__main__':
    import sys

    print("=== Microsoft Graph API Test ===\n")

    # Need access token to test
    if len(sys.argv) < 2:
        print("Usage: python microsoft_graph_api.py <access_token>")
        print("\nTo get an access token:")
        print("  python oauth2_manager.py")
        print("\nThen copy the access_token and run:")
        print("  python microsoft_graph_api.py <token>")
        sys.exit(1)

    access_token = sys.argv[1]

    # Create API client
    api = MicrosoftGraphAPI(access_token)

    # Test 1: Get user profile
    print("1. Getting user profile...")
    try:
        profile = api.get_user_profile()
        print(f"   Name: {profile.get('name')}")
        print(f"   Email: {profile.get('email')}")
        print()
    except Exception as e:
        print(f"   Error: {e}\n")

    # Test 2: Get calendar events
    print("2. Getting calendar events for next 7 days...")
    try:
        start_date = datetime.now()
        end_date = start_date + timedelta(days=7)

        events = api.get_calendar_events(start_date, end_date)
        print(f"   Found {len(events)} events\n")

        if events:
            print("   Recent events:")
            for i, event in enumerate(events[:5], 1):
                print(f"   {i}. {event.subject}")
                print(f"      {event.start_time.strftime('%Y-%m-%d %H:%M')} - {event.end_time.strftime('%H:%M')}")
                if event.location:
                    print(f"      Location: {event.location}")
                if event.online_meeting_url:
                    print(f"      Online: {event.online_meeting_url[:50]}...")
                print()

    except Exception as e:
        print(f"   Error: {e}\n")
