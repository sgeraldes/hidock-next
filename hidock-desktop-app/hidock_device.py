import threading
import struct

# For platform detection (e.g., in connect method for kernel driver)
import sys
import time
import traceback  # For detailed error logging
from datetime import datetime  # Needed for set_device_time method's type hint

# usb.backend.libusb1 is usually implicitly handled by pyusb when a backend is found,
# but explicit import can sometimes help in specific environments or for clarity.
# If your setup works without it, it can be omitted. For now, keeping as per original.
import usb.backend.libusb1
import usb.core
import usb.util

# Import the global logger instance from config_and_logger.py
from config_and_logger import logger

# Import constants from the constants.py module
from constants import (
    CMD_DELETE_FILE,
    CMD_FORMAT_CARD,
    CMD_GET_CARD_INFO,
    CMD_GET_DEVICE_INFO,
    CMD_GET_DEVICE_TIME,
    CMD_GET_FILE_BLOCK,
    CMD_GET_FILE_COUNT,
    CMD_GET_FILE_LIST,
    CMD_GET_RECORDING_FILE,
    CMD_GET_SETTINGS,
    CMD_SET_DEVICE_TIME,
    CMD_SET_SETTINGS,
    CMD_TRANSFER_FILE,
    DEFAULT_PRODUCT_ID,
    DEFAULT_VENDOR_ID,
    EP_IN_ADDR,
    EP_OUT_ADDR,
)


