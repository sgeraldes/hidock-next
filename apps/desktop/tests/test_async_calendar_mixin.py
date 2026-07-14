#!/usr/bin/env python3
"""
Tests for async_calendar_mixin.py
Covers async calendar initialization, status reporting, and method compatibility.

NOTE: The mixin is a *composition collaborator*, not a true mixin — it is constructed
with AsyncCalendarMixin(gui=...) and routes GUI calls through self.gui.  It uses a
background *thread* (not asyncio) for calendar work.  These tests exercise the real
method contracts of the refactored class.
"""

import queue
import sys
import threading
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, Mock, call, patch

# Add src directory to sys.path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_gui_mock():
    """Return a fresh Mock that has the attributes the mixin touches."""
    gui = Mock()
    gui.after = Mock()
    gui.update_calendar_status = Mock()
    # device_manager: the mixin checks hasattr(self.gui, 'device_manager'), so we
    # deliberately do NOT set it here — hasattr returns False and the branch is skipped.
    return gui


def _make_mixin_bypassed(mock_gui):
    """
    Return a fully constructed AsyncCalendarMixin whose lazy init has already
    been bypassed (i.e. _async_calendar_initialized=True, no filesystem access).

    Use this when you want to test *methods other than init* without needing
    CalendarCacheManager to succeed.
    """
    from async_calendar_mixin import AsyncCalendarMixin

    m = AsyncCalendarMixin(gui=mock_gui)
    # Plant the sentinel that _ensure_async_calendar_initialized checks first:
    m._async_calendar_initialized = True
    # Populate the fields that _ensure_async_calendar_initialized normally sets:
    m._calendar_integration = None
    m._calendar_cache_manager = None
    m._calendar_worker_thread = None
    m._calendar_work_queue = queue.Queue()
    m._calendar_sync_status = "idle"
    m._calendar_sync_progress = 0.0
    m._calendar_total_files = 0
    m._calendar_processed_files = 0
    return m


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------


