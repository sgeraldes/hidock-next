#!/usr/bin/env python3
"""
Fix for race condition issues in device tests.

This module provides utilities to prevent race conditions when running
device tests concurrently by implementing proper test isolation and
device state management.
"""

import asyncio
import threading
import time
from contextlib import contextmanager, asynccontextmanager
from typing import Optional

import pytest

# Global lock to prevent concurrent device access across all tests
_DEVICE_TEST_LOCK = threading.RLock()
_DEVICE_CLEANUP_DELAY = 0.5  # Seconds to wait between tests


class DeviceTestManager:
    """Manages device test execution to prevent race conditions."""
    
    def __init__(self):
        self._current_test = None
        self._device_instance = None
        self._async_lock = asyncio.Lock()
        
    @contextmanager
    def exclusive_device_access(self, test_name: str):
        """Context manager for exclusive device access during tests."""
        with _DEVICE_TEST_LOCK:
            try:
                self._current_test = test_name
                print(f"[DeviceTestManager] Starting exclusive access for: {test_name}")
                yield
            finally:
                print(f"[DeviceTestManager] Ending exclusive access for: {test_name}")
                self._current_test = None
                # Add delay to ensure device state is fully reset
                time.sleep(_DEVICE_CLEANUP_DELAY)
    
    @asynccontextmanager
    async def exclusive_async_device_access(self, test_name: str):
        """Async context manager for exclusive device access during async tests."""
        async with self._async_lock:
            try:
                self._current_test = test_name
                print(f"[DeviceTestManager] Starting exclusive async access for: {test_name}")
                yield
            finally:
                print(f"[DeviceTestManager] Ending exclusive async access for: {test_name}")
                self._current_test = None
                # Add delay to ensure device state is fully reset
                await asyncio.sleep(_DEVICE_CLEANUP_DELAY)


# Global instance
device_test_manager = DeviceTestManager()


@pytest.fixture(scope="function")
def exclusive_device_access(request):
    """Pytest fixture for exclusive device access."""
    test_name = request.node.name
    with device_test_manager.exclusive_device_access(test_name):
        yield


def ensure_device_disconnected(device_instance):
    """Ensure device is properly disconnected and cleaned up."""
    if device_instance and hasattr(device_instance, 'disconnect'):
        try:
            device_instance.disconnect()
        except Exception as e:
            print(f"[DeviceTestManager] Warning during disconnect: {e}")
    
    if device_instance and hasattr(device_instance, 'reset_device_state'):
        try:
            device_instance.reset_device_state()
        except Exception as e:
            print(f"[DeviceTestManager] Warning during reset: {e}")


async def safe_device_operation(operation_func, *args, **kwargs):
    """Safely execute a device operation with proper error handling."""
    try:
        if asyncio.iscoroutinefunction(operation_func):
            return await operation_func(*args, **kwargs)
        else:
            return operation_func(*args, **kwargs)
    except Exception as e:
        print(f"[DeviceTestManager] Operation failed: {e}")
        raise


async def safe_async_device_operation(operation_func, *args, **kwargs):
    """Safely execute an async device operation with proper error handling."""
    try:
        return await operation_func(*args, **kwargs)
    except Exception as e:
        print(f"[DeviceTestManager] Async operation failed: {e}")
        raise


def create_isolated_device_test(test_func):
    """Decorator to create isolated device tests that prevent race conditions."""
    def wrapper(*args, **kwargs):
        test_name = test_func.__name__
        with device_test_manager.exclusive_device_access(test_name):
            try:
                return test_func(*args, **kwargs)
            except Exception as e:
                print(f"[DeviceTestManager] Test {test_name} failed: {e}")
                raise
    return wrapper


async def create_isolated_async_device_test(test_func):
    """Async version of isolated device test decorator."""
    test_name = test_func.__name__
    with device_test_manager.exclusive_device_access(test_name):
        try:
            return await test_func()
        except Exception as e:
            print(f"[DeviceTestManager] Async test {test_name} failed: {e}")
            raise


# Pytest markers for device test isolation
pytest_device_isolation = pytest.mark.usefixtures("exclusive_device_access")


@pytest.fixture(autouse=True, scope="function")
def device_test_isolation(request):
    """Auto-applied fixture for device test isolation."""
    # Only apply to tests marked with @pytest.mark.device
    if request.node.get_closest_marker("device"):
        with device_test_manager.exclusive_device_access(request.node.name):
            yield
    else:
        yield


# Enhanced cleanup for device tests
@pytest.fixture(scope="function")
def device_cleanup():
    """Fixture to ensure proper device cleanup after tests."""
    devices_to_cleanup = []
    
    def register_device(device):
        devices_to_cleanup.append(device)
        return device
    
    yield register_device
    
    # Cleanup all registered devices
    for device in devices_to_cleanup:
        ensure_device_disconnected(device)