class HiDockJensen:
    """
    Manages communication with HiDock devices using the Jensen protocol.

    This class handles device discovery, connection, disconnection,
    and sending/receiving commands for various operations like fetching
    device info, listing files, transferring files, and managing settings.
    It uses PyUSB for low-level USB communication.
    """

    def __init__(self, usb_backend_instance_ref):
        """
        Initializes the HiDockJensen communication class.

        Args:
            usb_backend_instance_ref: A reference to an initialized PyUSB backend instance.
                                      This backend will be used for all USB operations.
                                      If None, operations requiring a backend will fail.
        """

        self.usb_backend = usb_backend_instance_ref
        self.device = None
        self.ep_out = None
        self.ep_in = None
        self.sequence_id = 0
        self.receive_buffer = bytearray()
        self.device_info = {}
        self.model = "unknown"
        self.claimed_interface_number = -1
        self.detached_kernel_driver_on_interface = -1
        self.is_connected_flag = False
        self.device_behavior_settings = {
            "autoRecord": None,
            "autoPlay": None,
            "bluetoothTone": None,
            "notificationSound": None,
        }
        self._usb_lock = threading.RLock()  # Changed to RLock

        # Enhanced connection management
        self._connection_retry_count = 0
        self._max_retry_attempts = 3
        self._retry_delay = 1.0  # seconds
        self._last_error = None
        self._connection_health_check_interval = 30.0  # seconds
        self._is_in_health_check = False
        self._last_health_check = 0

        # Enhanced error tracking
        self._error_counts = {
            "usb_timeout": 0,
            "usb_pipe_error": 0,
            "connection_lost": 0,
            "protocol_error": 0,
        }
        self._max_error_threshold = 5

        # Performance monitoring
        self._operation_stats = {
            "commands_sent": 0,
            "responses_received": 0,
            "bytes_transferred": 0,
            "connection_time": 0,
            "last_operation_time": 0,
        }

    def get_usb_lock(self) -> threading.RLock:
        """
        Provides access to the internal USB RLock for external synchronization.

        Returns:
            threading.RLock: The RLock instance used for synchronizing USB operations.
        """
        return self._usb_lock

    def get_connection_stats(self) -> dict:
        """
        Returns connection and performance statistics.

        Returns:
            dict: Dictionary containing connection statistics and error counts.
        """
        return {
            "is_connected": self.is_connected(),
            "model": self.model,
            "retry_count": self._connection_retry_count,
            "error_counts": self._error_counts.copy(),
            "operation_stats": self._operation_stats.copy(),
            "last_error": self._last_error,
            "device_info": self.device_info.copy(),
        }

    def reset_error_counts(self):
        """
        Resets all error counters. Useful for testing or after resolving issues.
        """
        self._error_counts = {
            "usb_timeout": 0,
            "usb_pipe_error": 0,
            "connection_lost": 0,
            "protocol_error": 0,
        }
        logger.info("Jensen", "reset_error_counts", "Error counters reset")

    def _increment_error_count(self, error_type: str):
        """
        Increments the error count for a specific error type.

        Args:
            error_type (str): The type of error to increment.
        """
        if error_type in self._error_counts:
            self._error_counts[error_type] += 1
            logger.debug(
                "Jensen",
                "_increment_error_count",
                f"Error count for {error_type}: {self._error_counts[error_type]}",
            )

    def _should_retry_connection(self) -> bool:
        """
        Determines if connection should be retried based on current state.

        Returns:
            bool: True if connection should be retried, False otherwise.
        """
        return (
            self._connection_retry_count < self._max_retry_attempts
            and self._error_counts["connection_lost"] < self._max_error_threshold
        )

    def _perform_health_check(self) -> bool:
        """
        Performs a health check on the current connection.

        Returns:
            bool: True if connection is healthy, False otherwise.
        """
        if self._is_in_health_check:
            return True  # Avoid recursion if already checking

        current_time = time.time()
        if (
            current_time - self._last_health_check
        ) < self._connection_health_check_interval:
            return True  # Skip check if too recent

        self._last_health_check = current_time

        if not self.is_connected():
            return False

        self._is_in_health_check = True
        try:
            try:
                # Perform a lightweight operation to test connection
                device_info = self.get_device_info(timeout_s=2)
                if device_info:
                    logger.debug(
                        "Jensen", "_perform_health_check", "Health check passed"
                    )
                    return True
                else:
                    logger.warning(
                        "Jensen",
                        "_perform_health_check",
                        "Health check failed - no device info",
                    )
                    return False
            except Exception as e:
                logger.warning(
                    "Jensen", "_perform_health_check", f"Health check failed: {e}"
                )
                self._increment_error_count("connection_lost")
                return False
        finally:
            self._is_in_health_check = False

    def is_connected(self) -> bool:
        """
        Checks if the HiDock device is currently connected and endpoints are configured.

        Returns:
            bool: True if the device is considered connected, False otherwise.
        """
        return (
            self.device is not None
            and self.ep_in is not None
            and self.ep_out is not None
            and self.is_connected_flag
        )

    def _find_device(self, vid_to_find: int, pid_to_find: int):
        """
        Finds a USB device with the specified Vendor ID and Product ID.

        Args:
            vid_to_find (int): The Vendor ID of the device to find.
            pid_to_find (int): The Product ID of the device to find.

        Returns:
            usb.core.Device: The found PyUSB device object.

        Raises:
            ConnectionError: If the USB backend is not available.
            ValueError: If the device with the specified VID/PID is not found.
        """
        if not self.usb_backend:
            logger.error(
                "Jensen",
                "_find_device",
                "USB backend is not available to HiDockJensen.",
            )
            raise ConnectionError("USB backend not available to HiDockJensen class.")
        logger.debug(
            "Jensen",
            "_find_device",
            f"Looking for VID={hex(vid_to_find)}, PID={hex(pid_to_find)}",
        )
        device = usb.core.find(
            idVendor=vid_to_find, idProduct=pid_to_find, backend=self.usb_backend
        )
        if device is None:
            logger.info(  # Changed from error to info, as this is an expected scenario
                "Jensen",
                "_find_device",
                f"HiDock device (VID={hex(vid_to_find)}, PID={hex(pid_to_find)}) not found.",
            )
            return None  # Return None instead of raising ValueError

        # Attempt to get product/manufacturer strings, but handle potential errors
        product_name = "Unknown Product"
        manufacturer_name = "Unknown Manufacturer"
        try:
            # These can raise ValueError if langid is not found (e.g., device busy)
            product_name = device.product or product_name
            manufacturer_name = device.manufacturer or manufacturer_name
            logger.debug(
                "Jensen",
                "_find_device",
                f"Device found: {product_name} (by {manufacturer_name})",
            )
        except ValueError as e_val:  # Specifically catch ValueError for langid issues
            if "no langid" in str(e_val).lower():
                logger.warning(
                    "Jensen",
                    "_find_device",
                    f"Device VID={hex(vid_to_find)}, PID={hex(pid_to_find)} found, "
                    f"but could not read string descriptors (product/manufacturer) - "
                    f"likely in use or permission issue: {e_val}",
                )
            else:  # pragma: no cover
                logger.error(
                    "Jensen",
                    "_find_device",
                    f"Unexpected ValueError while reading string descriptors "
                    f"for VID={hex(vid_to_find)}, PID={hex(pid_to_find)}: {e_val}",
                )
        except (
            usb.core.USBError
        ) as e_usb:  # Catch other USB errors during descriptor access
            logger.warning(
                "Jensen",
                "_find_device",
                f"Device VID={hex(vid_to_find)}, PID={hex(pid_to_find)} found, "
                f"but USBError occurred while reading string descriptors: {e_usb}",
            )
        # Even if descriptor reading fails, the device object itself is valid for further connection attempts.
        return device

    def connect(
        self,
        target_interface_number: int = 0,
        vid: int = DEFAULT_VENDOR_ID,
        pid: int = DEFAULT_PRODUCT_ID,
        auto_retry: bool = True,
    ) -> tuple[bool, str | None]:
        """
        Connects to the HiDock device with automatic retry mechanisms.

        This method attempts to find the device, set its configuration,
        claim the specified interface, and find the required IN and OUT endpoints.
        It also handles detaching kernel drivers if necessary (on non-Windows systems).

        Args:
            target_interface_number (int, optional): The interface number to claim. Defaults to 0.
            vid (int, optional): The Vendor ID of the device. Defaults to DEFAULT_VENDOR_ID.
            pid (int, optional): The Product ID of the device. Defaults to DEFAULT_PRODUCT_ID.
            auto_retry (bool, optional): Whether to automatically retry on failure. Defaults to True.

        Returns:
            tuple[bool, str | None]: (True, None) if successful,
                                     (False, "error message") otherwise.
        """
        with self._usb_lock:  # Ensure connect/disconnect are serialized
            if self.is_connected():
                logger.info(
                    "Jensen",
                    "connect",
                    "Device already connected. Disconnecting before reconnecting.",
                )
                self.disconnect()

            self.is_connected_flag = False
            self.detached_kernel_driver_on_interface = -1
            self.claimed_interface_number = -1

            # Reset retry count for new connection attempt
            if auto_retry:
                self._connection_retry_count = 0

            # Attempt connection with retry logic
            while True:
                success, error_msg = self._attempt_connection(
                    target_interface_number, vid, pid
                )

                if success:
                    self._connection_retry_count = 0
                    self._operation_stats["connection_time"] = time.time()
                    logger.info(
                        "Jensen", "connect", f"Successfully connected to {self.model}"
                    )
                    return True, None

                self._last_error = error_msg
                self._connection_retry_count += 1

                if not auto_retry or not self._should_retry_connection():
                    logger.error(
                        "Jensen",
                        "connect",
                        f"Connection failed after {self._connection_retry_count} attempts: {error_msg}",
                    )
                    return False, error_msg

                logger.warning(
                    "Jensen",
                    "connect",
                    f"Connection attempt {self._connection_retry_count} failed: {error_msg}. Retrying in {self._retry_delay}s...",
                )
                time.sleep(self._retry_delay)

    def _attempt_connection(
        self, target_interface_number: int, vid: int, pid: int
    ) -> tuple[bool, str | None]:
        """
        Attempts a single connection to the device.

        Args:
            target_interface_number (int): The interface number to claim.
            vid (int): The Vendor ID of the device.
            pid (int): The Product ID of the device.

        Returns:
            tuple[bool, str | None]: (True, None) if successful, (False, error_message) otherwise.
        """

        try:
            self.device = self._find_device(vid, pid)
            if self.device is None:
                # _find_device now returns None if not found, and logs it.
                error_msg = f"Device VID={hex(vid)}, PID={hex(pid)} not found."
                logger.warning(
                    "Jensen", "_attempt_connection", f"Failed to connect: {error_msg}"
                )
                # No need to call self.disconnect() here as nothing was partially connected.
                return False, error_msg

            # Detach kernel driver if active (typically for non-Windows OS)
            if (
                sys.platform != "win32"
            ):  # Kernel driver interaction is usually problematic/unnecessary on Windows
                if self.device.is_kernel_driver_active(target_interface_number):
                    logger.info(
                        "Jensen",
                        "_attempt_connection",
                        f"Kernel driver is active on Interface {target_interface_number}. Attempting to detach.",
                    )
                    self.device.detach_kernel_driver(target_interface_number)
                    logger.info(
                        "Jensen",
                        "_attempt_connection",
                        f"Detached kernel driver from Interface {target_interface_number}.",
                    )
                    self.detached_kernel_driver_on_interface = target_interface_number

            try:
                self.device.set_configuration()
                logger.info(
                    "Jensen", "_attempt_connection", "Device configuration set."
                )
            except usb.core.USBError as e_cfg:
                # If errno is 16 (Resource busy) or 13 (Access denied),
                # it implies the device is likely configured and used by another process.
                if e_cfg.errno == 16:  # Resource busy
                    logger.error(  # Changed from info "proceeding" to error
                        "Jensen",
                        "_attempt_connection",
                        "Failed to set configuration (errno 16 - Resource busy). "
                        "Device likely in use by another application.",
                    )
                    self._increment_error_count("connection_lost")
                    raise  # Re-raise to be caught by the main exception handler
                elif e_cfg.errno == 13:  # Access denied
                    logger.error(
                        "Jensen",
                        "_attempt_connection",
                        "Failed to set configuration (errno 13 - Access denied). "
                        "Insufficient permissions or device in use.",
                    )
                    self._increment_error_count("connection_lost")
                    raise  # Re-raise to be caught by the main exception handler
                else:  # pragma: no cover
                    # For other USB errors during set_configuration
                    logger.error(
                        "Jensen",
                        "_attempt_connection",
                        f"Unexpected USBError during set_configuration: {e_cfg}",
                    )
                    self._increment_error_count("protocol_error")
                    raise  # Re-raise other configuration errors

            cfg = self.device.get_active_configuration()
            intf = usb.util.find_descriptor(
                cfg, bInterfaceNumber=target_interface_number
            )
            if intf is None:
                raise usb.core.USBError(
                    f"Interface {target_interface_number} not found in active configuration."
                )
            logger.info(
                "Jensen",
                "_attempt_connection",
                f"Found Interface {intf.bInterfaceNumber}, Alternate Setting {intf.bAlternateSetting}",
            )

            try:
                usb.util.claim_interface(self.device, intf.bInterfaceNumber)
                self.claimed_interface_number = intf.bInterfaceNumber
                logger.info(
                    "Jensen",
                    "_attempt_connection",
                    f"Claimed Interface {self.claimed_interface_number}",
                )
            except usb.core.USBError as e_claim:
                if e_claim.errno == 16:  # Resource busy (LIBUSB_ERROR_BUSY)
                    logger.error(  # Log as error for this instance
                        "Jensen",
                        "_attempt_connection",
                        f"Failed to claim interface {intf.bInterfaceNumber} (errno 16 - Resource busy). "
                        f"Device likely in use by another application.",
                    )
                    self._increment_error_count("connection_lost")
                    # Re-raise the error to be caught by the main exception handler in connect(),
                    # which will then call self.disconnect() and return False.
                    raise
                else:  # pragma: no cover
                    self._increment_error_count("protocol_error")
                    raise  # Re-raise other claim errors

            self.ep_out = usb.util.find_descriptor(
                intf,
                custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress)
                == usb.util.ENDPOINT_OUT
                and (e.bEndpointAddress & 0x0F) == (EP_OUT_ADDR & 0x0F),
            )
            self.ep_in = usb.util.find_descriptor(
                intf,
                custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress)
                == usb.util.ENDPOINT_IN
                and (e.bEndpointAddress & 0x0F) == (EP_IN_ADDR & 0x7F),
            )

            if self.ep_out is None or self.ep_in is None:
                # Break long f-string for readability
                raise usb.core.USBError(
                    f"Could not find required IN/OUT endpoints "
                    f"({hex(EP_OUT_ADDR)}/{hex(EP_IN_ADDR)}) "
                    f"on Interface {target_interface_number}."
                )

            logger.info(
                "Jensen",
                "_attempt_connection",
                f"Using Interface {target_interface_number}. "
                f"EP_OUT: {hex(self.ep_out.bEndpointAddress)}, "
                f"EP_IN: {hex(self.ep_in.bEndpointAddress)}",
            )

            # Model detection is handled at the higher level by device_interface.py
            # This low-level module focuses only on USB communication
            self.model = f"HiDock Device (PID: {hex(self.device.idProduct)})"
            logger.info(
                "Jensen",
                "_attempt_connection",
                f"Connected to device with PID: {hex(self.device.idProduct)}",
            )

            self.is_connected_flag = True
            return True, None
        except (
            ValueError,
            usb.core.USBError,
            ConnectionError,
        ) as e:  # More specific exceptions
            specific_error_message = ""
            if isinstance(e, usb.core.USBError):
                if e.errno == 13:  # Access Denied
                    specific_error_message = (
                        "Access denied to device. It might be in use "
                        "by another app or require admin rights."
                    )
                elif e.errno == 16:  # Resource Busy
                    specific_error_message = (
                        "Device is busy, likely used by another app."
                    )
                else:  # General USBError
                    specific_error_message = f"USB Error: {e}"
            elif isinstance(e, ConnectionError):
                specific_error_message = f"Connection Error: {e}"
            else:  # General ValueError or other ConnectionError subtypes
                specific_error_message = f"{type(e).__name__}: {e}"

            # Log the original exception with traceback for detailed debugging
            logger.error(
                "Jensen",
                "_attempt_connection",
                f"Connection failed: {e}\n{traceback.format_exc()}",
            )
            # Log the user-friendly message that will be returned
            logger.info(
                "Jensen",
                "_attempt_connection",
                f"Returning failure with message: {specific_error_message}",
            )
            self.disconnect()  # Ensure cleanup on failed connection
            return False, specific_error_message
        except (
            OSError,
            RuntimeError,
        ) as e:  # Fallback for other known OS/Runtime errors
            error_msg = f"Unexpected system error during connection: {e}"
            logger.error(
                "Jensen",
                "_attempt_connection",
                f"{error_msg}\n{traceback.format_exc()}",
            )
            self.disconnect()
            return False, error_msg

    def disconnect(self):
        """
        Disconnects from the HiDock device.

        Releases the claimed interface, re-attaches kernel drivers if they were
        detached, disposes of USB resources, and resets the connection state
        of this class instance.
        """
        with self._usb_lock:
            if not self.is_connected_flag and not self.device:
                logger.info(
                    "Jensen", "disconnect", "Already disconnected or no device object."
                )
                self._reset_connection_state()  # Ensure state is clean
                return

            logger.info("Jensen", "disconnect", "Disconnecting from device...")
            if self.device:
                try:
                    if self.claimed_interface_number != -1:
                        usb.util.release_interface(
                            self.device, self.claimed_interface_number
                        )
                        logger.info(
                            "Jensen",
                            "disconnect",
                            f"Released Interface {self.claimed_interface_number}.",
                        )

                    if (
                        self.detached_kernel_driver_on_interface != -1
                        and sys.platform != "win32"
                    ):
                        try:
                            self.device.attach_kernel_driver(
                                self.detached_kernel_driver_on_interface
                            )
                            logger.info(
                                "Jensen",
                                "disconnect",
                                f"Re-attached kernel driver to Interface {self.detached_kernel_driver_on_interface}.",
                            )
                        except (
                            usb.core.USBError,
                            NotImplementedError,  # More specific
                        ) as e_attach:  # Catch more specific errors if known, e.g. USBError
                            logger.info(
                                "Jensen",
                                "disconnect",
                                f"Could not re-attach kernel driver: {e_attach} (often ignorable).",
                            )
                except usb.core.USBError as e:  # Catch USB errors during release/attach
                    logger.warning(
                        "Jensen",
                        "disconnect",
                        f"Error during interface release/reattach: {e}",
                    )
                finally:  # Ensure dispose_resources is called even if release/attach fails
                    usb.util.dispose_resources(self.device)
                    logger.debug(
                        "Jensen", "disconnect", "USB resources disposed."
                    )  # Changed to debug as it's a detail

            self._reset_connection_state()
            logger.info("Jensen", "disconnect", "Disconnected successfully.")

    def _reset_connection_state(self):
        """
        Resets all internal attributes related to the USB connection and device state.
        Called during disconnection or when a connection attempt fails partway.
        """
        self.device = None
        self.ep_out = None
        self.ep_in = None
        self.claimed_interface_number = -1
        self.detached_kernel_driver_on_interface = -1
        self.is_connected_flag = False
        self.receive_buffer.clear()
        self.device_info = {}
        self.model = "unknown"
        self.device_behavior_settings = {
            "autoRecord": None,
            "autoPlay": None,
            "bluetoothTone": None,
            "notificationSound": None,
        }

    def _build_packet(self, command_id, body_bytes=b""):
        """
        Constructs a command packet according to the HiDock Jensen protocol.

        The packet structure includes a sync marker, command ID, sequence ID,
        body length, and the command body itself.

        Args:
            command_id (int): The ID of the command to send.
            body_bytes (bytes, optional): The payload of the command. Defaults to b"".

        Returns:
            bytes: The fully constructed command packet.
        """
        self.sequence_id = (
            self.sequence_id + 1
        ) & 0xFFFFFFFF  # Ensure sequence ID wraps around if it gets too large
        header = bytearray([0x12, 0x34])  # Sync bytes
        header.extend(struct.pack(">H", command_id))  # Command ID (2 bytes)
        # Sequence ID (4 bytes)
        header.extend(struct.pack(">I", self.sequence_id))
        # Body length (4 bytes)
        header.extend(struct.pack(">I", len(body_bytes)))
        return bytes(header) + body_bytes

    def _send_command(self, command_id, body_bytes=b"", timeout_ms=5000):
        """
        Sends a command packet to the device's OUT endpoint with enhanced error handling.

        Args:
            command_id (int): The ID of the command.
            body_bytes (bytes, optional): The command payload. Defaults to b"".
            timeout_ms (int, optional): Timeout for the USB write operation in milliseconds.
                                        Defaults to 5000.

        Returns:
            int: The sequence ID of the sent command.

        Raises:
            ConnectionError: If the device is not connected.
            usb.core.USBError: If a USB write error occurs (after attempting to clear halt).
        """
        if not self.is_connected():  # Check before attempting to use endpoints
            logger.error(
                "Jensen", "_send_command", "Not connected. Cannot send command."
            )
            raise ConnectionError("Device not connected.")

        # Perform health check if needed
        if not self._perform_health_check():
            logger.warning(
                "Jensen",
                "_send_command",
                "Health check failed, attempting reconnection",
            )
            raise ConnectionError("Device health check failed")

        packet = self._build_packet(command_id, body_bytes)
        logger.debug(
            "Jensen",
            "_send_command",
            f"SEND CMD: {command_id}, Seq: {self.sequence_id}, Len: {len(body_bytes)}, Data: {packet.hex()[:64]}...",
        )

        start_time = time.time()
        try:
            bytes_sent = self.ep_out.write(packet, timeout=int(timeout_ms))

            # Update performance statistics
            self._operation_stats["commands_sent"] += 1
            self._operation_stats["bytes_transferred"] += len(packet)
            self._operation_stats["last_operation_time"] = time.time() - start_time

            if bytes_sent != len(packet):
                logger.warning(
                    "Jensen",
                    "_send_command",
                    f"Partial write for CMD {command_id}: sent {bytes_sent}/{len(packet)} bytes.",
                )
                self._increment_error_count("protocol_error")
                # Depending on protocol, a partial write might be a critical error.

        except usb.core.USBTimeoutError as e:
            self._increment_error_count("usb_timeout")
            logger.error(
                "Jensen",
                "_send_command",
                f"USB timeout error for CMD {command_id}: {e}",
            )
            raise
        except usb.core.USBError as e:
            logger.error(
                "Jensen", "_send_command", f"USB write error for CMD {command_id}: {e}"
            )
            if e.errno == 32:  # LIBUSB_ERROR_PIPE (stall)
                self._increment_error_count("usb_pipe_error")
                try:
                    self.device.clear_halt(self.ep_out.bEndpointAddress)
                    logger.info(
                        "Jensen",
                        "_send_command",
                        "Cleared halt on EP_OUT after pipe error.",
                    )
                except usb.core.USBError as ce:  # More specific
                    logger.error(
                        "Jensen",
                        "_send_command",
                        f"Failed to clear halt on EP_OUT: {ce}",
                    )
            else:
                self._increment_error_count("protocol_error")

            # A write error often means the connection is compromised.
            self.disconnect()  # Attempt to clean up and mark as disconnected.
            raise  # Re-raise to be caught by caller
        return self.sequence_id

    def _receive_response(
        self, expected_seq_id, timeout_ms=5000, streaming_cmd_id=None
    ):
        """
        Receives and parses a response packet from the device's IN endpoint.

        This method handles reading data chunks, re-syncing if necessary,
        and parsing the packet header to extract the command ID, sequence ID,
        and body. It waits for a response matching the `expected_seq_id` or,
        if `streaming_cmd_id` is provided, accepts packets matching that command ID.

        Args:
            expected_seq_id (int): The sequence ID of the command for which a response is expected.
            timeout_ms (int, optional): Overall timeout for receiving a complete and valid response
                                        in milliseconds. Defaults to 5000.
            streaming_cmd_id (int, optional): If provided, packets with this command ID will also be
                                              considered valid responses, typically used for data
                                              packets during file streaming. Defaults to None.

        Returns:
            dict or None: A dictionary containing {"id", "sequence", "body"} of the response if successful,
                          None if a timeout occurs or a critical USB error happens.
        """
        if not self.is_connected():  # Check before attempting to use endpoints
            logger.error(
                "Jensen", "_receive_response", "Not connected. Cannot receive response."
            )
            raise ConnectionError("Device not connected.")

        start_time = time.time()
        overall_timeout_sec = timeout_ms / 1000.0

        while time.time() - start_time < overall_timeout_sec:
            # --- BEGIN MODIFICATION ---
            # Invert the logic: First, try to parse the existing buffer.
            # Only read from the device if the buffer doesn't contain a full packet.
            # This prioritizes processing and prevents the buffer from growing uncontrollably.

            # Attempt to parse messages from buffer
            while True:  # Loop to parse multiple messages if they are buffered
                if len(self.receive_buffer) < 2:
                    break  # Not enough for sync marker

                # Re-sync if necessary
                if not (
                    self.receive_buffer[0] == 0x12 and self.receive_buffer[1] == 0x34
                ):
                    # During streaming, we expect a continuous flow of valid packets.
                    # A missing sync marker at the start of the buffer is a fatal protocol error.
                    if streaming_cmd_id is not None:
                        logger.error(
                            "Jensen",
                            "_receive_response",
                            f"Protocol desync during stream (CMD {streaming_cmd_id}). "
                            f"Buffer should start with sync marker but doesn't. "
                            f"Prefix: {self.receive_buffer[:64].hex()}",
                        )
                        self._increment_error_count("protocol_error")
                        self.receive_buffer.clear()  # Clear bad data
                        # Exit parsing loop, will lead to timeout in stream_file
                        return None # Make it fail fast

                    # For non-streaming commands, attempt to find the next sync marker.
                    sync_offset = self.receive_buffer.find(b"\x12\x34")
                    if sync_offset != -1:
                        if sync_offset > 0:
                            logger.warning(
                                "Jensen",
                                "_receive_response",
                                f"Re-syncing: Discarded {sync_offset} "
                                f"prefix bytes: {self.receive_buffer[:sync_offset].hex()}",
                            )
                        self.receive_buffer = self.receive_buffer[sync_offset:]
                    else:
                        # No sync marker found at all, discard the whole buffer
                        # as it's unrecoverable garbage.
                        logger.warning(
                            "Jensen",
                            "_receive_response",
                            f"No sync marker found in buffer. Discarding {len(self.receive_buffer)} bytes.",
                        )
                        self.receive_buffer.clear()
                        break

                if len(self.receive_buffer) < 12:
                    break  # Not enough for full header

                header_prefix = self.receive_buffer[:12]
                response_cmd_id, response_seq_id, body_len_from_header = struct.unpack(
                    ">HII", header_prefix[2:]
                )

                checksum_len = (
                    body_len_from_header >> 24
                ) & 0xFF  # Not used by this device typically, but part of spec
                body_len = body_len_from_header & 0x00FFFFFF
                total_msg_len = 12 + body_len + checksum_len

                if len(self.receive_buffer) >= total_msg_len:
                    msg_bytes_full = self.receive_buffer[:total_msg_len]
                    self.receive_buffer = self.receive_buffer[
                        total_msg_len:
                    ]  # Consume the message from buffer

                    # Check if this is the response we're waiting for OR a streaming packet
                    if response_seq_id == expected_seq_id or (
                        streaming_cmd_id is not None
                        and response_cmd_id == streaming_cmd_id
                    ):
                        logger.debug(
                            "Jensen",
                            "_receive_response",
                            f"RECV RSP CMD: {response_cmd_id}, "
                            f"Seq: {response_seq_id}, "
                            f"BodyLen: {body_len}, "
                            f"Body: {msg_bytes_full[12:12+body_len].hex()[:64]}...",
                        )

                        # Update performance statistics
                        self._operation_stats["responses_received"] += 1
                        self._operation_stats["bytes_transferred"] += len(
                            msg_bytes_full
                        )

                        return {
                            "id": response_cmd_id,
                            "sequence": response_seq_id,
                            "body": msg_bytes_full[12 : 12 + body_len],
                        }
                    else:
                        logger.warning(
                            "Jensen",
                            "_receive_response",
                            f"Unexpected Seq/CMD. Expected Seq: {expected_seq_id} "
                            f"(or stream {streaming_cmd_id}), "
                            f"Got CMD: {response_cmd_id} "
                            f"Seq: {response_seq_id}. Discarding.",
                        )
                else:  # Not enough data for this full message yet
                    break
            
            # If we've reached here, it means the buffer didn't contain a full packet.
            # Now, we can safely read more data from the device.
            try:
                # Read a larger chunk to reduce number of USB transactions, if wMaxPacketSize is known
                read_size = (
                    self.ep_in.wMaxPacketSize * 64
                    if self.ep_in.wMaxPacketSize
                    else 4096
                )  # Increased read size
                data_chunk = self.device.read(
                    self.ep_in.bEndpointAddress, read_size, timeout=200
                )  # Slightly longer individual timeout
                if data_chunk:
                    self.receive_buffer.extend(data_chunk)
                    logger.debug(
                        "Jensen",
                        "_receive_response",
                        f"Rcvd chunk len: {len(data_chunk)}. "
                        f"Buf len: {len(self.receive_buffer)}. "
                        f"Data: {bytes(data_chunk).hex()[:32]}...",
                    )
            except usb.core.USBTimeoutError:
                # If we are in a streaming context, a timeout is not necessarily an error,
                # but rather a signal that the device has no data to send at this moment.
                # The calling function (e.g., list_files) is responsible for handling
                # consecutive timeouts as an end-of-stream signal.
                if streaming_cmd_id is None:
                    self._increment_error_count("usb_timeout")
                pass  # This is an expected condition, especially during streaming.
            except usb.core.USBError as e:
                logger.error("Jensen", "_receive_response", f"USB read error: {e}")
                if e.errno == 32:  # LIBUSB_ERROR_PIPE
                    self._increment_error_count("usb_pipe_error")
                    try:
                        self.device.clear_halt(self.ep_in.bEndpointAddress)
                        logger.info(
                            "Jensen",
                            "_receive_response",
                            "Cleared halt on EP_IN after pipe error.",
                        )
                    except usb.core.USBError as ce:  # More specific
                        logger.error(
                            "Jensen",
                            "_receive_response",
                            f"Failed to clear halt on EP_IN: {ce}",
                        )
                else:
                    self._increment_error_count("protocol_error")

                self._increment_error_count("connection_lost")
                self.disconnect()  # Assume connection is lost
                return None
            # --- END MODIFICATION ---

        # Use DEBUG level for streaming timeouts as they are expected behavior during multi-chunk transfers
        if streaming_cmd_id is not None:
            logger.debug(
                "Jensen",
                "_receive_response",
                f"Expected streaming timeout for SeqID {expected_seq_id} (CMD {streaming_cmd_id}) - device pausing between chunks",
            )
        else:
            logger.warning(
                "Jensen",
                "_receive_response",
                f"Timeout waiting for response to SeqID {expected_seq_id}. "
                f"Buffer content (first 128 bytes): {self.receive_buffer.hex()[:128]}",
            )
        return None

    def _send_and_receive(self, command_id, body_bytes=b"", timeout_ms=5000):
        """
        Sends a command and waits for its corresponding response.

        This is a convenience method that combines `_send_command` and `_receive_response`.
        It ensures these operations are performed atomically with respect to other commands
        by using a USB lock.

        Args:
            command_id (int): The ID of the command to send.
            body_bytes (bytes, optional): The payload of the command. Defaults to b"".
            timeout_ms (int, optional): Timeout for the entire send-and-receive operation
                                        in milliseconds. Defaults to 5000.

        Returns:
            dict or None: The response dictionary from `_receive_response`, or None on failure.

        Raises:
            usb.core.USBError or ConnectionError: If errors occur during send or receive.
        """
        with self._usb_lock:  # Ensure send and receive are atomic relative to other commands
            try:
                # Clear buffer only for non-streaming commands to avoid losing data from a previous stream
                if command_id != CMD_TRANSFER_FILE:
                    self.receive_buffer.clear()

                seq_id = self._send_command(command_id, body_bytes, timeout_ms)
                # For streaming commands, pass the streaming_cmd_id to _receive_response
                # so it knows to accept packets with that command ID even if sequence ID doesn't match the initial one.
                return self._receive_response(
                    seq_id,
                    int(timeout_ms),
                    streaming_cmd_id=(
                        CMD_TRANSFER_FILE if command_id == CMD_TRANSFER_FILE else None
                    ),
                )
            except (
                usb.core.USBError,
                ConnectionError,
            ) as e:  # Catch errors from send or receive
                logger.error(
                    "Jensen", "_send_and_receive", f"Error during CMD {command_id}: {e}"
                )
                # self.disconnect() was already called in _send_command or _receive_response if critical
                raise  # Re-raise to be handled by the calling method in GUI

    # --- Device Command Methods (Identical to original script, using the logger instance) ---
    def get_device_info(self, timeout_s=5):
        """
        Retrieves device information (firmware version, serial number).

        Args:
            timeout_s (int, optional): Timeout in seconds for the operation. Defaults to 5.

        Returns:
            dict or None: A dictionary containing "versionCode", "versionNumber", and "sn"
                          if successful, None otherwise.
        """
        response = self._send_and_receive(
            CMD_GET_DEVICE_INFO, timeout_ms=int(timeout_s * 1000)
        )
        if response and response["id"] == CMD_GET_DEVICE_INFO:
            body = response["body"]
            if len(body) >= 4:
                version_code_bytes = body[0:4]
                version_number_raw = struct.unpack(">I", version_code_bytes)[0]
                version_code_str = ".".join(map(str, version_code_bytes[1:]))
                serial_number_str = "N/A"
                if len(body) > 4:
                    serial_number_bytes = body[4:20]
                    try:
                        printable_sn_bytes = bytearray(
                            b for b in serial_number_bytes if 32 <= b <= 126 or b == 0
                        )
                        null_idx = printable_sn_bytes.find(0)
                        if null_idx != -1:
                            printable_sn_bytes = printable_sn_bytes[:null_idx]
                        serial_number_str = printable_sn_bytes.decode(
                            "ascii", errors="ignore"
                        ).strip()
                        if not serial_number_str:
                            serial_number_str = serial_number_bytes.hex()
                    except UnicodeDecodeError:
                        serial_number_str = serial_number_bytes.hex()
                self.device_info = {
                    "versionCode": version_code_str,
                    "versionNumber": version_number_raw,
                    "sn": serial_number_str,
                }
                logger.info(
                    "Jensen",
                    "get_device_info",
                    f"Parsed Device Info: {self.device_info}",
                )
                return self.device_info
            else:
                logger.error(
                    "Jensen",
                    "get_device_info",
                    "Response body too short for version information.",
                )
        else:
            logger.error(
                "Jensen",
                "get_device_info",
                "Failed to get device info or invalid response.",
            )
        return None

    def get_file_count(self, timeout_s=5):
        """
        Retrieves the total number of files stored on the device.

        Args:
            timeout_s (int, optional): Timeout in seconds for the operation. Defaults to 5.

        Returns:
            dict or None: A dictionary like {"count": number_of_files} if successful,
                          None otherwise.
        """
        # Avoid command conflicts during file list streaming
        if self.is_file_list_streaming():
            logger.debug("Jensen", "get_file_count", "Skipping during file list streaming")
            return None
            
        response = self._send_and_receive(
            CMD_GET_FILE_COUNT, timeout_ms=int(timeout_s * 1000)
        )
        if response and response["id"] == CMD_GET_FILE_COUNT:
            body = response["body"]
            if not body:
                return {"count": 0}
            if len(body) >= 4:
                count = struct.unpack(">I", body[:4])[0]
                logger.info("Jensen", "get_file_count", f"File count: {count}")
                return {"count": count}
        logger.error(
            "Jensen", "get_file_count", "Failed to get file count or invalid response."
        )
        return None

    def _calculate_file_duration(self, file_size_bytes, file_version):
        """
        Calculate the correct duration for a file based on its size and version.

        This consolidates the duration calculation logic and applies the correct
        bitrate for each file version. The actual audio bitrate is ~64kbps, not
        the 256kbps that was previously assumed.

        Args:
            file_size_bytes (int): Size of the file in bytes
            file_version (int): File format version from device

        Returns:
            float: Duration in seconds
        """
        # Audio format constants based on device specifications
        ACTUAL_BITRATE_BPS = 64000  # 64kbps - actual encoding bitrate
        SAMPLE_RATE_48K = 48000
        SAMPLE_RATE_24K = 24000
        SAMPLE_RATE_16K = 16000
        SAMPLE_RATE_12K = 12000
        CHANNELS = 2  # Stereo
        BYTES_PER_SAMPLE = 1  # 8-bit samples
        WAV_HEADER_SIZE = 44  # Standard WAV header size

        if file_version == 1:
            # Version 1: Custom format calculation
            return (file_size_bytes / 32) * 2 * 4  # Apply the 4x correction directly
        elif file_version == 2:
            # Version 2: 48kHz WAV format
            if file_size_bytes > WAV_HEADER_SIZE:
                raw_duration = (file_size_bytes - WAV_HEADER_SIZE) / (
                    SAMPLE_RATE_48K * CHANNELS * BYTES_PER_SAMPLE
                )
                return raw_duration * 4  # Apply the 4x correction directly
            return 0
        elif file_version == 3:
            # Version 3: 24kHz WAV format
            if file_size_bytes > WAV_HEADER_SIZE:
                raw_duration = (file_size_bytes - WAV_HEADER_SIZE) / (
                    SAMPLE_RATE_24K * CHANNELS * BYTES_PER_SAMPLE
                )
                return raw_duration * 4  # Apply the 4x correction directly
            return 0
        elif file_version == 5:
            # Version 5: 12kHz format
            raw_duration = file_size_bytes / SAMPLE_RATE_12K
            return raw_duration * 4  # Apply the 4x correction directly
        else:
            # Default: 16kHz format
            raw_duration = file_size_bytes / (
                SAMPLE_RATE_16K * CHANNELS * BYTES_PER_SAMPLE
            )
            return raw_duration * 4  # Apply the 4x correction directly

    def list_files(self, timeout_s=20):
        """
        Retrieves a list of files from the device, including metadata.

        Parses the raw file list data from the device, extracting details like
        filename, creation date/time, duration, size, and version.
        It handles different device firmware versions that might affect how
        file counts are determined.

        Args:
            timeout_s (int, optional): Timeout in seconds for the operation. Defaults to 20.

        Returns:
            dict or None: A dictionary containing
                {"files": list_of_file_details, "totalFiles": count, "totalSize": bytes}
                          if successful, or a dict with an "error" key otherwise.
        """
        if not self.device_info.get("versionNumber"):
            if not self.get_device_info():
                logger.error(
                    "Jensen",
                    "list_files",
                    "Failed to get device info for version check. Cannot list files.",
                )
                return None

        # This operation needs to be atomic to prevent other commands from interfering
        # with the multi-packet response of the file list.
        # Critical: Set a flag to prevent other operations during streaming
        was_streaming = getattr(self, '_file_list_streaming', False)
        if was_streaming:
            logger.warning("Jensen", "list_files", "File list operation already in progress, skipping")
            return {"files": [], "totalFiles": 0, "totalSize": 0, "error": "Operation already in progress"}
            
        self._file_list_streaming = True
        try:
            with self._usb_lock:
                try:
                    self.receive_buffer.clear()
                    seq_id = self._send_command(
                        CMD_GET_FILE_LIST, timeout_ms=int(timeout_s * 1000)
                    )
                except (usb.core.USBError, ConnectionError) as e:
                    logger.error(
                        "Jensen", "list_files", f"Failed to send list_files command: {e}"
                    )
                    return {
                        "files": [],
                        "totalFiles": 0,
                        "totalSize": 0,
                        "error": "Failed to send command",
                    }

                # Web-style handler approach: accumulate data chunks and continue until completion
                file_list_chunks = []
                expected_file_count = None
                
                # Handler function mimicking the web version's Jensen.registerHandler pattern
                def file_list_handler(response_data):
                    nonlocal file_list_chunks, expected_file_count
                    
                    if not response_data or len(response_data) == 0:
                        # Empty response signals end of transmission
                        logger.info("Jensen", "list_files", "Empty response received, completing file list")
                        return self._parse_file_list_chunks(file_list_chunks) if file_list_chunks else []
                    
                    # Accumulate this chunk
                    file_list_chunks.append(response_data)
                    logger.debug("Jensen", "list_files", f"Accumulated chunk {len(file_list_chunks)}, size: {len(response_data)} bytes")
                    
                    # Parse accumulated file data to check completion
                    files = self._parse_file_list_chunks(file_list_chunks)
                    
                    # Get expected count from first chunk header if available
                    if expected_file_count is None and file_list_chunks:
                        first_chunk = file_list_chunks[0]
                        if len(first_chunk) >= 6 and first_chunk[0] == 0xFF and first_chunk[1] == 0xFF:
                            expected_file_count = struct.unpack(">I", first_chunk[2:6])[0]
                            logger.info("Jensen", "list_files", f"Expected {expected_file_count} files from header")
                    
                    # Log current progress
                    files_parsed = len(files)
                    logger.debug("Jensen", "list_files", f"Parsed {files_parsed}/{expected_file_count or '?'} files so far")
                    
                    # Check if we have all expected files
                    if expected_file_count is not None and files_parsed >= expected_file_count:
                        logger.info("Jensen", "list_files", f"Received all {expected_file_count} files, completing")
                        return files  # Complete - return final file list
                    
                    # Continue receiving more data - this is critical for multi-chunk transfers
                    logger.debug("Jensen", "list_files", f"Continue receiving: need {(expected_file_count or 0) - files_parsed} more files")
                    return None
                
                # Web-style continuous receiving until handler indicates completion
                final_files = None
                consecutive_timeouts = 0
                max_consecutive_timeouts = 5  # Increased from 3 to be more patient
                
                while final_files is None:
                    response = self._receive_response(
                        seq_id, timeout_ms=2000, streaming_cmd_id=CMD_GET_FILE_LIST  # Increased timeout
                    )
                    
                    if response and response["id"] == CMD_GET_FILE_LIST:
                        seq_id = response["sequence"]
                        consecutive_timeouts = 0
                        
                        # Process this chunk through our handler
                        result = file_list_handler(response["body"])
                        
                        if result is not None:
                            # Handler indicates completion
                            final_files = result
                            break
                            
                    elif response is None:  # Timeout
                        consecutive_timeouts += 1
                        logger.debug("Jensen", "list_files", f"Timeout {consecutive_timeouts}/{max_consecutive_timeouts}")
                        
                        # Don't give up too early - only complete if we're confident we have all data
                        if consecutive_timeouts >= max_consecutive_timeouts:
                            logger.warning("Jensen", "list_files", 
                                f"Max timeouts reached, completing with {len(file_list_chunks)} chunks")
                            # Give the handler a chance to process final data
                            final_files = file_list_handler(b'')  # Empty data signals completion
                            break
                    else:
                        # Unexpected response - log and continue
                        logger.debug("Jensen", "list_files", 
                            f"Unexpected response CMD:{response.get('id', 'unknown')} SEQ:{response.get('sequence', 'unknown')} during file list")
                        continue

                if not final_files:
                    return {
                        "files": [],
                        "totalFiles": 0,
                        "totalSize": 0,
                        "error": "No files received from device",
                    }
                    
                # Calculate total size from final files
                total_size_bytes = sum(file_info.get("length", 0) for file_info in final_files)
                
                return {
                    "files": final_files,
                    "totalFiles": len(final_files),
                    "totalSize": total_size_bytes,
                }
        finally:
            self._file_list_streaming = False
    def is_file_list_streaming(self):
        """Check if file list streaming is currently in progress."""
        return getattr(self, '_file_list_streaming', False)

    def _parse_file_list_chunks(self, chunks):
        """
        Parse file list data from accumulated chunks, similar to web version's _parseFileListData.
        
        Args:
            chunks: List of byte arrays from device responses
        
        Returns:
            List of file info dictionaries
        """
        files = []
        
        # Combine all chunks into a single byte array
        file_list_aggregate_data = bytearray()
        for chunk in chunks:
            file_list_aggregate_data.extend(chunk)
            
        if not file_list_aggregate_data:
            return files
            
        offset = 0
        total_files_from_header = -1
        
        # Check for header with total file count
        if (
            len(file_list_aggregate_data) >= 6
            and file_list_aggregate_data[offset] == 0xFF
            and file_list_aggregate_data[offset + 1] == 0xFF
        ):
            total_files_from_header = struct.unpack(
                ">I", file_list_aggregate_data[offset + 2 : offset + 6]
            )[0]
            offset += 6
            
        parsed_file_count = 0
        while offset < len(file_list_aggregate_data):
            try:
                if offset + 4 > len(file_list_aggregate_data):
                    break
                    
                file_version = file_list_aggregate_data[offset]
                offset += 1
                
                name_len = struct.unpack(
                    ">I", b"\x00" + file_list_aggregate_data[offset : offset + 3]
                )[0]
                offset += 3
                
                if offset + name_len > len(file_list_aggregate_data):
                    break
                    
                filename = "".join(
                    chr(b) for b in file_list_aggregate_data[offset : offset + name_len] if b > 0
                )
                offset += name_len
                
                min_remaining = 4 + 6 + 16
                if offset + min_remaining > len(file_list_aggregate_data):
                    break
                    
                file_length_bytes = struct.unpack(">I", file_list_aggregate_data[offset : offset + 4])[0]
                offset += 4
                offset += 6  # Skip 6 bytes
                signature_hex = file_list_aggregate_data[offset : offset + 16].hex()
                offset += 16
                
                # Parse date/time from filename
                create_date_str, create_time_str, time_obj = self._parse_filename_datetime(filename)
                
                duration_sec = self._calculate_file_duration(file_length_bytes, file_version)
                
                files.append({
                    "name": filename,
                    "createDate": create_date_str,
                    "createTime": create_time_str,
                    "time": time_obj,
                    "duration": duration_sec,
                    "version": file_version,
                    "length": file_length_bytes,
                    "signature": signature_hex,
                })
                
                parsed_file_count += 1
                if total_files_from_header != -1 and parsed_file_count >= total_files_from_header:
                    break
                    
            except (struct.error, IndexError) as e:
                logger.error(
                    "Jensen", "parse_file_list_chunks",
                    f"Parsing error at offset {offset}: {e}"
                )
                break
                
        logger.info(
            "Jensen", "parse_file_list_chunks",
            f"Successfully parsed {len(files)} files from {len(chunks)} chunks"
        )
        return files
    
    def _parse_filename_datetime(self, filename):
        """Extract date/time from filename, returning formatted strings and datetime object."""
        create_date_str, create_time_str, time_obj = "", "", None
        
        try:
            if (
                filename.endswith((".wav", ".hda"))
                and "REC" in filename.upper()
                and len(filename) >= 14
                and filename[:14].isdigit()
            ):
                time_obj = datetime.strptime(filename[:14], "%Y%m%d%H%M%S")
            elif filename.endswith((".hda", ".wav")):
                name_parts = filename.split("-")
                if len(name_parts) > 1:
                    date_str_part, time_part_str = name_parts[0], name_parts[1][:6]
                    year_str, month_str_abbr, day_str = "", "", ""
                    
                    if len(date_str_part) >= 7:
                        if date_str_part[:-5].isdigit() and len(date_str_part[:-5]) == 4:
                            year_str, month_str_abbr, day_str = (
                                date_str_part[:4], date_str_part[4:7], date_str_part[7:]
                            )
                        elif date_str_part[:-5].isdigit() and len(date_str_part[:-5]) == 2:
                            year_str, month_str_abbr, day_str = (
                                "20" + date_str_part[:2], date_str_part[2:5], date_str_part[5:]
                            )
                            
                    month_map = {
                        "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
                        "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
                    }
                    
                    if (year_str and month_str_abbr in month_map and day_str.isdigit() 
                        and time_part_str.isdigit() and len(day_str) > 0):
                        time_obj = datetime(
                            int(year_str), month_map[month_str_abbr], int(day_str),
                            int(time_part_str[0:2]), int(time_part_str[2:4]), int(time_part_str[4:6])
                        )
        except (ValueError, IndexError) as date_e:
            logger.debug("Jensen", "parse_filename_datetime", f"Date parse error for '{filename}': {date_e}")
            
        if time_obj:
            create_date_str, create_time_str = time_obj.strftime("%Y/%m/%d"), time_obj.strftime("%H:%M:%S")
        else:
            logger.warning("Jensen", "parse_filename_datetime", f"Failed to parse date/time for: {filename}")
            
        return create_date_str, create_time_str, time_obj

    def _count_parseable_files(self, data):
        """
        Quickly count how many complete file entries can be parsed from the data.
        This is used to determine when we have received enough data to parse all expected files.
        """
        try:
            offset = 0
            
            # Skip header if present
            if (
                len(data) >= 6
                and data[offset] == 0xFF
                and data[offset + 1] == 0xFF
            ):
                offset += 6
                
            count = 0
            while offset < len(data):
                try:
                    # Check if we have enough data for a complete file entry
                    if offset + 4 > len(data):
                        break
                        
                    # Skip version byte
                    offset += 1
                    
                    # Get filename length and check if we have the full filename
                    filename_length = data[offset]
                    offset += 1
                    if offset + filename_length > len(data):
                        break
                        
                    # Skip filename
                    offset += filename_length
                    
                    # Check if we have the remaining required fields (4+6+16 = 26 bytes minimum)
                    if offset + 26 > len(data):
                        break
                        
                    # Skip file length (4) + timestamp (6) + signature (16)
                    offset += 26
                    
                    count += 1
                    
                except (struct.error, IndexError):
                    break
                    
            return count
            
        except Exception:
            return 0

    def stream_file(
        self,
        filename,
        file_length,
        data_callback,
        progress_callback=None,
        timeout_s=180,
        cancel_event: threading.Event = None,
    ):
        """
        Streams a file from the device.

        Data is received in chunks and passed to the `data_callback`.
        Progress can be monitored via the `progress_callback`.
        The operation can be cancelled using the `cancel_event`.

        Args:
            filename (str): The name of the file on the device.
            file_length (int): The expected total length of the file in bytes.
            data_callback (callable): Function called with each received data chunk (bytes).
            progress_callback (callable, optional): Function called with (bytes_received, file_length).
                                                    Defaults to None.
            timeout_s (int, optional): Timeout in seconds for the entire streaming operation.
                                       Defaults to 180.
            cancel_event (threading.Event, optional): Event to signal cancellation. Defaults to None.

        Returns:
            str: Status of the operation ("OK", "cancelled", "fail_timeout", "fail_comms_error", etc.).
        """
        with self._usb_lock:
            status_to_return = "fail"
            try:
                logger.info(
                    "Jensen",
                    "stream_file",
                    f"Starting stream for '{filename}', expected length {file_length} bytes.",
                )
                initial_seq_id = self._send_command(
                    CMD_TRANSFER_FILE,
                    filename.encode("ascii", errors="ignore"),
                    timeout_ms=10000,
                )
                if cancel_event and cancel_event.is_set():
                    logger.info(
                        "Jensen",
                        "stream_file",
                        f"Stream for '{filename}' cancelled before starting data transfer.",
                    )
                    return "cancelled"
                bytes_received = 0
                start_time = time.time()
                end_time = start_time + timeout_s

                while bytes_received < file_length:
                    if time.time() > end_time:
                        logger.error(
                            "Jensen",
                            "stream_file",
                            f"Stream for '{filename}' timed out. Rcvd {bytes_received}/{file_length} bytes.",
                        )
                        status_to_return = "fail_timeout"
                        break

                    if cancel_event and cancel_event.is_set():
                        logger.info(
                            "Jensen",
                            "stream_file",
                            f"Stream for '{filename}' cancelled. Rcvd {bytes_received}/{file_length} bytes.",
                        )
                        status_to_return = "cancelled"
                        break

                    # Use a shorter, rolling timeout for each read operation.
                    # This prevents timeouts on large files that are actively transferring.
                    response = self._receive_response(
                        initial_seq_id, 15000, streaming_cmd_id=CMD_TRANSFER_FILE
                    )

                    if response and response["id"] == CMD_TRANSFER_FILE:
                        chunk = response["body"]
                        if not chunk:
                            if bytes_received >= file_length:
                                logger.info(
                                    "Jensen",
                                    "stream_file",
                                    f"Empty chunk for '{filename}' but expected length met.",
                                )
                                break
                            logger.warning(
                                "Jensen",
                                "stream_file",
                                f"Empty chunk for '{filename}' before completion.",
                            )
                            time.sleep(0.1)
                            continue
                        bytes_received += len(chunk)
                        data_callback(chunk)
                        if progress_callback:
                            progress_callback(bytes_received, file_length)
                        if bytes_received >= file_length:
                            logger.info(
                                "Jensen",
                                "stream_file",
                                f"Successfully streamed '{filename}'. Rcvd {bytes_received} bytes.",
                            )
                            status_to_return = "OK"
                            break
                    elif response is None:
                        logger.error(
                            "Jensen",
                            "stream_file",
                            f"Timeout or USB error for '{filename}'. Rcvd {bytes_received}/{file_length} bytes.",
                        )
                        status_to_return = (
                            "fail_comms_error"
                            if self.is_connected()
                            else "fail_disconnected"
                        )
                        break
                    else:
                        logger.warning(
                            "Jensen",
                            "stream_file",
                            f"Unexpected response ID {response['id']} for '{filename}'.",
                        )
                        status_to_return = "fail_unexpected_response"
                        break
                if status_to_return == "fail" and bytes_received < file_length:
                    logger.error(
                        "Jensen",
                        "stream_file",
                        f"Stream for '{filename}' incomplete. Rcvd {bytes_received}/{file_length} bytes.",
                    )
                    status_to_return = (
                        "fail_disconnected"
                        if not self.is_connected()
                        else status_to_return
                    )
            # Corrected order: More specific exceptions (or those Pylint considers potentially
            # more specific in this context due to OSError's broadness) should come first.
            except (
                usb.core.USBError,
                ConnectionError,
            ) as e_usb_conn:  # Specific to USB/connection
                logger.error(
                    "Jensen",
                    "stream_file",
                    f"USB/Connection error during stream of '{filename}': {e_usb_conn}\n{traceback.format_exc()}",
                )
                status_to_return = (
                    "fail_disconnected"
                    if not self.is_connected()
                    else "fail_comms_error"
                )
            except (
                IOError,
                OSError,
            ) as e_io_os:  # Specific to file operations and other OS errors
                # This block will now catch IOErrors and OSErrors that are not ConnectionErrors
                # (as ConnectionError is a subclass of OSError and caught above).
                logger.error(
                    "Jensen",
                    "stream_file",
                    f"File/OS IO error during stream of '{filename}': {e_io_os}\n{traceback.format_exc()}",
                )
                status_to_return = "fail_file_io"  # Assuming most non-connection OS errors here are file related
            except (KeyboardInterrupt, SystemExit):  # pylint: disable=try-except-raise
                raise  # Do not swallow system-exiting exceptions.
            except (
                Exception
            ) as e_gen:  # pylint: disable=broad-except # Fallback for truly unexpected errors
                # Catching general Exception here is a fallback for unexpected errors,
                # especially from callbacks or unforeseen issues in the operation.
                logger.error(
                    "Jensen",
                    "stream_file",
                    f"Unexpected generic exception during stream of '{filename}': {e_gen}\n{traceback.format_exc()}",
                )
                status_to_return = "fail_exception"
            finally:
                # The receive buffer should not be cleared here, as it may contain data for the next response.
                if (  # Flush logic should only run on failure to try and recover the connection
                    status_to_return not in ["OK", "cancelled"]
                    and self.device
                    and self.ep_in
                ):
                    logger.debug(
                        "Jensen",
                        "stream_file",
                        f"Stream for '{filename}' ended with '{status_to_return}'. Flushing IN data.",
                    )
                    for _ in range(20):
                        try:
                            if not self.device.read(
                                self.ep_in.bEndpointAddress,
                                self.ep_in.wMaxPacketSize,
                                timeout=50,
                            ):
                                break
                        except usb.core.USBTimeoutError:
                            break
                        except usb.core.USBError as flush_e:
                            logger.warning(
                                "Jensen",
                                "stream_file",
                                f"USBError during IN flush for '{filename}': {flush_e}",
                            )
                            break
            return status_to_return

    def delete_file(self, filename, timeout_s=10):
        """
        Deletes a specified file from the device.

        Args:
            filename (str): The name of the file to delete.
            timeout_s (int, optional): Timeout in seconds for the operation. Defaults to 10.

        Returns:
            dict: A dictionary containing the "result" (str, e.g., "success", "not-exists", "failed")
                  and "code" (int, device's status code). Includes an "error" key on
                  communication failure.
        """
        # Avoid command conflicts during file list streaming
        if self.is_file_list_streaming():
            logger.debug("Jensen", "delete_file", "Skipping during file list streaming")
            return {"result": "failed", "error": "Device busy with file list streaming"}
            
        response = self._send_and_receive(
            CMD_DELETE_FILE,
            filename.encode("ascii", errors="ignore"),
            timeout_ms=int(timeout_s * 1000),
        )
        if response and response["id"] == CMD_DELETE_FILE:
            result_code = response["body"][0] if response["body"] else 2
            status_map = {0: "success", 1: "not-exists", 2: "failed"}
            status_str = status_map.get(result_code, "unknown_error")
            logger.info(
                "Jensen",
                "delete_file",
                f"Delete '{filename}': {status_str} (code: {result_code})",
            )
            return {"result": status_str, "code": result_code}
        logger.error(
            "Jensen",
            "delete_file",
            f"Failed delete response for '{filename}'. Response: {response}",
        )
        return {
            "result": "failed",
            "code": -1,
            "error": "No or invalid response from device",
        }

    def get_card_info(self, timeout_s=5):
        """
        Retrieves storage card information (used space, total capacity, status).

        Args:
            timeout_s (int, optional): Timeout in seconds for the operation. Defaults to 5.

        Returns:
            dict or None: A dictionary containing "used" (MB), "capacity" (MB),
                          and "status_raw" (int) if successful, None otherwise.
                          Units (MB) are assumed based on typical device behavior.
        """
        # Avoid command conflicts during file list streaming
        if self.is_file_list_streaming():
            logger.debug("Jensen", "get_card_info", "Skipping during file list streaming")
            return None
        response = self._send_and_receive(
            CMD_GET_CARD_INFO, timeout_ms=int(timeout_s * 1000)
        )
        if response and response["id"] == CMD_GET_CARD_INFO:
            body = response["body"]
            if len(body) >= 12:
                try:
                    used_mb, capacity_mb, status_raw = struct.unpack(">III", body[:12])
                    logger.info(
                        "Jensen",
                        "get_card_info",
                        f"Card Info: Used={used_mb}MB, Total={capacity_mb}MB, StatusRaw={hex(status_raw)}",
                    )
                    return {
                        "used": used_mb,
                        "capacity": capacity_mb,
                        "status_raw": status_raw,
                    }
                except struct.error:
                    logger.error(
                        "Jensen",
                        "get_card_info",
                        f"Failed to unpack card info. Body: {body}. Assuming file list.",
                    )
            logger.warning(
                "Jensen",
                "get_card_info",
                f"Received unexpected response for card info. Body: {body}. Likely a file list.",
            )
        logger.error(
            "Jensen", "get_card_info", f"Failed to get card info. Response: {response}"
        )
        return None

    def format_card(self, timeout_s=60):
        """
        Sends a command to format the device's storage card.

        Args:
            timeout_s (int, optional): Timeout in seconds for the operation. Defaults to 60.

        Returns:
            dict: A dictionary containing the "result" (str, "success" or "failed")
                  and "code" (int, device's status code). Includes an "error" key on
                  communication failure.
        """
        # Avoid command conflicts during file list streaming
        if self.is_file_list_streaming():
            logger.debug("Jensen", "format_card", "Skipping during file list streaming")
            return {"result": "failed", "error": "Device busy with file list streaming"}
            
        response = self._send_and_receive(
            CMD_FORMAT_CARD,
            body_bytes=bytes([1, 2, 3, 4]),
            timeout_ms=int(timeout_s * 1000),
        )
        if response and response["id"] == CMD_FORMAT_CARD:
            result_code = response["body"][0] if response["body"] else 1
            status_str = "success" if result_code == 0 else "failed"
            logger.info(
                "Jensen",
                "format_card",
                f"Format card status: {status_str} (code: {result_code})",
            )
            return {"result": status_str, "code": result_code}
        logger.error(
            "Jensen",
            "format_card",
            f"Failed format card response. Response: {response}",
        )
        return {
            "result": "failed",
            "code": -1,
            "error": "No or invalid response from device",
        }

    def get_recording_file(self, timeout_s=5):
        """
        Retrieves the name of the currently active or last recorded file.

        Args:
            timeout_s (int, optional): Timeout in seconds for the operation. Defaults to 5.

        Returns:
            dict or None: A dictionary like {"name": "filename", "status": "recording_active_or_last"}
                          if a recording file is reported. Returns None if no file info is available,
                          the filename is empty, or an error occurs.
        """
        # Avoid command conflicts during file list streaming
        if self.is_file_list_streaming():
            logger.debug("Jensen", "get_recording_file", "Skipping during file list streaming")
            return None
            
        response = self._send_and_receive(
            CMD_GET_RECORDING_FILE, timeout_ms=int(timeout_s * 1000)
        )
        if response and response["id"] == CMD_GET_RECORDING_FILE:
            if not response["body"]:
                logger.debug(
                    "Jensen",
                    "get_recording_file",
                    "No recording file info (empty body).",
                )
                return None
            filename_bytes = response["body"]
            try:
                printable_bytes = bytearray(
                    b for b in filename_bytes if 32 <= b <= 126 or b == 0
                )
                null_idx = printable_bytes.find(0)
                if null_idx != -1:
                    printable_bytes = printable_bytes[:null_idx]
                filename = printable_bytes.decode("ascii").strip()
            except UnicodeDecodeError:
                filename = filename_bytes.hex()
            if not filename:
                logger.info(
                    "Jensen",
                    "get_recording_file",
                    "Decoded recording filename is empty.",
                )
                return None
            logger.debug(
                "Jensen",
                "get_recording_file",
                f"Current or last recording file reported by device: {filename}",
            )
            return {"name": filename, "status": "recording_active_or_last"}
        elif response and response["id"] == CMD_GET_CARD_INFO:
            logger.warning(
                "Jensen",
                "get_recording_file",
                f"Received CMD_GET_CARD_INFO response when expecting recording file info. Response: {response}",
            )
            return None
        logger.warning(
            "Jensen",
            "get_recording_file",
            f"Failed to get recording file info. Response: {response}",
        )
        return None

    def _to_bcd(self, value: int) -> int:
        """
        Converts an integer to its Binary-Coded Decimal (BCD) representation.

        Only supports values between 0 and 99.

        Args:
            value (int): The integer to convert (0-99).

        Returns:
            int: The BCD representation of the value, or 0 if input is out of range.
        """
        if value < 0 or value > 99:  # More direct check for out-of-bounds
            return 0
        return (value // 10 << 4) | (value % 10)

    def set_device_time(self, dt_object: datetime, timeout_s=5):
        """
        Sets the device's internal clock to the provided datetime object.

        Args:
            dt_object (datetime): The datetime object to set on the device.
            timeout_s (int, optional): Timeout in seconds for the operation. Defaults to 5.

        Returns:
            dict: A dictionary indicating the "result" ("success" or "failed"),
            and potentially "error" or "device_code".
        """
        year = dt_object.year
        payload = bytes(
            [
                self._to_bcd(year // 100),
                self._to_bcd(year % 100),
                self._to_bcd(dt_object.month),
                self._to_bcd(dt_object.day),
                self._to_bcd(dt_object.hour),
                self._to_bcd(dt_object.minute),
                self._to_bcd(dt_object.second),
            ]
        )
        response = self._send_and_receive(
            CMD_SET_DEVICE_TIME, payload, timeout_ms=int(timeout_s * 1000)
        )
        if (
            response
            and response["id"] == CMD_SET_DEVICE_TIME
            and response["body"]
            and response["body"][0] == 0
        ):
            logger.info("Jensen", "set_device_time", "Device time set successfully.")
            return {"result": "success"}
        err_code = response["body"][0] if response and response["body"] else -1
        logger.error(
            "Jensen",
            "set_device_time",
            f"Failed to set device time. Device response code: {err_code}. Response: {response}",
        )
        return {
            "result": "failed",
            "error": "Device error or invalid response.",
            "device_code": err_code,
        }

    def _parse_bcd_time_response(self, body_bytes: bytes) -> str:
        """
        Parses the 7-byte BCD time response from the device.

        Args:
            body_bytes (bytes): The 7-byte response body from the device,
                                representing time in BCD format.

        Returns:
            str: A string representing the time in "YYYY-MM-DD HH:MM:SS" format,
                 or "unknown" if the time is invalid or cannot be parsed.
        """
        if len(body_bytes) < 7:
            logger.error(
                "Jensen", "_parse_bcd_time_response", "Time response body too short."
            )
            return "unknown"

        bcd_str = ""
        for byte_val in body_bytes[:7]:  # Process the first 7 bytes
            high_nibble = (byte_val >> 4) & 0x0F
            low_nibble = byte_val & 0x0F
            bcd_str += str(high_nibble) + str(low_nibble)

        if bcd_str == "00000000000000":
            return "unknown"

        try:
            # bcd_str should be in YYYYMMDDHHMMSS format
            dt_obj = datetime.strptime(bcd_str, "%Y%m%d%H%M%S")
            return dt_obj.strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            logger.error(
                "Jensen",
                "_parse_bcd_time_response",
                f"Invalid BCD time string received from device: {bcd_str}",
            )
            return "unknown"

    def get_device_time(self, timeout_s=5):
        """
        Retrieves the current time from the HiDock device.

        Args:
            timeout_s (int, optional): Timeout for the operation in seconds. Defaults to 5.

        Returns:
            dict or None: A dictionary like {"time": "YYYY-MM-DD HH:MM:SS"} or {"time": "unknown"}
                          if successful, None on communication failure.
        """
        response = self._send_and_receive(
            CMD_GET_DEVICE_TIME, timeout_ms=int(timeout_s * 1000)
        )
        if response and response["id"] == CMD_GET_DEVICE_TIME:
            if response["body"]:
                parsed_time_str = self._parse_bcd_time_response(response["body"])
                logger.info(
                    "Jensen", "get_device_time", f"Device time: {parsed_time_str}"
                )
                return {"time": parsed_time_str}
            else:
                logger.error(
                    "Jensen",
                    "get_device_time",
                    "Response body for time is missing or empty.",
                )
                return {"time": "unknown", "error": "Empty response body"}
        logger.error(
            "Jensen",
            "get_device_time",
            "Failed to get device time or invalid response ID.",
        )
        return None

    def get_device_settings(self, timeout_s=5):
        """
        Retrieves current behavior settings from the device.

        Settings include autoRecord, autoPlay, bluetoothTone, and notificationSound.

        Args:
            timeout_s (int, optional): Timeout in seconds for the operation. Defaults to 5.

        Returns:
            dict or None: A dictionary of settings if successful, None otherwise.
        """
        response = self._send_and_receive(
            CMD_GET_SETTINGS, timeout_ms=int(timeout_s * 1000)
        )
        if (
            response
            and response["id"] == CMD_GET_SETTINGS
            and len(response["body"]) >= 4
        ):

            def to_bool(val):
                return val == 1

            self.device_behavior_settings = {
                "autoRecord": to_bool(response["body"][0]),
                "autoPlay": to_bool(response["body"][1]),
                "bluetoothTone": to_bool(response["body"][2]),
                "notificationSound": to_bool(response["body"][3]),
            }
            logger.info(
                "Jensen",
                "get_device_settings",
                f"Device settings: {self.device_behavior_settings}",
            )
            return self.device_behavior_settings
        logger.error(
            "Jensen",
            "get_device_settings",
            f"Failed to get device settings. Response: {response}",
        )
        return None

    def set_device_settings(self, settings_dict, timeout_s=5):
        """
sends a command to the device to update its behavior settings.

        Args:
            settings_dict (dict): A dictionary containing the settings to update.
                                  Keys can include "autoRecord", "autoPlay",
                                  "bluetoothTone", "notificationSound".
                                  Values should be boolean.
            timeout_s (int, optional): Timeout in seconds for the operation. Defaults to 5.

        Returns:
            dict: A dictionary indicating the "result" ("success" or "failed").
        """
        # First, get current settings to ensure we send a complete payload
        current_settings = self.get_device_settings(timeout_s=timeout_s)
        if current_settings is None:
            logger.error(
                "Jensen",
                "set_device_settings",
                "Could not retrieve current settings; aborting set operation.",
            )
            return {"result": "failed", "error": "Could not get current settings."}

        # Update the current settings with the new values provided
        updated_settings = current_settings.copy()
        updated_settings.update(settings_dict)

        # Construct the payload from the updated settings
        payload = bytes(
            [
                1 if updated_settings.get("autoRecord", False) else 0,
                1 if updated_settings.get("autoPlay", False) else 0,
                1 if updated_settings.get("bluetoothTone", False) else 0,
                1 if updated_settings.get("notificationSound", False) else 0,
            ]
        )

        response = self._send_and_receive(
            CMD_SET_SETTINGS, payload, timeout_ms=int(timeout_s * 1000)
        )
        if (
            response
            and response["id"] == CMD_SET_SETTINGS
            and response["body"]
            and response["body"][0] == 0
        ):
            logger.info(
                "Jensen", "set_device_settings", "Device settings updated successfully."
            )
            # Update local cache of settings
            self.device_behavior_settings = updated_settings
            return {"result": "success"}
        logger.error(
            "Jensen",
            "set_device_settings",
            f"Failed to set device settings. Response: {response}",
        )
        return {"result": "failed"}

    def get_file_block(self, filename, offset, length, timeout_s=5):
        """
        Retrieves a specific block of data from a file on the device.

        Args:
            filename (str): The name of the file to read from.
            offset (int): The starting position (in bytes) to read from.
            length (int): The number of bytes to read.
            timeout_s (int, optional): Timeout in seconds for the operation. Defaults to 5.

        Returns:
            bytes or None: The requested data block as bytes if successful, None otherwise.
        """
        with self._usb_lock:
            status_to_return = None
            try:
                body = struct.pack(">I", offset) + struct.pack(">I", length)
                body += filename.encode("ascii", errors="ignore")
                seq_id = self._send_command(
                    CMD_GET_FILE_BLOCK, body, timeout_ms=int(timeout_s * 1000)
                )
                response = self._receive_response(
                    seq_id, int(timeout_s * 1000), streaming_cmd_id=CMD_GET_FILE_BLOCK
                )
                if response and response["id"] == CMD_GET_FILE_BLOCK:
                    logger.info(
                        "Jensen",
                        "get_file_block",
                        f"Received block of size {len(response['body'])} for '{filename}'.",
                    )
                    status_to_return = response["body"]
                else:
                    logger.error(
                        "Jensen",
                        "get_file_block",
                        f"Failed to get file block for '{filename}'. Response: {response}",
                    )
            except (usb.core.USBError, ConnectionError) as e:
                logger.error(
                    "Jensen",
                    "get_file_block",
                    f"USB/Connection error during get_file_block for '{filename}': {e}",
                )
            finally:
                # This is a critical bug. Clearing the buffer here can discard data
                # from a subsequent, unrelated operation if there's any overlap or
                # unexpected response from the device.
                # This should only be done
                # for non-streaming commands in _send_and_receive.
                # self.receive_buffer.clear() # DO NOT DO THIS HERE
                pass
            return status_to_return