class TestAsyncCalendarMixin(unittest.TestCase):
    """Test the AsyncCalendarMixin functionality."""

    def setUp(self):
        """Set up test fixtures."""
        self.mock_gui = _make_gui_mock()

    # --- basic import / construction ---

    def test_import_async_calendar_mixin(self):
        """Test that async_calendar_mixin can be imported."""
        try:
            import async_calendar_mixin

            self.assertTrue(hasattr(async_calendar_mixin, "AsyncCalendarMixin"))
        except ImportError as e:
            self.fail(f"Failed to import async_calendar_mixin: {e}")

    def test_async_calendar_mixin_initialization(self):
        """AsyncCalendarMixin stores the gui reference on construction."""
        from async_calendar_mixin import AsyncCalendarMixin

        m = AsyncCalendarMixin(gui=self.mock_gui)
        self.assertIs(m.gui, self.mock_gui)
        # Before lazy init is triggered, _async_calendar_initialized should not exist
        self.assertFalse(hasattr(m, "_async_calendar_initialized"))

    # --- _ensure_async_calendar_initialized ---

    @patch("async_calendar_mixin.CalendarCacheManager")
    @patch("async_calendar_mixin.create_simple_outlook_integration")
    @patch("async_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE", True)
    def test_ensure_async_calendar_initialized(self, mock_create_integration, mock_cache_cls):
        """_ensure_async_calendar_initialized populates expected state attributes."""
        # Arrange: make calendar components succeed without real filesystem
        mock_cache_obj = Mock()
        mock_cache_obj.update_display_format_for_existing_cache = Mock()
        mock_cache_cls.return_value = mock_cache_obj

        mock_integration = Mock()
        mock_integration.is_available.return_value = True
        mock_create_integration.return_value = mock_integration

        from async_calendar_mixin import AsyncCalendarMixin

        m = AsyncCalendarMixin(gui=self.mock_gui)

        # Act
        m._ensure_async_calendar_initialized()

        # Assert: sentinel is set
        self.assertTrue(m._async_calendar_initialized)

        # Assert: all expected fields exist with sensible defaults
        self.assertIn("_calendar_sync_status", m.__dict__)
        self.assertIn("_calendar_work_queue", m.__dict__)
        self.assertIn("_calendar_total_files", m.__dict__)
        self.assertIn("_calendar_processed_files", m.__dict__)

        # Assert: calling a second time is a no-op (idempotent)
        mock_cache_cls.reset_mock()
        m._ensure_async_calendar_initialized()
        mock_cache_cls.assert_not_called()

    # --- get_calendar_status_text_for_gui / get_calendar_status_text_for_gui_async ---

    def test_calendar_status_text_for_gui(self):
        """get_calendar_status_text_for_gui returns 'Calendar: Ready' when calendar is available."""
        m = _make_mixin_bypassed(self.mock_gui)

        # Plant a working integration
        mock_integration = Mock()
        mock_integration.is_available.return_value = True
        m._calendar_integration = mock_integration
        m._calendar_sync_status = "complete"

        status = m.get_calendar_status_text_for_gui()

        self.assertEqual(status, "Calendar: Ready")

    def test_compatibility_wrapper_methods(self):
        """Compatibility wrapper methods exist on the mixin."""
        from async_calendar_mixin import AsyncCalendarMixin

        m = AsyncCalendarMixin(gui=self.mock_gui)

        self.assertTrue(hasattr(m, "get_calendar_status_text_for_gui"))
        self.assertTrue(hasattr(m, "enhance_files_with_meeting_data"))

    # --- enhance_files_with_meeting_data ---

    @patch("async_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE", False)
    def test_enhance_files_with_meeting_data_empty(self):
        """enhance_files_with_meeting_data returns [] for empty input."""
        m = _make_mixin_bypassed(self.mock_gui)

        result = m.enhance_files_with_meeting_data([])

        self.assertEqual(result, [])

    @patch("async_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE", False)
    def test_enhance_files_with_meeting_data_no_calendar(self):
        """enhance_files_with_meeting_data returns files with empty meeting fields when no calendar."""
        m = _make_mixin_bypassed(self.mock_gui)

        files_dict = [
            {"name": "test.wav", "time": datetime.now(), "createDate": "2023-01-01", "createTime": "10:00:00"}
        ]

        result = m.enhance_files_with_meeting_data(files_dict)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "test.wav")
        self.assertIn("has_meeting", result[0])
        self.assertFalse(result[0]["has_meeting"])

    # --- _initialize_async_calendar_components (sync thread-based init) ---

    @patch("async_calendar_mixin.CalendarCacheManager")
    @patch("async_calendar_mixin.create_simple_outlook_integration")
    @patch("async_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE", True)
    def test_async_calendar_initialization_success(self, mock_create_integration, mock_cache_cls):
        """_initialize_async_calendar_components succeeds and starts a worker thread."""
        mock_cache_obj = Mock()
        mock_cache_obj.update_display_format_for_existing_cache = Mock()
        mock_cache_cls.return_value = mock_cache_obj

        mock_integration = Mock()
        mock_integration.is_available.return_value = True
        mock_integration.get_calendar_status_text.return_value = "Calendar: Outlook Connected"
        mock_create_integration.return_value = mock_integration

        from async_calendar_mixin import AsyncCalendarMixin

        m = AsyncCalendarMixin(gui=self.mock_gui)
        # Pre-populate the fields that _ensure_async_calendar_initialized normally sets
        # before calling _initialize_async_calendar_components:
        m._calendar_integration = None
        m._calendar_cache_manager = None
        m._calendar_worker_thread = None
        m._calendar_work_queue = queue.Queue()
        m._calendar_sync_status = "idle"

        m._initialize_async_calendar_components()

        # Integration should have been created and the worker thread started
        self.assertIs(m._calendar_integration, mock_integration)
        self.assertIs(m._calendar_cache_manager, mock_cache_obj)
        self.assertIsNotNone(m._calendar_worker_thread)
        self.assertTrue(m._calendar_worker_thread.is_alive())

        # Clean up the daemon thread
        m._calendar_work_queue.put(None)

    @patch("async_calendar_mixin.CalendarCacheManager")
    @patch("async_calendar_mixin.create_simple_outlook_integration")
    @patch("async_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE", True)
    def test_async_calendar_initialization_failure(self, mock_create_integration, mock_cache_cls):
        """_initialize_async_calendar_components: unavailable integration leaves _calendar_integration set."""
        mock_cache_obj = Mock()
        mock_cache_obj.update_display_format_for_existing_cache = Mock()
        mock_cache_cls.return_value = mock_cache_obj

        mock_integration = Mock()
        mock_integration.is_available.return_value = False
        mock_integration.get_calendar_status_text.return_value = "Calendar: Not Available"
        mock_create_integration.return_value = mock_integration

        from async_calendar_mixin import AsyncCalendarMixin

        m = AsyncCalendarMixin(gui=self.mock_gui)
        m._calendar_integration = None
        m._calendar_cache_manager = None
        m._calendar_worker_thread = None
        m._calendar_work_queue = queue.Queue()
        m._calendar_sync_status = "idle"

        m._initialize_async_calendar_components()

        # Integration object was created even if unavailable; get_calendar_status_text_for_gui
        # will delegate to it via is_available() -> get_calendar_status_text()
        self.assertIsNotNone(m._calendar_integration)
        self.assertFalse(m._calendar_integration.is_available())

        # status text should reflect the integration's state
        m._async_calendar_initialized = True  # bypass re-init in status call
        status = m.get_calendar_status_text_for_gui()
        self.assertEqual(status, "Calendar: Not Available")

        m._calendar_work_queue.put(None)

    @patch("async_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE", True)
    @patch("async_calendar_mixin.create_simple_outlook_integration")
    @patch("async_calendar_mixin.CalendarCacheManager")
    def test_async_calendar_initialization_exception(self, mock_cache_cls, mock_create_integration):
        """_initialize_async_calendar_components: exception leaves integration as None."""
        mock_cache_obj = Mock()
        mock_cache_obj.update_display_format_for_existing_cache = Mock()
        mock_cache_cls.return_value = mock_cache_obj

        mock_create_integration.side_effect = Exception("Integration failed")

        from async_calendar_mixin import AsyncCalendarMixin

        m = AsyncCalendarMixin(gui=self.mock_gui)
        m._calendar_integration = None
        m._calendar_cache_manager = None
        m._calendar_worker_thread = None
        m._calendar_work_queue = queue.Queue()
        m._calendar_sync_status = "idle"

        # Should not raise
        m._initialize_async_calendar_components()

        # Integration was not created; the exception is caught and logged
        self.assertIsNone(m._calendar_integration)

        # Status text when integration is None:
        m._async_calendar_initialized = True
        status = m.get_calendar_status_text_for_gui()
        self.assertEqual(status, "Calendar: Not Initialized")

    # --- status text before initialization ---

    @patch("async_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE", True)
    @patch("async_calendar_mixin.CalendarCacheManager")
    @patch("async_calendar_mixin.create_simple_outlook_integration")
    def test_calendar_status_before_initialization(self, mock_create_integration, mock_cache_cls):
        """Before init, _calendar_integration is None → status is 'Calendar: Not Initialized'."""
        # Make the CalendarCacheManager constructor raise so that _initialize_async_calendar_components
        # hits its exception handler and leaves _calendar_integration=None.
        mock_cache_cls.side_effect = Exception("cache dir not found")

        from async_calendar_mixin import AsyncCalendarMixin

        m = AsyncCalendarMixin(gui=self.mock_gui)

        # get_calendar_status_text_for_gui triggers lazy init which will fail → integration stays None
        status = m.get_calendar_status_text_for_gui()

        self.assertEqual(status, "Calendar: Not Initialized")

    # --- _schedule_async_init equivalent: ensure lazy init schedules background work ---

    @patch("async_calendar_mixin.CalendarCacheManager")
    @patch("async_calendar_mixin.create_simple_outlook_integration")
    @patch("async_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE", True)
    def test_schedule_async_init_method(self, mock_create_integration, mock_cache_cls):
        """_ensure_async_calendar_initialized starts a daemon worker thread for background work."""
        mock_cache_obj = Mock()
        mock_cache_obj.update_display_format_for_existing_cache = Mock()
        mock_cache_cls.return_value = mock_cache_obj

        mock_integration = Mock()
        mock_integration.is_available.return_value = True
        mock_create_integration.return_value = mock_integration

        from async_calendar_mixin import AsyncCalendarMixin

        m = AsyncCalendarMixin(gui=self.mock_gui)
        m._ensure_async_calendar_initialized()

        # The mixin starts a daemon thread named 'CalendarWorker' for background processing
        self.assertIsNotNone(m._calendar_worker_thread)
        self.assertIsInstance(m._calendar_worker_thread, threading.Thread)
        self.assertTrue(m._calendar_worker_thread.daemon)

        m._calendar_work_queue.put(None)  # clean shutdown

    # --- concurrent initialization protection ---

    @patch("async_calendar_mixin.CalendarCacheManager")
    @patch("async_calendar_mixin.create_simple_outlook_integration")
    @patch("async_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE", True)
    def test_concurrent_initialization_protection(self, mock_create_integration, mock_cache_cls):
        """Calling _ensure_async_calendar_initialized multiple times only inits once."""
        mock_cache_obj = Mock()
        mock_cache_obj.update_display_format_for_existing_cache = Mock()
        mock_cache_cls.return_value = mock_cache_obj

        mock_integration = Mock()
        mock_integration.is_available.return_value = True
        mock_create_integration.return_value = mock_integration

        from async_calendar_mixin import AsyncCalendarMixin

        m = AsyncCalendarMixin(gui=self.mock_gui)

        m._ensure_async_calendar_initialized()
        m._ensure_async_calendar_initialized()
        m._ensure_async_calendar_initialized()

        # CalendarCacheManager should have been constructed only once
        self.assertEqual(mock_cache_cls.call_count, 1)

        m._calendar_work_queue.put(None)


