import time

import pytest

from file_operations_manager import FileOperationsManager


def test_queue_download(mocker):
    device_manager = mocker.Mock()
    file_operations_manager = FileOperationsManager(device_manager, "/tmp")
    file_operations_manager.queue_download("test.wav")
    time.sleep(1)
    assert file_operations_manager.operation_queue.qsize() == 0
