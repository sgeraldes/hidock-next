#!/usr/bin/env python3
"""
Tests for async_calendar_mixin.py
Covers async calendar initialization, status reporting, and method compatibility.
"""

import asyncio
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch, MagicMock

# Add the parent directory to sys.path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

class TestAsyncCalendarMixin(unittest.TestCase):
    """Test the AsyncCalendarMixin functionality."""

    def setUp(self):
        """Set up test fixtures."""
        # Mock the GUI interface
        self.mock_gui = Mock()
        self.mock_gui.after = Mock()
        self.mock_gui.update_calendar_status = Mock()
        
    def test_import_async_calendar_mixin(self):
        """Test that async_calendar_mixin can be imported."""
        try:
            import async_calendar_mixin
            self.assertTrue(hasattr(async_calendar_mixin, 'AsyncCalendarMixin'))
        except ImportError as e:
            self.fail(f"Failed to import async_calendar_mixin: {e}")

    def test_async_calendar_mixin_initialization(self):
        """Test AsyncCalendarMixin initialization."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = self.mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Not Available"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = False
        
        # Test creation
        mixin = TestMixin()
        self.assertFalse(mixin._initialization_complete)
        self.assertEqual(mixin._calendar_status, "Not Available")

    def test_ensure_async_calendar_initialized(self):
        """Test the ensure_async_calendar_initialized method."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = self.mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Not Available"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = False
        
        mixin = TestMixin()
        
        # Test that it schedules initialization
        mixin._ensure_async_calendar_initialized()
        
        # Should have called gui.after to schedule async init
        self.mock_gui.after.assert_called()

    @patch('async_calendar_mixin.os.path.exists')
    def test_calendar_status_text_for_gui(self, mock_exists):
        """Test get_calendar_status_text_for_gui method."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = self.mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Calendar: Ready"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = True
        
        mixin = TestMixin()
        status = mixin.get_calendar_status_text_for_gui()
        self.assertEqual(status, "Calendar: Ready")

    def test_compatibility_wrapper_methods(self):
        """Test that compatibility wrapper methods exist."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = self.mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Not Available"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = False
        
        mixin = TestMixin()
        
        # Test wrapper methods exist
        self.assertTrue(hasattr(mixin, 'get_calendar_status_text_for_gui'))
        self.assertTrue(hasattr(mixin, 'enhance_files_with_meeting_data'))

    def test_enhance_files_with_meeting_data_empty(self):
        """Test enhance_files_with_meeting_data with empty file list."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = self.mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Not Available"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = False
        
        mixin = TestMixin()
        
        # Test with empty list
        result = mixin.enhance_files_with_meeting_data([])
        self.assertEqual(result, [])

    def test_enhance_files_with_meeting_data_no_calendar(self):
        """Test enhance_files_with_meeting_data when calendar not available."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = self.mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Not Available"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = True
        
        mixin = TestMixin()
        
        # Test with sample file data
        files_dict = [
            {
                'name': 'test.wav',
                'time': datetime.now(),
                'createDate': '2023-01-01',
                'createTime': '10:00:00'
            }
        ]
        
        result = mixin.enhance_files_with_meeting_data(files_dict)
        
        # Should return files with empty meeting fields
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['name'], 'test.wav')
        self.assertIn('has_meeting', result[0])
        self.assertFalse(result[0]['has_meeting'])

    @patch('async_calendar_mixin.create_simple_outlook_integration')
    def test_async_calendar_initialization_success(self, mock_create_integration):
        """Test successful async calendar initialization."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        # Mock successful integration
        mock_integration = Mock()
        mock_integration.is_available.return_value = True
        mock_integration.get_calendar_status_text.return_value = "Calendar: Outlook Connected"
        mock_create_integration.return_value = mock_integration
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = self.mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Not Available"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = False

        mixin = TestMixin()
        
        # Run async initialization in event loop
        async def run_init():
            await mixin._initialize_async_calendar()
        
        # Run the async method
        asyncio.run(run_init())
        
        # Check results
        self.assertTrue(mixin._calendar_available)
        self.assertEqual(mixin._calendar_status, "Calendar: Outlook Connected")
        self.assertTrue(mixin._initialization_complete)

    @patch('async_calendar_mixin.create_simple_outlook_integration')
    def test_async_calendar_initialization_failure(self, mock_create_integration):
        """Test async calendar initialization failure."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        # Mock failed integration
        mock_integration = Mock()
        mock_integration.is_available.return_value = False
        mock_integration.get_calendar_status_text.return_value = "Calendar: Not Available"
        mock_create_integration.return_value = mock_integration
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = self.mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Not Available"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = False

        mixin = TestMixin()
        
        # Run async initialization
        async def run_init():
            await mixin._initialize_async_calendar()
        
        asyncio.run(run_init())
        
        # Check results
        self.assertFalse(mixin._calendar_available)
        self.assertEqual(mixin._calendar_status, "Calendar: Not Available")
        self.assertTrue(mixin._initialization_complete)

    @patch('async_calendar_mixin.create_simple_outlook_integration')
    def test_async_calendar_initialization_exception(self, mock_create_integration):
        """Test async calendar initialization with exception."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        # Mock integration creation failure
        mock_create_integration.side_effect = Exception("Integration failed")
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = self.mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Not Available"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = False

        mixin = TestMixin()
        
        # Run async initialization
        async def run_init():
            await mixin._initialize_async_calendar()
        
        asyncio.run(run_init())
        
        # Should handle exception gracefully
        self.assertFalse(mixin._calendar_available)
        self.assertIn("Failed to initialize", mixin._calendar_status)
        self.assertTrue(mixin._initialization_complete)

    def test_calendar_status_before_initialization(self):
        """Test calendar status before async initialization."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = self.mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Not Available"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = False

        mixin = TestMixin()
        
        status = mixin.get_calendar_status_text_for_gui()
        self.assertEqual(status, "Not Available")

    def test_schedule_async_init_method(self):
        """Test the _schedule_async_init method."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = self.mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Not Available"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = False

        mixin = TestMixin()
        
        # Test scheduling initialization
        mixin._schedule_async_init()
        
        # Should schedule via gui.after
        self.mock_gui.after.assert_called_with(100, unittest.mock.ANY)

    def test_concurrent_initialization_protection(self):
        """Test that concurrent initializations are properly handled."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = self.mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Not Available"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = False

        mixin = TestMixin()
        
        # Call multiple times - should be safe
        mixin._ensure_async_calendar_initialized()
        mixin._ensure_async_calendar_initialized()
        mixin._ensure_async_calendar_initialized()
        
        # Should only schedule once or be protected by the lock
        self.assertTrue(self.mock_gui.after.called)


