#!/usr/bin/env python3
"""
Test to verify that the race condition fix works properly.

This test runs multiple device operations concurrently to ensure
they don't interfere with each other.
"""

import asyncio
import time
from unittest.mock import Mock, patch

import pytest

from .test_race_condition_fix import device_test_manager, ensure_device_disconnected


@pytest.mark.unit
def test_device_test_manager_isolation():
    """Test that the device test manager properly isolates tests."""
    execution_order = []

    def mock_test_1():
        with device_test_manager.exclusive_device_access("test_1"):
            execution_order.append("test_1_start")
            time.sleep(0.1)  # Simulate work
            execution_order.append("test_1_end")

    def mock_test_2():
        with device_test_manager.exclusive_device_access("test_2"):
            execution_order.append("test_2_start")
            time.sleep(0.1)  # Simulate work
            execution_order.append("test_2_end")

    # Run tests concurrently
    import threading

    thread1 = threading.Thread(target=mock_test_1)
    thread2 = threading.Thread(target=mock_test_2)

    thread1.start()
    time.sleep(0.01)  # Small delay to ensure thread1 starts first
    thread2.start()

    thread1.join()
    thread2.join()

    # Verify that tests ran in isolation (one completed before the other started)
    assert len(execution_order) == 4

    # Either test_1 completed before test_2 started, or vice versa
    test_1_isolated = (
        execution_order.index("test_1_start")
        < execution_order.index("test_1_end")
        < execution_order.index("test_2_start")
        < execution_order.index("test_2_end")
    )
    test_2_isolated = (
        execution_order.index("test_2_start")
        < execution_order.index("test_2_end")
        < execution_order.index("test_1_start")
        < execution_order.index("test_1_end")
    )

    assert test_1_isolated or test_2_isolated, f"Tests were not properly isolated: {execution_order}"


@pytest.mark.unit
def test_ensure_device_disconnected():
    """Test the device cleanup function."""
    # Mock device with disconnect and reset methods
    mock_device = Mock()
    mock_device.disconnect = Mock()
    mock_device.reset_device_state = Mock()

    # Test normal cleanup
    ensure_device_disconnected(mock_device)

    mock_device.disconnect.assert_called_once()
    mock_device.reset_device_state.assert_called_once()

    # Test cleanup with exception
    mock_device.disconnect.side_effect = Exception("Disconnect failed")
    mock_device.reset_device_state.side_effect = Exception("Reset failed")

    # Should not raise exception
    ensure_device_disconnected(mock_device)


@pytest.mark.unit
def test_ensure_device_disconnected_with_none():
    """Test device cleanup with None device."""
    # Should not raise exception
    ensure_device_disconnected(None)


@pytest.mark.unit
def test_ensure_device_disconnected_without_methods():
    """Test device cleanup with device that doesn't have disconnect/reset methods."""
    mock_device = Mock()
    # Remove the methods
    del mock_device.disconnect
    del mock_device.reset_device_state

    # Should not raise exception
    ensure_device_disconnected(mock_device)


@pytest.mark.asyncio
@pytest.mark.unit
async def test_concurrent_async_operations():
    """Test that async operations can be properly isolated."""
    results = []

    async def mock_async_operation(operation_id):
        async with device_test_manager.exclusive_async_device_access(f"async_op_{operation_id}"):
            results.append(f"start_{operation_id}")
            await asyncio.sleep(0.1)  # Simulate async work
            results.append(f"end_{operation_id}")
            return operation_id

    # Run multiple async operations concurrently
    tasks = [mock_async_operation(1), mock_async_operation(2), mock_async_operation(3)]

    completed_results = await asyncio.gather(*tasks)

    # Verify all operations completed
    assert completed_results == [1, 2, 3]
    assert len(results) == 6  # 3 start + 3 end

    # Verify operations were isolated (each start/end pair is together)
    for i in range(1, 4):
        start_idx = results.index(f"start_{i}")
        end_idx = results.index(f"end_{i}")

        # Ensure no other operation's events are between start and end
        between_events = results[start_idx + 1 : end_idx]
        assert all(
            not event.startswith(("start_", "end_")) or event == f"end_{i}" for event in between_events
        ), f"Operation {i} was not isolated: {results}"


if __name__ == "__main__":
    # Run the tests
    test_device_test_manager_isolation()
    test_ensure_device_disconnected()
    test_ensure_device_disconnected_with_none()
    test_ensure_device_disconnected_without_methods()

    # Run async test
    asyncio.run(test_concurrent_async_operations())

    print("✓ All race condition verification tests passed!")