# ---------------------------------------------------------------------------
# Integration tests
# ---------------------------------------------------------------------------


class TestAsyncCalendarMixinIntegration(unittest.TestCase):
    """Integration tests for AsyncCalendarMixin with actual components."""

    @patch("async_calendar_mixin.SIMPLE_CALENDAR_AVAILABLE", True)
    @patch("async_calendar_mixin.CalendarCacheManager")
    @patch("async_calendar_mixin.create_simple_outlook_integration")
    def test_full_integration_flow(self, mock_create_integration, mock_cache_cls):
        """Full integration flow: init → file enhancement returns files with meeting fields."""
        from async_calendar_mixin import AsyncCalendarMixin

        # Arrange: successful calendar integration
        mock_cache_obj = Mock()
        mock_cache_obj.update_display_format_for_existing_cache = Mock()
        mock_cache_obj.get_cached_meeting_for_file = Mock(return_value=None)
        mock_cache_obj.cache_no_meeting_for_file = Mock()
        mock_cache_cls.return_value = mock_cache_obj

        mock_integration = Mock()
        mock_integration.is_available.return_value = True
        mock_integration.get_calendar_status_text.return_value = "Calendar: Outlook Connected"
        mock_create_integration.return_value = mock_integration

        mock_gui = _make_gui_mock()

        m = AsyncCalendarMixin(gui=mock_gui)
        m._ensure_async_calendar_initialized()

        # Verify integration is available
        self.assertIsNotNone(m._calendar_integration)
        self.assertTrue(m._calendar_integration.is_available())

        # enhance_files_with_meeting_data returns immediately with empty meeting fields
        files = [{"name": "test.wav", "time": datetime.now()}]
        result = m.enhance_files_with_meeting_data(files)

        # Should return same number of files
        self.assertEqual(len(result), 1)
        # All returned files have the meeting-data shape (has_meeting key present)
        self.assertIn("has_meeting", result[0])

        # Status text for a connected but idle integration → 'Calendar: Ready'
        m._calendar_sync_status = "idle"
        status = m.get_calendar_status_text_for_gui()
        self.assertEqual(status, "Calendar: Ready")

        # Clean up daemon thread
        m._calendar_work_queue.put(None)


if __name__ == "__main__":
    unittest.main()