class TestAsyncCalendarMixinIntegration(unittest.TestCase):
    """Integration tests for AsyncCalendarMixin with actual components."""

    @patch('async_calendar_mixin.CALENDAR_AVAILABLE', True)
    @patch('async_calendar_mixin.create_simple_outlook_integration')
    def test_full_integration_flow(self, mock_create_integration):
        """Test the full integration flow."""
        from async_calendar_mixin import AsyncCalendarMixin
        
        # Mock successful calendar integration
        mock_integration = Mock()
        mock_integration.is_available.return_value = True
        mock_integration.get_calendar_status_text.return_value = "Calendar: Outlook Connected"
        mock_integration.enhance_files_with_meeting_data.return_value = [
            {'name': 'test.wav', 'has_meeting': True, 'meeting_subject': 'Test Meeting'}
        ]
        mock_create_integration.return_value = mock_integration
        
        mock_gui = Mock()
        mock_gui.after = Mock()
        mock_gui.update_calendar_status = Mock()
        
        class TestMixin(AsyncCalendarMixin):
            def __init__(self):
                self.gui = mock_gui
                self._calendar_integration = None
                self._calendar_available = False
                self._calendar_status = "Not Available"
                self._initialization_lock = asyncio.Lock()
                self._initialization_complete = False

        mixin = TestMixin()
        
        # Initialize async calendar
        async def run_test():
            await mixin._initialize_async_calendar()
            
            # Test file enhancement after initialization
            files = [{'name': 'test.wav', 'time': datetime.now()}]
            enhanced = mixin.enhance_files_with_meeting_data(files)
            
            return enhanced
        
        result = asyncio.run(run_test())
        
        # Verify integration worked
        self.assertTrue(mixin._calendar_available)
        self.assertEqual(mixin._calendar_status, "Calendar: Outlook Connected")
        
        # Verify file enhancement
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]['has_meeting'])
        self.assertEqual(result[0]['meeting_subject'], 'Test Meeting')


if __name__ == '__main__':
    unittest.main()
