import usb.core
import usb.util
import usb.backend.libusb1 # Explicitly import the backend
import os
import time
import struct
from datetime import datetime
import tkinter as tk
import json 
from tkinter import ttk, filedialog, messagebox
import threading
import traceback # For detailed error logging
import tempfile # For temporary audio files

try:
    import pygame
except ImportError:
    pygame = None # Pygame will be checked before use


# --- Constants ---
DEFAULT_VENDOR_ID = 0x10D6   # Actions Semiconductor
DEFAULT_PRODUCT_ID = 0xB00D  # The PID for HiDock H1E as a default

# Target endpoints based on jensen.js and your list_device_details output for Interface 0
# PyUSB uses the full bEndpointAddress
EP_OUT_ADDR = 0x01 # Physical endpoint 0x01, OUT direction
EP_IN_ADDR  = 0x82 # Physical endpoint 0x02, IN direction

# Command IDs from jensen.js analysis
CMD_GET_DEVICE_INFO = 1
CMD_GET_DEVICE_TIME = 2
CMD_SET_DEVICE_TIME = 3
CMD_GET_FILE_LIST = 4
CMD_TRANSFER_FILE = 5  # Streaming
CMD_GET_FILE_COUNT = 6
CMD_DELETE_FILE = 7
CMD_GET_FILE_BLOCK = 13
CMD_GET_SETTINGS = 11       # For autoRecord, autoPlay, etc.
CMD_SET_SETTINGS = 12       # For autoRecord, autoPlay, etc.
CMD_GET_CARD_INFO = 16
CMD_FORMAT_CARD = 17
CMD_GET_RECORDING_FILE = 18
# ... add other command IDs as needed


# --- Logger ---
CONFIG_FILE = "hidock_tool_config.json"

def load_config():
    try:
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        logger.info("Config", "load_config", f"{CONFIG_FILE} not found, using defaults.")
        return {
            "autoconnect": False,
            "download_directory": os.getcwd(),
            "log_level": "INFO",
            "selected_vid": DEFAULT_VENDOR_ID,
            "selected_pid": DEFAULT_PRODUCT_ID,
            "target_interface": 0,
            "recording_check_interval_s": 3,
            "default_command_timeout_ms": 5000,
            "file_stream_timeout_s": 180,
            "auto_refresh_files": False,
            "auto_refresh_interval_s": 30,
            "quit_without_prompt_if_connected": False,
            "theme": "default"  # Default theme
        }
    except json.JSONDecodeError:
        logger.error("Config", "load_config", f"Error decoding {CONFIG_FILE}. Using defaults.")
        return {
            "autoconnect": False,
            "download_directory": os.getcwd(),
            "log_level": "INFO",
            "selected_vid": DEFAULT_VENDOR_ID,
            "selected_pid": DEFAULT_PRODUCT_ID,
            "target_interface": 0,
            "recording_check_interval_s": 3,
            "default_command_timeout_ms": 5000,
            "file_stream_timeout_s": 180,
            "auto_refresh_files": False,
            "auto_refresh_interval_s": 30,
            "quit_without_prompt_if_connected": False,
            "theme": "default"
        }

def save_config(config_data):
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config_data, f, indent=4)
        logger.info("Config", "save_config", f"Configuration saved to {CONFIG_FILE}")
    except IOError:
        logger.error("Config", "save_config", f"Error writing to {CONFIG_FILE}.")
class Logger:
    LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
    def __init__(self, level_name="INFO"): # Default level
        self.gui_log_callback = None
        self.set_level(level_name) # Use set_level to initialize

    def set_gui_log_callback(self, callback):
        self.gui_log_callback = callback

    def set_level(self, level_name):
        self.level = self.LEVELS.get(level_name.upper(), self.LEVELS["INFO"])
        # Log this change using a direct print or a fixed high-level log if logger itself is being configured.
        print(f"[INFO] Logger::set_level - Log level set to {level_name.upper()}")

    def _log(self, level_str, module, procedure, message):
        msg_level_val = self.LEVELS.get(level_str.upper())
        if msg_level_val is None or msg_level_val < self.level: # Check against current log level
            return

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        # Ensure module and procedure are strings, even if None or other types are passed.
        log_message = f"[{timestamp}][{level_str.upper()}] {str(module)}::{str(procedure)} - {message}"
        print(log_message) 
        if self.gui_log_callback: # Pass level_str to the callback
            self.gui_log_callback(log_message + "\n", level_str.upper())
    def info(self, module, procedure, message):
        self._log("info", module, procedure, message)

    def debug(self, module, procedure, message):
        self._log("debug", module, procedure, message)

    def error(self, module, procedure, message):
        self._log("error", module, procedure, message)

    def warning(self, module, procedure, message):
        self._log("warning", module, procedure, message)

logger = Logger(load_config().get("log_level", "INFO")) # Initialize logger with configured level

# --- Libusb backend (will be initialized on demand by the GUI) ---
backend = None

# --- HiDock Communication Class ---
class HiDockJensen:
    def __init__(self):
        self.device = None
        self.ep_out = None
        self.ep_in = None
        self.sequence_id = 0
        self.receive_buffer = bytearray()
        self.device_info = {}
        self.model = "unknown"
        self.claimed_interface_number = -1 # Keep track of claimed interface
        self.detached_kernel_driver_on_interface = -1 # Track if kernel driver was detached
        self.is_connected_flag = False # More explicit connected flag
        self.device_behavior_settings = { # To cache fetched device settings
            "autoRecord": None, "autoPlay": None,
            "bluetoothTone": None, "notificationSound": None
        }
        self._usb_lock = threading.Lock() # Lock for serializing USB operations

    def is_connected(self) -> bool:
        return self.device is not None and self.ep_in is not None and self.ep_out is not None and self.is_connected_flag

    def _find_device(self, vid_to_find: int, pid_to_find: int):
        logger.debug("Jensen", "_find_device", f"Looking for VID={hex(vid_to_find)}, PID={hex(pid_to_find)}")
        device = usb.core.find(idVendor=vid_to_find, idProduct=pid_to_find, backend=backend) # Use global backend
        if device is None:
            raise ValueError(f"HiDock device (VID={hex(vid_to_find)}, PID={hex(pid_to_find)}) not found. Ensure it's connected and you have permissions.")
        logger.debug("Jensen", "_find_device", f"Device found: {device.product or 'Unknown Product'} (by {device.manufacturer or 'Unknown Manufacturer'})")
        return device

    def connect(self, target_interface_number: int = 0, vid: int = DEFAULT_VENDOR_ID, pid: int = DEFAULT_PRODUCT_ID) -> bool:
        if self.device:
            logger.info("Jensen", "connect", "Device object or connection flag indicates prior state. Disconnecting before reconnecting.")
            self.disconnect() # Clean up existing connection
        self.is_connected_flag = False # Ensure it's false at the start of a connection attempt

        self.detached_kernel_driver_on_interface = -1 # Reset for this connection attempt
        self.device = self._find_device(vid, pid)
        self.claimed_interface_number = -1 # Reset

        # On Windows, detaching kernel driver is usually not needed if using WinUSB via Zadig,
        # or not possible if using default drivers that PyUSB can't override without Zadig.
        # This call is more relevant for Linux/macOS.
        try:
            if self.device.is_kernel_driver_active(target_interface_number):
                logger.info("Jensen", "connect", f"Kernel driver is active on Interface {target_interface_number}. Attempting to detach.")
                self.device.detach_kernel_driver(target_interface_number)
                logger.info("Jensen", "connect", f"Detached kernel driver from Interface {target_interface_number}.")
                self.detached_kernel_driver_on_interface = target_interface_number # Store if successful
        except usb.core.USBError as e:
            logger.info("Jensen", "connect", f"Could not detach kernel driver from Interface {target_interface_number}: {e} (This is often ignorable on Windows or if no driver was attached).")
        except NotImplementedError: # pragma: no cover
            logger.info("Jensen", "connect", "Kernel driver detach not implemented/needed on this platform (e.g., Windows).")

        try:
            self.device.set_configuration()
            logger.info("Jensen", "connect", "Device configuration set.")
        except usb.core.USBError as e:
            if e.errno == 16: # Resource busy (LIBUSB_ERROR_BUSY)
                logger.info("Jensen", "connect", "Configuration already set or interface busy (this is often OK).")
            else:
                logger.error("Jensen", "connect", f"Could not set configuration: {e} (errno: {e.errno})")
                self.disconnect() # Ensure cleanup
                return False

        cfg = self.device.get_active_configuration()
        intf = None
        try:
            intf = usb.util.find_descriptor(cfg, bInterfaceNumber=target_interface_number)
            if intf is None:
                 raise usb.core.USBError(f"Interface {target_interface_number} found but is None (should not happen if find_descriptor succeeded).")
            logger.info("Jensen", "connect", f"Found Interface {intf.bInterfaceNumber}, Alternate Setting {intf.bAlternateSetting}")
        except usb.core.USBError as e:
            logger.error("Jensen", "connect", f"Could not find Interface {target_interface_number}: {e}")
            self.disconnect() # Ensure cleanup
            return False

        try:
            usb.util.claim_interface(self.device, intf.bInterfaceNumber)
            self.claimed_interface_number = intf.bInterfaceNumber
            logger.info("Jensen", "connect", f"Claimed Interface {self.claimed_interface_number}")
        except usb.core.USBError as e:
            logger.error("Jensen", "connect", f"Could not claim Interface {intf.bInterfaceNumber}: {e} (errno: {e.errno})")
            if e.errno == 16: # LIBUSB_ERROR_BUSY
                 logger.error("Jensen", "connect", "Interface busy. Another program (e.g. browser WebUSB) or driver might be using it. On Windows, Zadig might be needed for this interface.")
            self.disconnect() # Ensure cleanup
            return False

        self.ep_out = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_OUT and \
                                   (e.bEndpointAddress & 0x0F) == (EP_OUT_ADDR & 0x0F)
        )
        self.ep_in = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_IN and \
                                   (e.bEndpointAddress & 0x0F) == (EP_IN_ADDR & 0x7F) # Mask out direction bit for IN
        )

        if self.ep_out is None or self.ep_in is None:
            logger.error("Jensen", "connect", f"Could not find required IN/OUT endpoints ({hex(EP_OUT_ADDR)}/{hex(EP_IN_ADDR)}) on Interface {target_interface_number}.")
            self.disconnect() # Ensure cleanup
            return False

        logger.info("Jensen", "connect", f"Using Interface {target_interface_number}. EP_OUT: {hex(self.ep_out.bEndpointAddress)}, EP_IN: {hex(self.ep_in.bEndpointAddress)}")

        # Model determination
        if self.device.idProduct == 0xAF0C: self.model = "hidock-h1"        # 45068 in jensen.js
        elif self.device.idProduct == 0xAF0D: self.model = "hidock-h1e"     # 45069 in jensen.js
        elif self.device.idProduct == 0xAF0E: self.model = "hidock-p1"      # 45070 in jensen.js
        elif self.device.idProduct == pid : self.model = f"HiDock Device (PID: {hex(pid)})" # Use the connected PID
        else: self.model = f"unknown (PID: {hex(self.device.idProduct)})"
        logger.info("Jensen", "connect", f"Device model determined as: {self.model}")
        
        self.is_connected_flag = True
        return True

    def disconnect(self):
        with self._usb_lock: # Ensure disconnect operations are also serialized
            if not self.is_connected_flag and not self.device: # Already disconnected or nothing to do
                logger.info("Jensen", "disconnect", "Already disconnected or no device object.")
                # Ensure all relevant flags are reset even if called multiple times
                self.device = None
                self.ep_out = None
                self.ep_in = None
                self.claimed_interface_number = -1
                self.detached_kernel_driver_on_interface = -1
                self.is_connected_flag = False
                self.receive_buffer.clear()
                return

            logger.info("Jensen", "disconnect", "Disconnecting from device...")
            if self.device:
                if self.claimed_interface_number != -1:
                    try:
                        usb.util.release_interface(self.device, self.claimed_interface_number)
                        logger.info("Jensen", "disconnect", f"Released Interface {self.claimed_interface_number}.")
                    except usb.core.USBError as e: # pragma: no cover
                        logger.warning("Jensen", "disconnect", f"Could not release Interface {self.claimed_interface_number}: {e} (errno: {e.errno})")
                
                if self.detached_kernel_driver_on_interface != -1:
                    try:
                        self.device.attach_kernel_driver(self.detached_kernel_driver_on_interface)
                        logger.info("Jensen", "disconnect", f"Re-attached kernel driver to Interface {self.detached_kernel_driver_on_interface}.")
                    except Exception as e: # pragma: no cover
                         logger.info("Jensen", "disconnect", f"Could not re-attach kernel driver to Interface {self.detached_kernel_driver_on_interface}: {e} (often ignorable).")

                usb.util.dispose_resources(self.device)
            self.device = None
            self.ep_out = None
            self.ep_in = None
            self.claimed_interface_number = -1
            self.detached_kernel_driver_on_interface = -1
            self.is_connected_flag = False
            self.receive_buffer.clear() # Clear any pending receive data
            self.device_info = {} # Clear cached device info
            self.model = "unknown"
            logger.info("Jensen", "disconnect", "Disconnected and resources disposed.")

    def _build_packet(self, command_id, body_bytes=b''):
        self.sequence_id += 1
        # Header: 0x12, 0x34, cmd_id (2B BE), seq_id (4B BE), body_len (4B BE)
        header = bytearray([0x12, 0x34])
        header.extend(struct.pack('>H', command_id))
        header.extend(struct.pack('>I', self.sequence_id))
        header.extend(struct.pack('>I', len(body_bytes)))
        return bytes(header) + body_bytes

    def _send_command(self, command_id, body_bytes=b'', timeout_ms=5000):
        if not self.device or not self.ep_out:
            # Log and raise, or handle disconnect if appropriate
            logger.error("Jensen", "_send_command", "Attempted to send command while not connected or ep_out missing.")
            if self.is_connected(): self.disconnect() # Consider auto-disconnect
            raise ConnectionError("Device not connected or output endpoint not found.")
        
        packet = self._build_packet(command_id, body_bytes)
        logger.debug("Jensen", "_send_command", f"Sending CMD: {command_id}, Seq: {self.sequence_id}, Len: {len(body_bytes)}, Data: {packet.hex()[:64]}...")
        try:
            bytes_sent = self.ep_out.write(packet, timeout=int(timeout_ms)) # Ensure timeout is int
            if bytes_sent != len(packet):
                logger.warning("Jensen", "_send_command", f"Bytes sent ({bytes_sent}) does not match packet length ({len(packet)}) for CMD {command_id}.")
        except usb.core.USBError as e:
            logger.error("Jensen", "_send_command", f"USB write error for CMD {command_id}: {e} (errno: {e.errno})")
            if e.errno == 32: # LIBUSB_ERROR_PIPE / EPIPE (Stall)
                try:
                    self.device.clear_halt(self.ep_out.bEndpointAddress)
                    logger.info("Jensen", "_send_command", "Cleared halt on EP_OUT")
                except Exception as ce: # pragma: no cover
                    logger.error("Jensen", "_send_command", f"Failed to clear halt: {ce}")
            raise # Re-raise to be caught by _send_and_receive or higher
        return self.sequence_id

    def _receive_response(self, expected_seq_id, timeout_ms=5000, streaming_cmd_id=None): # Added streaming_cmd_id
        if not self.device or not self.ep_in:
            logger.error("Jensen", "_receive_response", "Attempted to receive response while not connected or ep_in missing.")
            if self.is_connected(): self.disconnect()
            raise ConnectionError("Device not connected or input endpoint not found.")

        start_time = time.time()
        # The overall timeout for receiving a complete, valid response for the expected_seq_id
        overall_timeout_sec = timeout_ms / 1000.0

        while time.time() - start_time < overall_timeout_sec:
            try:
                # Max packet size is usually 64 for Full Speed bulk, or 512 for High Speed.
                # Reading a larger amount to reduce number of calls, if data is available.
                # Use a short timeout for individual read attempts to remain responsive.
                read_attempt_size = self.ep_in.wMaxPacketSize * 32 if self.ep_in.wMaxPacketSize else 512 * 32 # Further increased multiplier
                # Individual read timeout should be small, e.g., 100ms, to allow loop to check overall_timeout_sec
                data_chunk = self.device.read(self.ep_in.bEndpointAddress, read_attempt_size, timeout=100)
                if data_chunk:
                    self.receive_buffer.extend(data_chunk)
                    logger.debug("Jensen", "_receive_response", f"Rcvd chunk: {bytes(data_chunk).hex()[:64]}... Buf len: {len(self.receive_buffer)}")
            except usb.core.USBTimeoutError:
                # This is an expected timeout for a single read attempt if no data is immediately available.
                # The outer loop will continue until the overall_timeout_sec is reached.
                pass
            except usb.core.USBError as e:
                logger.error("Jensen", "_receive_response", f"USB read error: {e} (errno: {e.errno})")
                if e.errno == 32: # LIBUSB_ERROR_PIPE / EPIPE (Stall)
                    try:
                        self.device.clear_halt(self.ep_in.bEndpointAddress)
                        logger.info("Jensen", "_receive_response", "Cleared halt on EP_IN")
                    except Exception as ce: # pragma: no cover
                        logger.error("Jensen", "_receive_response", f"Failed to clear halt on EP_IN: {ce}")
                # For other USB errors, it might be fatal for this attempt.
                # Consider if self.disconnect() should be called here.
                return None # Or raise

            # Efficiently find the start of a valid packet (0x1234)
            if len(self.receive_buffer) >= 2: # Need at least 2 bytes to check for sync
                if not (self.receive_buffer[0] == 0x12 and self.receive_buffer[1] == 0x34):
                    # Sync bytes not at the beginning, try to find them
                    sync_marker = b'\x12\x34'
                    try:
                        offset = self.receive_buffer.find(sync_marker)
                        if offset != -1:
                            # Sync marker found
                            if offset > 0:
                                discarded_bytes = self.receive_buffer[:offset]
                                logger.warning("Jensen", "_receive_response", 
                                               f"Discarded {offset} prefix bytes: {discarded_bytes.hex()[:64]}...")
                                # Slice the buffer to start from the sync marker
                                temp_buffer = self.receive_buffer[offset:]
                                self.receive_buffer.clear()
                                self.receive_buffer.extend(temp_buffer)
                            # Now self.receive_buffer should start with sync_marker or be empty if marker was at the end
                        # else: Sync marker not found in the current buffer.
                        # The outer loop will continue to read more data if timeout hasn't occurred.
                    except Exception as e_find: # Should not happen with bytearray.find
                        logger.error("Jensen", "_receive_response", f"Error during sync marker find operation: {e_find}")

            # Try to parse a complete message from the buffer
            while len(self.receive_buffer) >= 12: # Minimum header size (2 sync + 2 cmd + 4 seq + 4 len)
                if not (self.receive_buffer[0] == 0x12 and self.receive_buffer[1] == 0x34):
                    # This should be rare if the pre-sync logic above is effective.
                    # If hit, it means the buffer is still misaligned. Break to allow pre-sync on next iteration or more data.
                    logger.error("Jensen", "_receive_response", f"Post-sync check: Invalid header sync bytes: {self.receive_buffer[:2].hex()}. Breaking inner parse loop.")
                    break # Break from this inner while loop to re-evaluate buffer or get more data

                header_prefix = self.receive_buffer[:12]
                response_cmd_id = struct.unpack('>H', header_prefix[2:4])[0]
                response_seq_id = struct.unpack('>I', header_prefix[4:8])[0]
                body_len_from_header = struct.unpack('>I', header_prefix[8:12])[0]

                # Implement checksum_len and body_len extraction as per jensen.js
                checksum_len = (body_len_from_header >> 24) & 0xFF
                body_len = body_len_from_header & 0x00FFFFFF # Mask for lower 3 bytes

                total_msg_len = 12 + body_len + checksum_len # Header + actual body + checksum

                if len(self.receive_buffer) >= total_msg_len:
                    msg_bytes_full = self.receive_buffer[:total_msg_len]
                    self.receive_buffer = self.receive_buffer[total_msg_len:] # Consume the message

                    # Check sequence ID (and command ID if streaming)
                    # For streaming, stream_file method handles more detailed logic.
                    # This part primarily ensures we got the response for the command we sent.
                    if response_seq_id == expected_seq_id: # Exact match for non-streaming or first packet of stream if seq matches
                        logger.debug("Jensen", "_receive_response", f"RSP for CMD: {response_cmd_id}, Seq: {response_seq_id}, BodyLen: {body_len}, ChecksumLen: {checksum_len}, Body: {msg_bytes_full[12:12+body_len].hex()[:64]}...")
                        return {"id": response_cmd_id, "sequence": response_seq_id, "body": msg_bytes_full[12:12+body_len]}
                    elif streaming_cmd_id is not None and response_cmd_id == streaming_cmd_id:
                        # For subsequent (or even first if seq_id differs) packets of a known streaming command
                        logger.debug("Jensen", "_receive_response", f"Streaming RSP for CMD: {response_cmd_id}, Seq: {response_seq_id} (command's initial_seq_id: {expected_seq_id}), BodyLen: {body_len}, ChecksumLen: {checksum_len}, Body: {msg_bytes_full[12:12+body_len].hex()[:64]}...")
                        return {"id": response_cmd_id, "sequence": response_seq_id, "body": msg_bytes_full[12:12+body_len]}
                    else:
                        logger.warning("Jensen", "_receive_response", f"Seq ID mismatch or unexpected packet. Expected Seq: {expected_seq_id}, Got CMD: {response_cmd_id} Seq: {response_seq_id}, BodyLen: {body_len}, ChecksumLen: {checksum_len}. Discarding.")
                        # The message is consumed, loop continues to check buffer or outer timeout.
                else:
                    break # Not enough data in buffer for this full message yet, wait for more data
            
            # Check overall timeout again before next read attempt or if buffer was processed
            if time.time() - start_time >= overall_timeout_sec:
                break

        logger.warning("Jensen", "_receive_response", f"Timeout waiting for response to seq_id {expected_seq_id}. Buffer: {self.receive_buffer.hex()}")
        return None

    def _send_and_receive(self, command_id, body_bytes=b'', timeout_ms=5000):
        with self._usb_lock: # Acquire lock for the entire send-receive operation
            try:
                # Clear buffer before new non-streaming command to avoid processing stale data
                if command_id != CMD_TRANSFER_FILE: # Assuming CMD_TRANSFER_FILE is the only streaming one for now
                    self.receive_buffer.clear() 

                seq_id = self._send_command(command_id, body_bytes, timeout_ms)
                return self._receive_response(seq_id, int(timeout_ms), streaming_cmd_id=CMD_TRANSFER_FILE if command_id == CMD_TRANSFER_FILE else None)
            except usb.core.USBError as e:
                logger.error("Jensen", "_send_and_receive", f"USBError in send/receive for CMD {command_id}: {e}")
                if self.is_connected(): 
                    self.disconnect() # Auto-disconnect on USB error during a locked operation
                raise 
            # Lock is released automatically when exiting 'with' block
    
    # --- Device Interaction Methods (Ported from jensen.js) ---

    def get_device_info(self, timeout_s=5):
        response = self._send_and_receive(CMD_GET_DEVICE_INFO, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_GET_DEVICE_INFO:
            body = response["body"]
            logger.debug("Jensen", "get_device_info", f"Received body for device info (len {len(body)}): {body.hex()}")

            # Expect at least 4 bytes for the version. SN is variable.
            if len(body) >= 4:
                version_code_bytes = body[0:4]
                # JS logic: r |= a << 8 * (4 - h - 1) -> Big Endian integer
                version_number_raw = struct.unpack('>I', version_code_bytes)[0]
                
                # JS logic for string: n.push(String(a)) for h > 0
                # This means byte 0 is part of the number, but not the string representation.
                # Bytes 1, 2, 3 form the string parts.
                version_code_str_parts = [str(b) for b in version_code_bytes[1:]]
                version_code_str = ".".join(version_code_str_parts)

                logger.debug("Jensen", "get_device_info", f"Raw Version Bytes: {version_code_bytes.hex()}, Int: {version_number_raw}, String Parts: {version_code_str_parts}")

                serial_number_str = "N/A" # Default if SN part is missing or empty
                if len(body) > 4: # If there are bytes beyond the version
                    # The slice body[4:20] will correctly handle cases where len(body) < 20.
                    # e.g., if len(body) is 17, body[4:20] becomes body[4:17].
                    serial_number_bytes = body[4:20] 
                    try:
                        printable_sn_bytes = bytearray()
                        for b_val in serial_number_bytes: # This loop iterates over the actual available SN bytes
                            if 32 <= b_val <= 126: # Printable ASCII
                                printable_sn_bytes.append(b_val)
                            elif b_val == 0: # Stop at first null
                                break
                            # else: skip non-printable if not null
                        
                        serial_number_str = printable_sn_bytes.decode('ascii', errors='ignore').strip()
                        if not serial_number_str: # If all were filtered or only nulls/non-printable
                            serial_number_str = serial_number_bytes.hex() # Fallback to hex
                    except UnicodeDecodeError: # pragma: no cover
                        serial_number_str = serial_number_bytes.hex() # Fallback to hex
                # else: SN remains "N/A" if len(body) <= 4
                
                self.device_info = {
                    "versionCode": version_code_str,       # String like "6.2.5"
                    "versionNumber": version_number_raw,   # Integer representation
                    "sn": serial_number_str
                }
                logger.info("Jensen", "get_device_info", f"Parsed Device Info: {self.device_info}")
                return self.device_info
            else:
                logger.error("Jensen", "get_device_info", f"Received body too short for version info (len {len(body)}, expected at least 4).")

        logger.error("Jensen", "get_device_info", "Failed to get device info or invalid response ID.")
        return None

    def get_file_count(self, timeout_s=5):
        response = self._send_and_receive(CMD_GET_FILE_COUNT, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_GET_FILE_COUNT:
            body = response["body"]
            if not body: return {"count": 0}
            if len(body) >= 4:
                count = struct.unpack('>I', body[:4])[0]
                logger.info("Jensen", "get_file_count", f"File count: {count}")
                return {"count": count}
        logger.error("Jensen", "get_file_count", "Failed to get file count or invalid response.")
        return None

    def list_files(self, timeout_s=20):
        if not self.device_info.get("versionNumber"):
            logger.info("Jensen", "list_files", "Device info not available, fetching...")
            if not self.get_device_info():
                 logger.error("Jensen", "list_files", "Failed to fetch device info for version check.")
                 return None

        file_list_aggregate_data = bytearray()
        expected_files_from_count_cmd = -1

        # Version check for getFileCount pre-fetch
        current_version_number = self.device_info.get("versionNumber", float('inf'))
        if current_version_number <= 327722: # 0x5002A in hex
            logger.debug("Jensen", "list_files", f"Device version {current_version_number} <= 327722, getting file count first.")
            count_info = self.get_file_count(timeout_s=5)
            if not count_info or count_info.get("count", -1) == 0:
                logger.info("Jensen", "list_files", "No files based on early count or count failed.")
                return {"files": [], "totalFiles": 0, "totalSize": 0}
            expected_files_from_count_cmd = count_info["count"]
        else:
            logger.debug("Jensen", "list_files", f"Device version {current_version_number} > 327722, not pre-fetching file count.")


        logger.info("Jensen", "list_files", "Requesting file list...")
        response = self._send_and_receive(CMD_GET_FILE_LIST, timeout_ms=int(timeout_s * 1000))

        if not response or response["id"] != CMD_GET_FILE_LIST:
            logger.error("Jensen", "list_files", "Failed to get file list or wrong response ID.")
            return {"files": [], "totalFiles": 0, "totalSize": 0, "error": "Failed to get file list"}
        
        file_list_aggregate_data.extend(response["body"])

        files = []
        offset = 0
        data_view = memoryview(file_list_aggregate_data)

        total_size_bytes = 0
        total_files_from_header = -1
        if len(data_view) >= 6 and data_view[offset] == 0xFF and data_view[offset+1] == 0xFF:
            total_files_from_header = struct.unpack('>I', data_view[offset+2:offset+6])[0]
            offset += 6
            logger.debug("Jensen", "list_files_parser", f"Total files from list header: {total_files_from_header}")
        
        logger.debug("Jensen", "list_files_parser", f"Parsing {len(data_view)} bytes, starting at offset {offset}")

        parsed_file_count = 0
        while offset < len(data_view):
            try:
                if offset + 4 > len(data_view): logger.debug("Parser", "list_files", "Partial entry: Not enough data for version+name_len"); break
                file_version = data_view[offset]
                offset += 1
                name_len_bytes = data_view[offset:offset+3]
                name_len = struct.unpack('>I', b'\x00' + name_len_bytes)[0] # Prepend null byte for 3-byte to 4-byte int
                offset += 3

                if offset + name_len > len(data_view): logger.debug("Parser", "list_files", "Partial entry: Not enough data for name"); break
                filename_bytes = data_view[offset : offset + name_len]
                filename = "".join(chr(b) for b in filename_bytes if b > 0) 
                offset += name_len
                
                min_remaining_for_entry_suffix = 4 + 6 + 16 # file_length_bytes + unknown_6 + signature_16
                if offset + min_remaining_for_entry_suffix > len(data_view):
                    logger.debug("Parser", "list_files", f"Partial entry: Not enough data for rest of entry. Need {min_remaining_for_entry_suffix}, have {len(data_view) - offset}")
                    break

                file_length_bytes = struct.unpack('>I', data_view[offset : offset + 4])[0]
                offset += 4
                offset += 6 # Skip 6 unknown/padding bytes
                
                signature_bytes = data_view[offset : offset + 16]
                signature_hex = signature_bytes.hex()
                offset += 16

    # ... inside list_files method, after parsing individual file entry components ...
                create_date_str, create_time_str, time_obj, duration_sec = "", "", None, 0

                try:
                    # Pattern 1: YYYYMMDDHHMMSSREC*.wav (or .hda)
                    # Example: 20250512114141-Rec44.hda
                    # jensen.js: m.match(/^\d{14}REC\d+\.wav$/gi) -> replace to YYYY-MM-DD HH:MM:SS
                    if (filename.endswith(".wav") or filename.endswith(".hda")) and \
                       "REC" in filename.upper() and \
                       len(filename) >= 14 and \
                       filename[:14].isdigit():
                        ts_str = filename[:14]
                        time_obj = datetime.strptime(ts_str, "%Y%m%d%H%M%S")

                    # Pattern 2: YYMMMDD-HHMMSS-*.hda/wav (from jensen.js regex and replace)
                    # Example from your logs: 2025May12-114141-Rec44.hda
                    # Jensen.js replaces this with "20YY MMM DD HH:MM:SS" for `new Date()`
                    # e.g., "2025 May 12 11:41:41"
                    elif (filename.endswith(".hda") or filename.endswith(".wav")):
                        name_parts = filename.split('-')
                        if len(name_parts) > 1:
                            date_str_part = name_parts[0] # e.g., "23May12" or "2025May12"
                            time_part_str = name_parts[1][:6] if len(name_parts[1]) >=6 else "000000" # HHMMSS

                            year_str, month_str_abbr, day_str = "", "", ""

                            # Try to parse YYYYMMMDD or YYMMMDD
                            if len(date_str_part) >= 7: # Min length for YYMMMDD
                                if date_str_part[:-5].isdigit() and len(date_str_part[:-5]) == 4: # YYYY
                                    year_str = date_str_part[:4]
                                    month_str_abbr = date_str_part[4:7]
                                    day_str = date_str_part[7:]
                                elif date_str_part[:-5].isdigit() and len(date_str_part[:-5]) == 2: # YY
                                    year_str = "20" + date_str_part[:2] # Prepend "20" as in jensen.js
                                    month_str_abbr = date_str_part[2:5]
                                    day_str = date_str_part[5:]
                                else: # Fallback for other potential formats if first part is date-like
                                    # This part is less certain without more examples of jensen.js inputs
                                    pass

                            # Map month abbreviation to number
                            month_map_abbr = {
                                "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
                                "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12
                            }
                            if year_str and month_str_abbr in month_map_abbr and \
                               day_str.isdigit() and time_part_str.isdigit() and len(day_str) > 0:
                                time_obj = datetime(
                                    int(year_str),
                                    month_map_abbr[month_str_abbr],
                                    int(day_str),
                                    int(time_part_str[0:2]),
                                    int(time_part_str[2:4]),
                                    int(time_part_str[4:6])
                                )
                            else:
                                logger.debug("Parser", "list_files", f"Could not parse date components from filename pattern 2: {filename} (date_str_part: {date_str_part}, time_part_str: {time_part_str})")

                except ValueError as date_e:
                    logger.debug("Parser", "list_files", f"Date parsing ValueError for {filename}: {date_e}")
                except Exception as date_e_gen: # Catch any other unexpected error during date parsing
                    logger.error("Parser", "list_files", f"Generic date parsing error for {filename}: {date_e_gen}")


                if time_obj:
                    create_date_str = time_obj.strftime("%Y/%m/%d")
                    create_time_str = time_obj.strftime("%H:%M:%S")
                else: # If time_obj is still None, log it
                    logger.warning("Parser", "list_files", f"Failed to parse date for filename: {filename}")


                # Duration calculation (seems mostly okay from jensen.js)
                if file_version == 1: duration_sec = (file_length_bytes / 32) * 2 
                elif file_version == 2: duration_sec = (file_length_bytes - 44) / (48000 * 2 * 1) if file_length_bytes > 44 else 0 
                elif file_version == 3: duration_sec = (file_length_bytes - 44) / (24000 * 2 * 1) if file_length_bytes > 44 else 0 # ADPCM example rate
                elif file_version == 5: duration_sec = file_length_bytes / 12000 
                else: duration_sec = file_length_bytes / (16000*2*1) # Default (16kHz, 16-bit, mono)

                files.append({
                    "name": filename, "createDate": create_date_str, "createTime": create_time_str,
                    "time": time_obj, "duration": duration_sec, "version": file_version,
                    "length": file_length_bytes, "signature": signature_hex
                })
                total_size_bytes += file_length_bytes
                parsed_file_count += 1
                # ... (rest of the loop remains the same)
                
                if total_files_from_header != -1 and parsed_file_count >= total_files_from_header: break
                if expected_files_from_count_cmd != -1 and parsed_file_count >= expected_files_from_count_cmd: break

            except struct.error as e:
                logger.error("Jensen", "list_files_parser", f"Struct error: {e}. Offset: {offset}, Buf len: {len(data_view)}")
                break
            except IndexError as e:
                logger.error("Jensen", "list_files_parser", f"Index error: {e}. Offset: {offset}, Buf len: {len(data_view)}")
                break
        
        logger.info("Jensen", "list_files", f"Parsed {len(files)} files from list.")
        valid_files = [f for f in files if f.get("time")]
        return {
            "files": valid_files,
            "totalFiles": len(valid_files),
            "totalSize": total_size_bytes # This is total size of all parsed files, not just valid ones by date
        }

    def stream_file(self, filename, file_length, data_callback, progress_callback=None, timeout_s=180, cancel_event: threading.Event = None):
        with self._usb_lock: # Acquire lock for the entire streaming operation
            status_to_return = "fail" # Default status, will be updated on success or specific failure types
            try:
                logger.info("Jensen", "stream_file", f"Streaming {filename}, length {file_length}")
                filename_bytes = filename.encode('ascii', errors='ignore')

                # Send initial command to start streaming
                initial_seq_id = self._send_command(CMD_TRANSFER_FILE, filename_bytes, timeout_ms=10000) # Use int for timeout
                
                if cancel_event and cancel_event.is_set():
                    logger.info("Jensen", "stream_file", f"Streaming cancelled for {filename} before receiving data.")
                    status_to_return = "cancelled"
                    return status_to_return # Exit early
                    
                bytes_received = 0
                start_time = time.time()
                
                while bytes_received < file_length and time.time() - start_time < timeout_s:
                    # For the first response, expect the initial_seq_id. For subsequent, expect CMD_TRANSFER_FILE.
                    current_expected_seq_id = initial_seq_id if bytes_received == 0 else None 
                    
                    if cancel_event and cancel_event.is_set():
                        logger.info("Jensen", "stream_file", f"Streaming cancelled for {filename} during data reception.")
                        status_to_return = "cancelled"
                        return status_to_return # Exit early

                    response = self._receive_response(
                        expected_seq_id=current_expected_seq_id if current_expected_seq_id else initial_seq_id, 
                        timeout_ms=15000, 
                        streaming_cmd_id=CMD_TRANSFER_FILE 
                    )

                    if response and response["id"] == CMD_TRANSFER_FILE:
                        chunk = response["body"]
                        if not chunk:
                            logger.warning("Jensen", "stream_file", "Received empty chunk during stream.")
                            if bytes_received >= file_length: break 
                            time.sleep(0.1) 
                            continue

                        bytes_received += len(chunk)
                        data_callback(chunk)
                        if progress_callback:
                            progress_callback(bytes_received, file_length)
                        
                        if bytes_received >= file_length:
                            if progress_callback: progress_callback(file_length, file_length)
                            logger.info("Jensen", "stream_file", f"File {filename} streamed successfully (received {bytes_received} of {file_length}).")
                            status_to_return = "OK"
                            break # Exit while loop
                    elif response is None:
                        logger.error("Jensen", "stream_file", f"Timeout or error receiving next chunk for {filename}. Received {bytes_received}/{file_length} so far.")
                        if not self.is_connected(): logger.error("Jensen", "stream_file", "Device appears disconnected.")
                        status_to_return = "fail"
                        break # Exit while loop
                    else: 
                        logger.warning("Jensen", "stream_file", f"Unexpected response ID {response['id']} during stream.")
                        status_to_return = "fail" 
                        break # Exit while loop

                # After the loop, check the final status if not already "OK" or "cancelled"
                if status_to_return == "fail" and bytes_received < file_length : 
                    logger.error("Jensen", "stream_file", f"Streaming incomplete for {filename}. Received {bytes_received}/{file_length} within timeout.")
                    if not self.is_connected():
                        status_to_return = "fail_disconnected"
                    elif cancel_event and cancel_event.is_set():
                         status_to_return = "cancelled"
                    # else status_to_return remains "fail" from loop exit
                elif status_to_return == "OK": # If loop completed successfully and set status_to_return to "OK"
                     logger.info("Jensen", "stream_file", f"File {filename} streaming finished (final check).")

            finally:
                # This block executes regardless of how the try block finishes (success, error, return).
                # It's crucial for cleanup actions that must happen while the lock is held.
                self.receive_buffer.clear()
                logger.debug("Jensen", "stream_file", "Python receive_buffer cleared after stream operation (within lock).")

                # Attempt to flush any lingering data from the hardware/OS input buffer if the operation
                # didn't complete successfully, as the device might still be sending data.
                if status_to_return != "OK" and self.device and self.ep_in:
                    logger.debug("Jensen", "stream_file", f"Attempting to flush stale IN endpoint data after stream status: {status_to_return}")
                    flush_attempts = 0
                    max_flush_attempts = 20 # e.g., 20 attempts * 50ms timeout = up to 1 second of flushing
                    while flush_attempts < max_flush_attempts:
                        try:
                            # Read a moderate chunk with a short timeout for each flush attempt.
                            read_size = self.ep_in.wMaxPacketSize * 16 if self.ep_in.wMaxPacketSize else 512 * 16
                            stale_data = self.device.read(self.ep_in.bEndpointAddress,
                                                          read_size,
                                                          timeout=50) # Short timeout (ms)
                            if stale_data:
                                logger.debug("Jensen", "stream_file", f"Flushed {len(stale_data)} bytes of stale data from USB pipe.")
                                # Data is read and discarded. Continue to see if there's more.
                            else:
                                # No data read in this attempt, pipe might be clear.
                                logger.debug("Jensen", "stream_file", "No stale data in this flush read, pipe may be clear.")
                                break
                        except usb.core.USBTimeoutError: # This is expected if the pipe is empty
                            logger.debug("Jensen", "stream_file", "USBTimeoutError during flush, pipe likely clear.")
                            break
                        except usb.core.USBError as e: # Other USB errors
                            logger.warning("Jensen", "stream_file", f"USBError during endpoint flush: {e}. Stopping flush.")
                            break # Stop flushing on other USB errors
                        flush_attempts += 1
                    if flush_attempts >= max_flush_attempts:
                        logger.debug("Jensen", "stream_file", "Reached max flush attempts for stale data.")
            return status_to_return # Return the determined status

    def delete_file(self, filename, timeout_s=10):
        logger.info("Jensen", "delete_file", f"Attempting to delete file: {filename}")
        filename_bytes = filename.encode('ascii', errors='ignore')
        response = self._send_and_receive(CMD_DELETE_FILE, filename_bytes, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_DELETE_FILE:
            # jensen.js handler: 0=success, 1=not-exists, 2=failed
            result_code = response["body"][0] if response["body"] else 2 # Default to failed if no body
            status_map = {0: "success", 1: "not-exists", 2: "failed"}
            status_str = status_map.get(result_code, "unknown_error")
            logger.info("Jensen", "delete_file", f"Delete status for {filename}: {status_str} (code: {result_code})")
            return {"result": status_str, "code": result_code}
        logger.error("Jensen", "delete_file", f"Failed to get delete response for {filename} or invalid response ID.")
        return {"result": "failed", "code": -1, "error": "No/invalid response"}

    def get_card_info(self, timeout_s=5):
        response = self._send_and_receive(CMD_GET_CARD_INFO, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_GET_CARD_INFO and len(response["body"]) >= 12:
            body = response["body"]
            used_space = struct.unpack('>I', body[0:4])[0]
            total_capacity = struct.unpack('>I', body[4:8])[0]
            status_code = struct.unpack('>I', body[8:12])[0] # Raw status code
            logger.info("Jensen", "get_card_info", f"Card Info: Used={used_space}, Total={total_capacity}, Status Code={hex(status_code)}")
            return {"used": used_space, "capacity": total_capacity, "status_raw": status_code}
        logger.error("Jensen", "get_card_info", "Failed to get card info or invalid response.")
        return None

    def format_card(self, timeout_s=60): # Formatting can take time
        logger.info("Jensen", "format_card", "Attempting to format card...")
        # Body [1,2,3,4] as per jensen.js
        response = self._send_and_receive(CMD_FORMAT_CARD, body_bytes=bytes([1,2,3,4]), timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_FORMAT_CARD:
            result_code = response["body"][0] if response["body"] else 1 # Default to failed
            status_str = "success" if result_code == 0 else "failed"
            logger.info("Jensen", "format_card", f"Format card status: {status_str} (code: {result_code})")
            return {"result": status_str, "code": result_code}
        logger.error("Jensen", "format_card", "Failed to get format card response or invalid response ID.")
        return {"result": "failed", "code": -1, "error": "No/invalid response"}

    def get_recording_file(self, timeout_s=5):
        logger.debug("Jensen", "get_recording_file", "Requesting current/last recording file...") # Changed to debug
        response = self._send_and_receive(CMD_GET_RECORDING_FILE, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_GET_RECORDING_FILE:
            if not response["body"]: # No active recording or last recording info
                logger.debug("Jensen", "get_recording_file", "No recording file info returned (empty body). Device might not be recording.") # Changed to debug
                return None

            filename_bytes = response["body"]
            filename = ""
            try:
                # jensen.js simply joins char codes. We should filter for printable and stop at null.
                printable_bytes = bytearray()
                for b_val in filename_bytes:
                    if 32 <= b_val <= 126: # Printable ASCII
                        printable_bytes.append(b_val)
                    elif b_val == 0: # Stop at first null
                        break
                filename = printable_bytes.decode('ascii').strip()
            except UnicodeDecodeError:
                filename = filename_bytes.hex() # Fallback to hex
                logger.warning("Jensen", "get_recording_file", f"Could not decode recording filename as ASCII: {filename_bytes.hex()}")

            if not filename:
                 logger.info("Jensen", "get_recording_file", "Decoded recording filename is empty.")
                 return None

            # TODO: Parse date/time from filename if needed, similar to list_files or jensen.js s.handlers[18]
            logger.debug("Jensen", "get_recording_file", f"Current/Last recording file: {filename}") # Changed to debug
            return {"name": filename, "status": "recording_active_or_last"} # Placeholder status
        
        logger.error("Jensen", "get_recording_file", "Failed to get recording file info or invalid response ID.")
        return None

    def _to_bcd(self, value: int) -> int:
        """Converts a 2-digit integer to BCD."""
        if not (0 <= value <= 99):
            # logger.warning("Jensen", "_to_bcd", f"Value {value} out of BCD range (0-99). Returning 0.")
            return 0 # Or raise error
        return (value // 10 << 4) | (value % 10)

    def set_device_time(self, dt_object: datetime, timeout_s=5):
        logger.info("Jensen", "set_device_time", f"Setting device time to: {dt_object.strftime('%Y-%m-%d %H:%M:%S')}")
        year_full = dt_object.year
        # Split the full year into century and year-of-century for BCD conversion
        # e.g., 2025 -> bcd_20, bcd_25
        payload = bytes([
            self._to_bcd(year_full // 100),    # BCD for century part (e.g., 20)
            self._to_bcd(year_full % 100),     # BCD for year-of-century part (e.g., 25)
            self._to_bcd(dt_object.month),
            self._to_bcd(dt_object.day),
            self._to_bcd(dt_object.hour),
            self._to_bcd(dt_object.minute),
            self._to_bcd(dt_object.second)     # This creates a 7-byte payload
        ])
        response = self._send_and_receive(CMD_SET_DEVICE_TIME, payload, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_SET_DEVICE_TIME and response["body"] and response["body"][0] == 0:
            logger.info("Jensen", "set_device_time", "Device time set successfully.")
            return {"result": "success"}
        
        device_error_code = response["body"][0] if response and response["body"] else -1 # -1 if no body/response
        logger.error("Jensen", "set_device_time", f"Failed to set device time. Device returned code: {device_error_code}. Full response: {response}")
        return {"result": "failed", "error": "Device reported an error.", "device_code": device_error_code}

    def get_device_settings(self, timeout_s=5):
        logger.info("Jensen", "get_device_settings", "Requesting device behavior settings...")
        response = self._send_and_receive(CMD_GET_SETTINGS, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_GET_SETTINGS and len(response["body"]) >= 4:
            body = response["body"]
            settings = {
                "autoRecord": bool(body[0]),
                "autoPlay": bool(body[1]),
                "bluetoothTone": bool(body[2]),
                "notificationSound": bool(body[3])
                # Add more if other models/firmwares support them and indices are known
            }
            self.device_behavior_settings.update(settings) # Cache them
            logger.info("Jensen", "get_device_settings", f"Received device settings: {settings}")
            return settings
        logger.error("Jensen", "get_device_settings", f"Failed to get device settings. Response: {response}")
        return None

    def set_device_setting(self, setting_name: str, value: bool, timeout_s=5):
        logger.info("Jensen", "set_device_setting", f"Setting '{setting_name}' to {value}")
        setting_map = {
            "autoRecord": 0,
            "autoPlay": 1,
            "bluetoothTone": 2,
            "notificationSound": 3
        }
        if setting_name not in setting_map:
            logger.error("Jensen", "set_device_setting", f"Unknown setting name: {setting_name}")
            return {"result": "failed", "error": "Unknown setting name"}

        payload = bytes([setting_map[setting_name], 1 if value else 0])
        response = self._send_and_receive(CMD_SET_SETTINGS, payload, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_SET_SETTINGS and response["body"] and response["body"][0] == 0:
            logger.info("Jensen", "set_device_setting", f"Successfully set '{setting_name}' to {value}.")
            self.device_behavior_settings[setting_name] = value # Update cache
            return {"result": "success"}
        logger.error("Jensen", "set_device_setting", f"Failed to set '{setting_name}'. Response: {response}")
        return {"result": "failed", "error": "Invalid response or error code from device."}
# --- Tkinter GUI Application ---
class HiDockToolGUI:
    def __init__(self, master):
        self.master = master
        master.title("HiDock Explorer Tool")
        master.geometry("800x700")

        self.dock = HiDockJensen()
        self.config = load_config()
        self.autoconnect_var = tk.BooleanVar(value=self.config.get("autoconnect", False))
        self.download_directory = self.config.get("download_directory", os.getcwd())

        # Initialize new config variables for settings
        self.log_level_var = tk.StringVar(value=self.config.get("log_level", "INFO"))
        self.selected_vid_var = tk.IntVar(value=self.config.get("selected_vid", DEFAULT_VENDOR_ID))
        self.selected_pid_var = tk.IntVar(value=self.config.get("selected_pid", DEFAULT_PRODUCT_ID))
        self.target_interface_var = tk.IntVar(value=self.config.get("target_interface", 0))
        self.recording_check_interval_var = tk.IntVar(value=self.config.get("recording_check_interval_s", 3))
        self.default_command_timeout_ms_var = tk.IntVar(value=self.config.get("default_command_timeout_ms", 5000))
        self.file_stream_timeout_s_var = tk.IntVar(value=self.config.get("file_stream_timeout_s", 180))
        self.auto_refresh_files_var = tk.BooleanVar(value=self.config.get("auto_refresh_files", False))
        self.auto_refresh_interval_s_var = tk.IntVar(value=self.config.get("auto_refresh_interval_s", 30))
        self.quit_without_prompt_var = tk.BooleanVar(value=self.config.get("quit_without_prompt_if_connected", False))
        self.theme_var = tk.StringVar(value=self.config.get("theme", "default"))
        self.available_usb_devices = [] # To store (description, vid, pid) tuples

        self.displayed_files_details = [] # To store full details of files in listbox
        self.active_download_threads = 0
        self.logs_visible = False # State for log visibility
        self.treeview_sort_column = None
        self.device_tools_visible = False # New state for device tools visibility
        self._recording_check_timer_id = None # Timer for periodic recording check
        self.original_tree_headings = { # Store original heading texts for sort indicators
            "name": "Name",
            "size": "Size (KB)",
            "duration": "Duration (s)",
            "date": "Date",
            "time": "Time"
        }
        # Variables for device behavior settings in the Settings window
        self.device_setting_auto_record_var = tk.BooleanVar()
        self.device_setting_auto_play_var = tk.BooleanVar()
        self.device_setting_bluetooth_tone_var = tk.BooleanVar()
        self.device_setting_notification_sound_var = tk.BooleanVar()
        self._fetched_device_settings_for_dialog = {} # To store settings loaded when dialog opens

        self._is_ui_refresh_in_progress = False # Flag to prevent overlapping UI refreshes
        self._previous_recording_filename = None # Store the last known recording filename
        self.treeview_sort_reverse = False
        self._auto_file_refresh_timer_id = None
        
        # For settings window device list
        self.settings_device_combobox = None

        # Audio playback attributes
        self.is_audio_playing = False
        self.current_playing_temp_file = None
        self.playback_update_timer_id = None
        self.loop_playback_var = tk.BooleanVar(value=False)
        self.volume_var = tk.DoubleVar(value=0.5) # Default volume 50%
        self.playback_total_duration = 0
        self.current_playing_filename_for_replay = None # Stores name of file whose temp file is loaded
        self.playback_seek_offset = 0.0 # To track seek position for get_pos()
        self.latest_slider_value_from_command = 0.0 # Store value from slider's command
        if pygame:
            pygame.mixer.init() # Initialize the mixer
        
        self.cancel_operation_event = None # For cancelling downloads/playback prep
        self.is_long_operation_active = False # To pause background checks
        
        # Configure logger to output to GUI
        logger.set_level(self.log_level_var.get()) # Ensure logger uses the loaded config level
        logger.set_gui_log_callback(self.log_to_gui_widget) # Logger will now pass (message, level_name)

        # Apply initial theme before creating widgets
        self.apply_theme(self.theme_var.get())

        self.create_widgets()
        self.master.protocol("WM_DELETE_WINDOW", self.on_closing)

        if self.autoconnect_var.get():
            self.master.after(500, self.attempt_autoconnect_on_startup) # Delay slightly

    def apply_theme(self, theme_name):
        try:
            style = ttk.Style(self.master)
            available_themes = style.theme_names()
            if theme_name in available_themes:
                style.theme_use(theme_name)
                logger.info("GUI", "apply_theme", f"Theme set to '{theme_name}'.")
            else: # Fallback to default if chosen theme is not available
                style.theme_use("default") # Or another sensible default like 'clam'
                logger.warning("GUI", "apply_theme", f"Theme '{theme_name}' not available. Fell back to 'default'. Available: {available_themes}")
        except Exception as e:
            logger.error("GUI", "apply_theme", f"Error applying theme '{theme_name}': {e}")

    def create_widgets(self):
        # Top frame for connection and general controls
        top_frame = ttk.Frame(self.master, padding="10")
        top_frame.pack(fill=tk.X)

        self.connect_button = ttk.Button(top_frame, text="🔌 Connect to HiDock", command=self.connect_device)
        self.connect_button.pack(side=tk.LEFT, padx=5)

        self.settings_button = ttk.Button(top_frame, text="⚙️ Settings", command=self.open_settings_window)
        self.settings_button.pack(side=tk.LEFT, padx=5)

        self.disconnect_button = ttk.Button(top_frame, text="❌ Disconnect", command=self.disconnect_device, state=tk.DISABLED)
        self.disconnect_button.pack(side=tk.LEFT, padx=5)

        self.status_label = ttk.Label(top_frame, text="Status: Disconnected")
        self.status_label.pack(side=tk.LEFT, padx=5)

        # Frame for file listing
        files_frame = ttk.LabelFrame(self.master, text="📄 Available Files", padding="10")
        files_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)
        
        # Files info bar
        files_info_frame = ttk.Frame(files_frame)
        files_info_frame.pack(fill=tk.X, pady=(0,5))
        self.total_files_label = ttk.Label(files_info_frame, text="Total: 0 files, 0.00 MB")
        self.total_files_label.pack(side=tk.LEFT, padx=5)
        self.selected_files_label = ttk.Label(files_info_frame, text="Selected: 0 files, 0.00 MB") # Keep this as is or adjust if needed
        self.selected_files_label.pack(side=tk.LEFT, padx=10) 
        # self.recording_status_label = ttk.Label(top_frame, text="Recording: N/A") # REMOVED - Will integrate into file list
        # self.recording_status_label.pack(side=tk.LEFT, padx=10, after=self.status_label)
        self.card_info_label = ttk.Label(files_info_frame, text="Storage: --- / --- MB (Status: ---)")
        self.card_info_label.pack(side=tk.RIGHT, padx=5)

        self.refresh_files_button = ttk.Button(files_frame, text="🔄 Refresh File List", command=self.refresh_file_list_gui, state=tk.DISABLED)
        self.refresh_files_button.pack(pady=5)

        # Treeview for files
        tree_frame = ttk.Frame(files_frame)
        tree_frame.pack(fill=tk.BOTH, expand=True)

        columns = ("name", "size", "duration", "date", "time")
        self.file_tree = ttk.Treeview(tree_frame, columns=columns, show="headings", selectmode="extended")
        
        self.file_tree.heading("name", text=self.original_tree_headings["name"], command=lambda: self.sort_treeview_column("name", False))
        self.file_tree.column("name", width=250, minwidth=150, stretch=tk.YES)
        
        self.file_tree.heading("size", text=self.original_tree_headings["size"], command=lambda: self.sort_treeview_column("size", True))
        self.file_tree.column("size", width=80, minwidth=60, anchor=tk.E)
        
        self.file_tree.heading("duration", text=self.original_tree_headings["duration"], command=lambda: self.sort_treeview_column("duration", True))
        self.file_tree.column("duration", width=80, minwidth=60, anchor=tk.E)
        
        self.file_tree.heading("date", text=self.original_tree_headings["date"], command=lambda: self.sort_treeview_column("date", False))
        self.file_tree.column("date", width=100, minwidth=80, anchor=tk.CENTER)
        
        self.file_tree.heading("time", text=self.original_tree_headings["time"], command=lambda: self.sort_treeview_column("time", False))
        self.file_tree.column("time", width=80, minwidth=70, anchor=tk.CENTER)



        self.file_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar = ttk.Scrollbar(tree_frame, orient=tk.VERTICAL, command=self.file_tree.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        # Configure tags for downloaded and recording files
        self.file_tree.tag_configure('downloaded', foreground='blue')
        self.file_tree.tag_configure('recording', foreground='red', font=('TkDefaultFont', 9, 'bold'))
        self.file_tree.config(yscrollcommand=scrollbar.set)
        self.file_tree.bind("<<TreeviewSelect>>", self.on_file_selection_change)

        # Frame for download controls
        # Download directory selection button moved to settings. Label remains here.
        download_controls_frame = ttk.Frame(self.master, padding="5 10 5 10") # Adjusted padding
        download_controls_frame.pack(fill=tk.X, side=tk.BOTTOM, anchor=tk.SW) # Move below progress bar

        self.download_dir_label = ttk.Label(download_controls_frame, text=f"Dir: {self.download_directory}")
        self.download_dir_label.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        self.delete_button = ttk.Button(download_controls_frame, text="🗑️ Delete Selected", command=self.delete_selected_files_gui, state=tk.DISABLED)
        self.delete_button.pack(side=tk.RIGHT, padx=5)

        self.play_button = ttk.Button(download_controls_frame, text="▶️ Play Selected", command=self.play_selected_audio_gui, state=tk.DISABLED)
        self.play_button.pack(side=tk.RIGHT, padx=5)

        self.download_button = ttk.Button(download_controls_frame, text="💾 Download Selected", command=self.download_selected_files_gui, state=tk.DISABLED)
        self.download_button.pack(side=tk.RIGHT, padx=5)

        self.cancel_button = ttk.Button(download_controls_frame, text="🚫 Cancel Op", command=self.request_cancel_operation, state=tk.DISABLED)
        self.cancel_button.pack(side=tk.RIGHT, padx=5)
        
        # Device Tools Frame
        self.device_tools_frame = ttk.LabelFrame(self.master, text="🛠️ Device Tools", padding="5")
        # self.device_tools_frame will be packed/unpacked by toggle_device_tools, packed before log toggles
        self.format_card_button = ttk.Button(self.device_tools_frame, text="⚠️ Format Storage", command=self.format_sd_card_gui, state=tk.DISABLED)
        self.format_card_button.pack(side=tk.LEFT, padx=5)
        
        self.sync_time_button = ttk.Button(self.device_tools_frame, text="🕒 Sync Device Time", command=self.sync_device_time_gui, state=tk.DISABLED)
        self.sync_time_button.pack(side=tk.LEFT, padx=5)

        # Progress Bar
        progress_frame = ttk.Frame(self.master, padding="5")
        progress_frame.pack(fill=tk.X)
        self.overall_progress_label = ttk.Label(progress_frame, text="Download Progress:")
        self.overall_progress_label.pack(side=tk.LEFT, padx=5)
        self.file_progress_bar = ttk.Progressbar(progress_frame, orient=tk.HORIZONTAL, length=300, mode='determinate')
        self.file_progress_bar.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)

        # Log toggle button
        controls_toggle_frame = ttk.Frame(self.master, padding="5 10 5 10") # Frame for toggle buttons
        self.controls_toggle_frame = controls_toggle_frame # Assign to self
        self.controls_toggle_frame.pack(fill=tk.X, side=tk.BOTTOM, anchor=tk.SW)
        self.log_toggle_button = ttk.Button(self.controls_toggle_frame, text="📜 Show Logs", command=self.toggle_logs)
        self.log_toggle_button.pack(side=tk.LEFT)
        self.device_tools_toggle_button = ttk.Button(self.controls_toggle_frame, text="🛠️ Show Device Tools", command=self.toggle_device_tools)
        self.device_tools_toggle_button.pack(side=tk.LEFT, padx=5)

        # Log area - initially not packed, will be packed above toggle buttons
        self.log_frame = ttk.LabelFrame(self.master, text="Logs", padding="10")

        # Create a sub-frame for log controls (clear button, level dropdown)
        log_controls_sub_frame = ttk.Frame(self.log_frame)
        log_controls_sub_frame.pack(fill=tk.X, pady=(0, 5)) # Pack at the top of log_frame

        self.clear_log_button = ttk.Button(log_controls_sub_frame, text="Clear Log", command=self.clear_log_gui)
        self.clear_log_button.pack(side=tk.LEFT, padx=(0, 10))

        ttk.Label(log_controls_sub_frame, text="Log Level:").pack(side=tk.LEFT, padx=(0, 5))
        self.log_section_level_combo = ttk.Combobox(
            log_controls_sub_frame, 
            textvariable=self.log_level_var, 
            values=list(Logger.LEVELS.keys()), 
            state="readonly",
            width=10
        )
        self.log_section_level_combo.pack(side=tk.LEFT)
        self.log_section_level_combo.bind("<<ComboboxSelected>>", self.on_log_level_change_gui)

        self.log_text_area = tk.Text(self.log_frame, height=10, state='disabled', wrap=tk.WORD)
        log_scrollbar = ttk.Scrollbar(self.log_frame, orient=tk.VERTICAL, command=self.log_text_area.yview)
        self.log_text_area.config(yscrollcommand=log_scrollbar.set)
        
        # Configure tags for log message colors
        self.log_text_area.tag_configure("ERROR", background="#FFC0CB", foreground="black") # Light Pink
        self.log_text_area.tag_configure("WARNING", background="#FFFFE0", foreground="black") # Light Yellow
        self.log_text_area.tag_configure("INFO", background="white", foreground="black") # Or system default
        self.log_text_area.tag_configure("DEBUG", background="#E0FFFF", foreground="black") # Light Cyan
        self.log_text_area.tag_configure("CRITICAL", background="#FF6347", foreground="white") # Tomato Red
        log_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.log_text_area.pack(fill=tk.BOTH, expand=True) 
        # Playback Controls Frame will be created after controls_toggle_frame

    def open_settings_window(self):
        settings_win = tk.Toplevel(self.master)
        settings_win.title("Application Settings")
        settings_win.geometry("450x900") # Increased height slightly for better initial fit
        settings_win.minsize(450, 670) # Prevent shrinking vertically from initial size
        settings_win.transient(self.master) # Keep on top of main window
        settings_win.grab_set() # Modal behavior

        # Store initial state for cancel
        initial_config_vars = {
            "autoconnect": self.autoconnect_var.get(),
            "log_level": self.log_level_var.get(),
            "selected_vid": self.selected_vid_var.get(),
            "selected_pid": self.selected_pid_var.get(),
            "target_interface": self.target_interface_var.get(),
            "recording_check_interval_s": self.recording_check_interval_var.get(),
            "default_command_timeout_ms": self.default_command_timeout_ms_var.get(),
            "file_stream_timeout_s": self.file_stream_timeout_s_var.get(),
            "auto_refresh_files": self.auto_refresh_files_var.get(),
            "auto_refresh_interval_s": self.auto_refresh_interval_s_var.get(),
            "quit_without_prompt_if_connected": self.quit_without_prompt_var.get(),
            "theme": self.theme_var.get()
        }
        initial_log_level = self.log_level_var.get()
        initial_selected_vid = self.selected_vid_var.get()
        initial_selected_pid = self.selected_pid_var.get()
        initial_target_interface = self.target_interface_var.get()
        initial_recording_check_interval = self.recording_check_interval_var.get()
        initial_default_cmd_timeout = self.default_command_timeout_ms_var.get()
        initial_file_stream_timeout = self.file_stream_timeout_s_var.get()
        initial_auto_refresh_files = self.auto_refresh_files_var.get()
        initial_auto_refresh_interval = self.auto_refresh_interval_s_var.get()
        initial_quit_without_prompt = self.quit_without_prompt_var.get()
        initial_theme = self.theme_var.get() # Already captured in initial_config_vars
        initial_download_directory = self.download_directory # String, not a tk.Var
        
        # Store initial state of device behavior vars (what's currently in UI)
        initial_device_settings_ui_state = {
            "autoRecord": self.device_setting_auto_record_var.get(),
            "autoPlay": self.device_setting_auto_play_var.get(),
            "bluetoothTone": self.device_setting_bluetooth_tone_var.get(),
            "notificationSound": self.device_setting_notification_sound_var.get()}

        # --- State tracking for changes ---
        settings_changed_tracker = [False] # Use a list to pass by reference for modification
        # Temporary storage for download directory changes within this dialog session
        current_dialog_download_dir = [self.download_directory] 

        settings_frame = ttk.Frame(settings_win, padding="10")
        settings_frame.pack(fill=tk.BOTH, expand=True)

        # --- USB Device Selection ---
        device_selection_frame = ttk.LabelFrame(settings_frame, text="USB Device Selection", padding="5")
        device_selection_frame.pack(fill=tk.X, pady=5)

        self.settings_device_combobox = ttk.Combobox(device_selection_frame, state="readonly", width=50) # Reduced width
        self.settings_device_combobox.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0,5)) # Allow combobox to expand
        
        scan_button = ttk.Button(device_selection_frame, text="Scan", command=lambda: self.scan_usb_devices_for_settings(settings_win))
        scan_button.pack(side=tk.LEFT, padx=5) # Add some padding
        
        # Populate initially
        self.scan_usb_devices_for_settings(settings_win, initial_load=True)

        def on_device_selected(event):
            selection = self.settings_device_combobox.get()
            if not selection or selection == "--- Devices with Issues ---": # Ignore separator
                return
            # Find the (desc, vid, pid) tuple from self.available_usb_devices
            selected_device_info = next((dev for dev in self.available_usb_devices if dev[0] == selection), None)
            if selected_device_info:
                _, vid, pid = selected_device_info
                self.selected_vid_var.set(vid)
                self.selected_pid_var.set(pid)
                logger.debug("Settings", "on_device_selected", f"Selected device in settings: VID={hex(vid)}, PID={hex(pid)}")
            else:
                logger.warning("Settings", "on_device_selected", f"Could not find details for selection: '{selection}' in self.available_usb_devices. This might be a separator or an unhandled case.")

        self.settings_device_combobox.bind("<<ComboboxSelected>>", on_device_selected)

        # --- Connection Settings ---
        connection_settings_frame = ttk.LabelFrame(settings_frame, text="Connection Settings", padding="5")
        connection_settings_frame.pack(fill=tk.X, pady=5)

        autoconnect_checkbutton = ttk.Checkbutton(connection_settings_frame, text="Autoconnect on startup", variable=self.autoconnect_var)
        autoconnect_checkbutton.pack(pady=10, anchor=tk.W)

        ttk.Label(connection_settings_frame, text="Target USB Interface Number:").pack(anchor=tk.W, pady=(5,0))
        target_interface_spinbox = ttk.Spinbox(connection_settings_frame, from_=0, to=10, textvariable=self.target_interface_var, width=5)
        target_interface_spinbox.pack(anchor=tk.W, pady=2)

        # --- Appearance Settings (Moved here) ---
        appearance_settings_frame = ttk.LabelFrame(settings_frame, text="Appearance", padding="5")
        appearance_settings_frame.pack(fill=tk.X, pady=5)
        ttk.Label(appearance_settings_frame, text="Application Theme:").pack(anchor=tk.W, pady=(5,0))
        available_themes = sorted(ttk.Style().theme_names())
        if self.theme_var.get() not in available_themes and self.theme_var.get() != "default": # Ensure current theme is selectable
            available_themes.insert(0, self.theme_var.get())
        theme_combo = ttk.Combobox(appearance_settings_frame, textvariable=self.theme_var, values=available_themes, state="readonly")
        theme_combo.pack(fill=tk.X, pady=2)

        # --- Operational Settings ---
        operational_settings_frame = ttk.LabelFrame(settings_frame, text="Operational Settings", padding="5")
        operational_settings_frame.pack(fill=tk.X, pady=5)

        ttk.Label(operational_settings_frame, text="Log Level:").pack(anchor=tk.W, pady=(5,0))
        log_level_combo = ttk.Combobox(operational_settings_frame, textvariable=self.log_level_var, values=list(Logger.LEVELS.keys()), state="readonly")
        log_level_combo.pack(fill=tk.X, pady=2)

        ttk.Label(operational_settings_frame, text="Recording Status Check Interval (seconds):").pack(anchor=tk.W, pady=(5,0))
        recording_interval_spinbox = ttk.Spinbox(operational_settings_frame, from_=1, to=60, textvariable=self.recording_check_interval_var, width=5)
        recording_interval_spinbox.pack(anchor=tk.W, pady=2)

        ttk.Label(operational_settings_frame, text="Default Command Timeout (ms):").pack(anchor=tk.W, pady=(5,0))
        cmd_timeout_spinbox = ttk.Spinbox(operational_settings_frame, from_=500, to=30000, increment=100, textvariable=self.default_command_timeout_ms_var, width=8)
        cmd_timeout_spinbox.pack(anchor=tk.W, pady=2)

        ttk.Label(operational_settings_frame, text="File Streaming Timeout (seconds):").pack(anchor=tk.W, pady=(5,0))
        stream_timeout_spinbox = ttk.Spinbox(operational_settings_frame, from_=30, to=600, increment=10, textvariable=self.file_stream_timeout_s_var, width=8)
        stream_timeout_spinbox.pack(anchor=tk.W, pady=2)

        auto_refresh_check = ttk.Checkbutton(operational_settings_frame, text="Automatically refresh file list when connected", variable=self.auto_refresh_files_var)
        auto_refresh_check.pack(anchor=tk.W, pady=(5,0))
        ttk.Label(operational_settings_frame, text="Auto Refresh Interval (seconds):").pack(anchor=tk.W, pady=(0,0))
        auto_refresh_interval_spinbox = ttk.Spinbox(operational_settings_frame, from_=5, to=300, increment=5, textvariable=self.auto_refresh_interval_s_var, width=5)
        auto_refresh_interval_spinbox.pack(anchor=tk.W, pady=2)

        quit_checkbutton = ttk.Checkbutton(operational_settings_frame, text="Quit without confirmation if device is connected", variable=self.quit_without_prompt_var)
        quit_checkbutton.pack(anchor=tk.W, pady=(5,0))

        # --- Download Settings ---
        download_settings_frame = ttk.LabelFrame(settings_frame, text="Download Settings", padding="5")
        download_settings_frame.pack(fill=tk.X, pady=5)

        # Frame to hold the label and buttons in one row
        dir_buttons_frame = ttk.Frame(download_settings_frame)
        dir_buttons_frame.pack(fill=tk.X, pady=(0,5))

        current_dl_dir_label_settings = ttk.Label(download_settings_frame, text=self.download_directory, relief="sunken", padding=2, wraplength=380)
        current_dl_dir_label_settings.pack(fill=tk.X, pady=2, side=tk.TOP)

        # Forward declare buttons for callbacks
        apply_button = ttk.Button(None) # Dummy, will be replaced
        cancel_close_button = ttk.Button(None) # Dummy, will be replaced

        select_dir_button_settings = ttk.Button(
            dir_buttons_frame, 
            text="Select Download Directory...", 
            command=lambda: self._select_download_dir_for_settings(current_dl_dir_label_settings, current_dialog_download_dir, settings_changed_tracker, apply_button, cancel_close_button)
        )
        select_dir_button_settings.pack(side=tk.LEFT, pady=(5,0))
        reset_dir_button = ttk.Button(dir_buttons_frame, text="Reset to App Folder",
                                      command=lambda: self._reset_download_dir_for_settings(current_dl_dir_label_settings, current_dialog_download_dir, settings_changed_tracker, apply_button, cancel_close_button))
        reset_dir_button.pack(side=tk.LEFT, padx=5, pady=(5,0))

        # --- Device Behavior Settings ---
        device_behavior_frame = ttk.LabelFrame(settings_frame, text="Device Behavior Settings", padding="5")
        device_behavior_frame.pack(fill=tk.X, pady=5)

        self.auto_record_checkbox = ttk.Checkbutton(device_behavior_frame, text="Auto Record on Power On", variable=self.device_setting_auto_record_var, state=tk.DISABLED)
        self.auto_record_checkbox.pack(anchor=tk.W)
        self.auto_play_checkbox = ttk.Checkbutton(device_behavior_frame, text="Auto Play on Insert (if applicable)", variable=self.device_setting_auto_play_var, state=tk.DISABLED)
        self.auto_play_checkbox.pack(anchor=tk.W)
        self.bt_tone_checkbox = ttk.Checkbutton(device_behavior_frame, text="Bluetooth Connection Tones", variable=self.device_setting_bluetooth_tone_var, state=tk.DISABLED)
        self.bt_tone_checkbox.pack(anchor=tk.W)
        self.notification_sound_checkbox = ttk.Checkbutton(device_behavior_frame, text="Notification Sounds", variable=self.device_setting_notification_sound_var, state=tk.DISABLED)
        self.notification_sound_checkbox.pack(anchor=tk.W)

        # Load device settings if connected
        if self.dock.is_connected():
            # Checkboxes will be enabled once settings are loaded by the thread
            threading.Thread(target=self._load_device_settings_for_dialog, 
                             args=(settings_win,), # Pass window for context if needed for messagebox
                             daemon=True).start()
        else:
            # Checkboxes remain disabled, implying connection is needed.
            pass 

        # --- Action Buttons (OK, Apply, Cancel/Close) ---
        buttons_frame = ttk.Frame(settings_frame)
        buttons_frame.pack(fill=tk.X, pady=10, side=tk.BOTTOM)

        action_buttons_subframe = ttk.Frame(buttons_frame)
        action_buttons_subframe.pack(side=tk.RIGHT)

        ok_button = ttk.Button(action_buttons_subframe, text="OK")
        # apply_button and cancel_close_button were forward-declared for download dir callbacks
        apply_button.master = action_buttons_subframe # Set actual master
        apply_button.config(text="Apply", state=tk.DISABLED)
        cancel_close_button.master = action_buttons_subframe # Set actual master
        cancel_close_button.config(text="Close")

        # --- Helper to update button states on any setting change ---
        def _update_button_states_on_change(*args): # *args for trace callback
            if not settings_changed_tracker[0]: # Only update if not already marked
                settings_changed_tracker[0] = True
                if apply_button.winfo_exists(): apply_button.config(state=tk.NORMAL)
                if cancel_close_button.winfo_exists(): cancel_close_button.config(text="Cancel")

        # --- Trace changes for tk.Variables ---
        vars_to_trace = [
            self.autoconnect_var, self.log_level_var, self.selected_vid_var, self.selected_pid_var,
            self.target_interface_var, self.recording_check_interval_var,
            self.default_command_timeout_ms_var, self.file_stream_timeout_s_var,
            self.auto_refresh_files_var, self.auto_refresh_interval_s_var,
            self.quit_without_prompt_var, self.theme_var,
            self.device_setting_auto_record_var, self.device_setting_auto_play_var,
            self.device_setting_bluetooth_tone_var, self.device_setting_notification_sound_var
        ]
        for var_to_trace in vars_to_trace:
            var_to_trace.trace_add('write', _update_button_states_on_change)

        # --- Core logic for applying settings ---
        def _perform_apply_settings_logic(update_dialog_baseline=False):
            nonlocal initial_download_directory # To modify the outer scope's variable if baseline is updated

            # 1. Update self.config and self attributes from current UI values
            for key in initial_config_vars: # Iterate through keys of original dict
                var_attr = getattr(self, f"{key}_var", None) # e.g., self.autoconnect_var
                if var_attr:
                    self.config[key] = var_attr.get()
            
            self.download_directory = current_dialog_download_dir[0] # Update actual from dialog's temp
            self.config["download_directory"] = self.download_directory

            # Apply device behavior settings
            if self.dock.is_connected() and self._fetched_device_settings_for_dialog:
                changed_device_settings = {}
                # Compare against the state when dialog opened OR last apply
                baseline_auto_record = self._fetched_device_settings_for_dialog.get("autoRecord")
                if self.device_setting_auto_record_var.get() != baseline_auto_record:
                    changed_device_settings["autoRecord"] = self.device_setting_auto_record_var.get()
                
                baseline_auto_play = self._fetched_device_settings_for_dialog.get("autoPlay")
                if self.device_setting_auto_play_var.get() != baseline_auto_play:
                    changed_device_settings["autoPlay"] = self.device_setting_auto_play_var.get()

                baseline_bt_tone = self._fetched_device_settings_for_dialog.get("bluetoothTone")
                if self.device_setting_bluetooth_tone_var.get() != baseline_bt_tone:
                    changed_device_settings["bluetoothTone"] = self.device_setting_bluetooth_tone_var.get()

                baseline_notif_sound = self._fetched_device_settings_for_dialog.get("notificationSound")
                if self.device_setting_notification_sound_var.get() != baseline_notif_sound:
                    changed_device_settings["notificationSound"] = self.device_setting_notification_sound_var.get()
                
                if changed_device_settings:
                    threading.Thread(target=self._apply_device_settings_thread, args=(changed_device_settings,), daemon=True).start()
            
            save_config(self.config)

            # Apply settings that have immediate effect
            logger.set_level(self.log_level_var.get())
            self.apply_theme(self.theme_var.get()) # Apply theme change
            if hasattr(self, 'download_dir_label') and self.download_dir_label.winfo_exists():
                self.download_dir_label.config(text=f"Dir: {self.download_directory}")

            if self.dock.is_connected(): 
                self.start_recording_status_check() # Restart with new interval
                self.start_auto_file_refresh_periodic_check() # Restart with new interval/state

            logger.info("GUI", "apply_settings_action", "Settings applied and saved.")

            if update_dialog_baseline:
                # Current UI state becomes the new baseline for this dialog session
                for key in initial_config_vars:
                    var_attr = getattr(self, f"{key}_var", None)
                    if var_attr: initial_config_vars[key] = var_attr.get()
                
                initial_download_directory = current_dialog_download_dir[0]
                
                # Update baseline for device settings if they were applied
                # self._fetched_device_settings_for_dialog should be updated by _apply_device_settings_thread
                # or we can update it here based on the UI vars.
                # Or, more directly:
                if self._fetched_device_settings_for_dialog: # Ensure it's not empty
                    self._fetched_device_settings_for_dialog["autoRecord"] = self.device_setting_auto_record_var.get()
                    self._fetched_device_settings_for_dialog["autoPlay"] = self.device_setting_auto_play_var.get()
                    self._fetched_device_settings_for_dialog["bluetoothTone"] = self.device_setting_bluetooth_tone_var.get()
                    self._fetched_device_settings_for_dialog["notificationSound"] = self.device_setting_notification_sound_var.get()

        # --- Button Action Implementations ---
        def ok_action():
            if settings_changed_tracker[0]:
                _perform_apply_settings_logic(update_dialog_baseline=False)
            settings_win.destroy()

        def apply_action_ui_handler(): # Renamed to avoid conflict
            if settings_changed_tracker[0]:
                _perform_apply_settings_logic(update_dialog_baseline=True)
                settings_changed_tracker[0] = False # Reset changed flag
                if apply_button.winfo_exists(): apply_button.config(state=tk.DISABLED)
                if cancel_close_button.winfo_exists(): cancel_close_button.config(text="Close")

        def cancel_close_action():
            if settings_changed_tracker[0]: # If "Cancel" was clicked
                # Revert all tk.Variables to their initial states from dialog open/last apply
                for key, initial_value in initial_config_vars.items():
                    var_attr = getattr(self, f"{key}_var", None)
                    if var_attr: var_attr.set(initial_value)
                
                # Revert download directory in dialog and its label
                current_dialog_download_dir[0] = initial_download_directory
                if current_dl_dir_label_settings.winfo_exists():
                    current_dl_dir_label_settings.config(text=current_dialog_download_dir[0])
            
                # Revert device behavior vars to their state when dialog opened / last apply
                if self._fetched_device_settings_for_dialog: # Ensure it's not empty
                    self.device_setting_auto_record_var.set(self._fetched_device_settings_for_dialog.get("autoRecord", False))
                    self.device_setting_auto_play_var.set(self._fetched_device_settings_for_dialog.get("autoPlay", False))
                    self.device_setting_bluetooth_tone_var.set(self._fetched_device_settings_for_dialog.get("bluetoothTone", False))
                    self.device_setting_notification_sound_var.set(self._fetched_device_settings_for_dialog.get("notificationSound", False))
                logger.info("GUI", "cancel_close_action", "Settings changes cancelled.")
            settings_win.destroy()

        ok_button.config(command=ok_action)
        apply_button.config(command=apply_action_ui_handler)
        cancel_close_button.config(command=cancel_close_action)

        ok_button.pack(side=tk.LEFT, padx=(0,5)) # OK on the far left of the right-aligned group
        apply_button.pack(side=tk.LEFT, padx=5)
        cancel_close_button.pack(side=tk.LEFT, padx=(5,0)) # Cancel/Close on the far right of the group

        # Default button behavior
        ok_button.focus_set()
        settings_win.bind('<Return>', lambda event: ok_button.invoke())
        settings_win.bind('<Escape>', lambda event: cancel_close_button.invoke())

    def _load_device_settings_for_dialog(self, settings_win_ref):
        try:
            settings = self.dock.get_device_settings()
            if settings:
                self._fetched_device_settings_for_dialog = settings.copy() # Store for comparison on apply
                self.master.after(0, lambda: self.device_setting_auto_record_var.set(settings.get("autoRecord", False)))
                self.master.after(0, lambda: self.device_setting_auto_play_var.set(settings.get("autoPlay", False)))
                self.master.after(0, lambda: self.device_setting_bluetooth_tone_var.set(settings.get("bluetoothTone", False)))
                self.master.after(0, lambda: self.device_setting_notification_sound_var.set(settings.get("notificationSound", False)))
                # No label to update, just enable checkboxes
                self.master.after(0, lambda: self.auto_record_checkbox.config(state=tk.NORMAL))
                self.master.after(0, lambda: self.auto_play_checkbox.config(state=tk.NORMAL))
                self.master.after(0, lambda: self.bt_tone_checkbox.config(state=tk.NORMAL))
                self.master.after(0, lambda: self.notification_sound_checkbox.config(state=tk.NORMAL))
            else:
                logger.warning("GUI", "_load_device_settings_for_dialog", "Failed to load device settings (no settings returned).")
        except Exception as e:
            logger.error("GUI", "_load_device_settings_for_dialog", f"Error loading device settings: {e}")
            # No label to update, error logged and shown in messagebox
            if settings_win_ref.winfo_exists(): # Check if window still exists
                 messagebox.showerror("Error", f"Failed to load device settings: {e}", parent=settings_win_ref)

    def _apply_device_settings_thread(self, settings_to_apply):
        if not settings_to_apply:
            logger.info("GUI", "_apply_device_settings_thread", "No device behavior settings changed.")
            return

        all_successful = True
        for name, value in settings_to_apply.items():
            result = self.dock.set_device_setting(name, value)
            if not result or result.get("result") != "success":
                all_successful = False
                logger.error("GUI", "_apply_device_settings_thread", f"Failed to set '{name}' to {value}.")
                self.master.after(0, messagebox.showwarning, "Settings Error", f"Failed to apply setting: {name}", parent=self.master) # Show on main window if settings dialog closed
        if all_successful:
            logger.info("GUI", "_apply_device_settings_thread", "All changed device settings applied successfully.")
            # Optionally re-fetch to confirm, or assume success updates the internal cache in HiDockJensen
            # For now, we assume HiDockJensen's cache is updated on successful set.

    def scan_usb_devices_for_settings(self, parent_window, initial_load=False, change_callback=None):
        if not self._initialize_backend():
            messagebox.showerror("USB Error", "Libusb backend not initialized. Cannot scan devices.", parent=parent_window)
            return

        logger.info("GUI", "scan_usb_devices", "Scanning for USB devices...")
        self.available_usb_devices.clear()
        
        found_devices_from_usb_core = usb.core.find(find_all=True, backend=backend)
        
        if found_devices_from_usb_core is None: # Should not happen with find_all=True
            logger.warning("GUI", "scan_usb_devices", "No USB devices found by backend.")
            self.settings_device_combobox['values'] = ["No devices found"]
            self.settings_device_combobox.current(0)
            return

        good_devices_tuples = [] # To store (desc, vid, pid) for successfully read devices
        problem_devices_tuples = [] # To store (desc, vid, pid) for devices with read errors

        for dev in found_devices_from_usb_core:
            is_configured_target_device = (dev.idVendor == self.selected_vid_var.get() and
                                           dev.idProduct == self.selected_pid_var.get())
            is_actively_connected_by_app = (self.dock.is_connected() and
                                            self.dock.device is not None and # Ensure dock.device exists
                                            dev.idVendor == self.dock.device.idVendor and # Check against actual connected device's VID/PID
                                            dev.idProduct == self.dock.device.idProduct)

            try:
                manufacturer = usb.util.get_string(dev, dev.iManufacturer) if dev.iManufacturer else "N/A"
                product = usb.util.get_string(dev, dev.iProduct) if dev.iProduct else "N/A"
                desc = f"{manufacturer} - {product} (VID: {hex(dev.idVendor)}, PID: {hex(dev.idProduct)})"
                good_devices_tuples.append((desc, dev.idVendor, dev.idProduct))

            except Exception as e:
                logger.warning("GUI", "scan_usb_devices", f"Error getting string info for device VID={hex(dev.idVendor)} PID={hex(dev.idProduct)}: {e}")
                if is_configured_target_device and is_actively_connected_by_app:
                    # This is our actively connected target device, but we can't read its strings.
                    # Use a special description.
                    device_name_for_display = self.dock.model if self.dock.model and self.dock.model != "unknown" else "HiDock Device"
                    desc = f"Currently Connected: {device_name_for_display} (VID: {hex(dev.idVendor)}, PID: {hex(dev.idProduct)})"
                    # Add to good_devices_tuples because it's our primary, usable device.
                    # Ensure it's added first to good_devices_tuples if it's the active one.
                    good_devices_tuples.insert(0, (desc, dev.idVendor, dev.idProduct))
                else:
                    # For other devices with errors
                    desc = f"[Error Reading] Unknown Device (VID: {hex(dev.idVendor)}, PID: {hex(dev.idProduct)})"
                    problem_devices_tuples.append((desc, dev.idVendor, dev.idProduct))

        # Sort devices within their groups (after special handling for connected device)
        # The connected device, if it had an error but was identified, is already at the top of good_devices_tuples.
        # Sort the rest of good_devices_tuples starting from the second element if the first is the special connected one.
        if good_devices_tuples and "Currently Connected" in good_devices_tuples[0][0]:
            # Sort all but the first element
            temp_list_to_sort = sorted(good_devices_tuples[1:], key=lambda x: x[0])
            good_devices_tuples = [good_devices_tuples[0]] + temp_list_to_sort
        else:
            good_devices_tuples.sort(key=lambda x: x[0])
        problem_devices_tuples.sort(key=lambda x: x[0])

        # Populate self.available_usb_devices with all valid entries for later lookup
        self.available_usb_devices.extend(good_devices_tuples)
        self.available_usb_devices.extend(problem_devices_tuples)

        # Create the list for the combobox
        combobox_display_list = [t[0] for t in good_devices_tuples]
        if problem_devices_tuples:
            if combobox_display_list: # Add separator only if there are good devices
                combobox_display_list.append("--- Devices with Issues ---")
            combobox_display_list.extend([t[0] for t in problem_devices_tuples])

        # Determine current selection string based on configured VID/PID
        # It should match one of the descriptions generated above.
        current_selection_str = None
        for desc_str, v, p in self.available_usb_devices: # Iterate through all actual devices
            if v == self.selected_vid_var.get() and p == self.selected_pid_var.get():
                current_selection_str = desc_str
                break

        self.settings_device_combobox['values'] = combobox_display_list

        if current_selection_str and current_selection_str in combobox_display_list:
            self.settings_device_combobox.set(current_selection_str)
        elif combobox_display_list:
            first_selectable_item = next((item for item in combobox_display_list if item != "--- Devices with Issues ---"), None)
            if first_selectable_item:
                if not initial_load: # Only auto-select first if it's not the initial silent load
                    self.settings_device_combobox.set(first_selectable_item)
                    # Manually trigger the on_device_selected logic because .set() doesn't fire <<ComboboxSelected>>
                    # Find the tuple corresponding to the first_selectable_item
                    selected_device_info_tuple = next((dev_tuple for dev_tuple in self.available_usb_devices if dev_tuple[0] == first_selectable_item), None)
                    if selected_device_info_tuple:
                        _, vid, pid = selected_device_info_tuple
                        self.selected_vid_var.set(vid)
                        self.selected_pid_var.set(pid)
                        logger.debug("Settings", "scan_usb_devices", f"Auto-selected first available device: {first_selectable_item} -> VID={hex(vid)}, PID={hex(pid)}")
                        if change_callback: # If a change callback is provided (e.g., for Apply button)
                            change_callback()
                    else: # Should not happen if logic is correct
                        logger.warning("Settings", "scan_usb_devices", f"Could not find details for auto-selected device: {first_selectable_item}")
            elif not combobox_display_list: # If list is truly empty after filtering (e.g. only contained separator)
                 self.settings_device_combobox['values'] = ["No devices found or accessible"]
                 self.settings_device_combobox.current(0)
        else:
            self.settings_device_combobox['values'] = ["No devices found or accessible"]
            self.settings_device_combobox.current(0)
        logger.info("GUI", "scan_usb_devices", f"Processed {len(good_devices_tuples) + len(problem_devices_tuples)} devices. Good: {len(good_devices_tuples)}, Problematic: {len(problem_devices_tuples)}.")

    def log_to_gui_widget(self, message, level_name="INFO"): # Added level_name parameter
        def _update_log(msg_to_log, lvl_name): # Pass parameters to inner function
            if not self.log_text_area.winfo_exists(): # Check if widget still exists
                return
            self.log_text_area.config(state='normal')
            self.log_text_area.insert(tk.END, msg_to_log, lvl_name) # Apply tag based on level_name
            self.log_text_area.see(tk.END)
            self.log_text_area.config(state='disabled')
        if self.master.winfo_exists(): # Check if window still exists
            self.master.after(0, _update_log, message, level_name) # Pass args to the scheduled call

    def toggle_logs(self):
        if self.logs_visible:
            self.log_frame.pack_forget()
            self.log_toggle_button.config(text="📜 Show Logs")
        else:
            self.log_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5, side=tk.BOTTOM, anchor=tk.SW) 
            self.log_toggle_button.config(text="📜 Hide Logs")
        self.logs_visible = not self.logs_visible

    def clear_log_gui(self):
        """Clears the content of the log text area."""
        if self.log_text_area.winfo_exists():
            self.log_text_area.config(state='normal')
            self.log_text_area.delete(1.0, tk.END)
            self.log_text_area.config(state='disabled')
            logger.info("GUI", "clear_log_gui", "Log display cleared by user.")

    def on_log_level_change_gui(self, event=None):
        """Handles log level change from the log section's combobox."""
        new_level = self.log_level_var.get()
        logger.set_level(new_level)
        self.config["log_level"] = new_level # Update config
        save_config(self.config) # Save immediately
        logger.info("GUI", "on_log_level_change_gui", f"Log level changed to {new_level} from log section control.")

    def toggle_device_tools(self):
        if self.device_tools_visible:
            self.device_tools_frame.pack_forget()
            self.device_tools_toggle_button.config(text="🛠️ Show Device Tools")
        else:
            # Determine the correct widget to pack 'before'
            # self.log_frame is packed above self.controls_toggle_frame when visible.
            # self.controls_toggle_frame is always packed and is above download_controls_frame.
            reference_widget_for_before = None
            if self.logs_visible and self.log_frame.winfo_ismapped(): # ismapped checks if widget is visible (packed)
                reference_widget_for_before = self.log_frame
            else:
                # Fallback to controls_toggle_frame, which is always packed in this area
                reference_widget_for_before = self.controls_toggle_frame
            
            self.device_tools_frame.pack(fill=tk.X, padx=10, pady=5, side=tk.BOTTOM, anchor=tk.SW, before=reference_widget_for_before)
            self.device_tools_toggle_button.config(text="🛠️ Hide Device Tools")
        self.device_tools_visible = not self.device_tools_visible

    def _initialize_backend(self):
        global backend # Allow modification of the global backend variable
        if backend is not None:
            logger.debug("GUI", "_initialize_backend", "Backend already initialized.")
            return True
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            possible_dll_names = ["libusb-1.0.dll"] # Add other common names if needed
            dll_path = None
            for name in possible_dll_names:
                path_candidate = os.path.join(script_dir, name)
                if os.path.exists(path_candidate): dll_path = path_candidate; break
                path_candidate_ms64 = os.path.join(script_dir, "MS64", "dll", name)
                if os.path.exists(path_candidate_ms64): dll_path = path_candidate_ms64; break
                path_candidate_ms32 = os.path.join(script_dir, "MS32", "dll", name)
                if os.path.exists(path_candidate_ms32): dll_path = path_candidate_ms32; break
            
            if not dll_path:
                logger.warning("GUI", "_initialize_backend", "libusb-1.0.dll not found locally. PyUSB will try system paths.")
                backend = usb.backend.libusb1.get_backend()
                if not backend:
                    logger.error("GUI", "_initialize_backend", "Libusb backend failed from system paths.")
                    messagebox.showerror("USB Backend Error", "Failed to initialize libusb backend from system paths. Please ensure libusb-1.0 is installed correctly and accessible in your system's PATH or library directories.")
                    return False
            else:
                logger.info("GUI", "_initialize_backend", f"Attempting to load backend using DLL: {dll_path}")
                backend = usb.backend.libusb1.get_backend(find_library=lambda x: dll_path)
                if not backend:
                    logger.error("GUI", "_initialize_backend", f"Failed to get libusb-1.0 backend with DLL at {dll_path}")
                    messagebox.showerror("USB Backend Error", f"Failed to initialize libusb backend with DLL: {dll_path}. Ensure it's the correct version (32/64 bit) for your Python interpreter.")
                    return False
            logger.info("GUI", "_initialize_backend", f"Successfully initialized backend: {backend}")
            return True
        except Exception as e:
            logger.error("GUI", "_initialize_backend", f"Error initializing libusb backend: {e}\n{traceback.format_exc()}")
            messagebox.showerror("USB Backend Error", f"An unexpected error occurred while initializing libusb: {e}")
            return False

    def attempt_autoconnect_on_startup(self):
        if self.autoconnect_var.get() and not self.dock.is_connected():
            logger.info("GUI", "attempt_autoconnect_on_startup", "Attempting autoconnect...")
            self.connect_device()

    # Removed toggle_autoconnect_config as it's now handled by Apply in settings
    # Removed start_autoconnect_periodic_check as autoconnect is startup-only


    def connect_device(self):
        if not self._initialize_backend(): # Attempt to initialize backend first
            self.status_label.config(text="Status: USB Backend Error")
            self.connect_button.config(state=tk.NORMAL) # Re-enable connect button
            return

        self.connect_button.config(state=tk.DISABLED)
        self.status_label.config(text="Status: Connecting...")
        threading.Thread(target=self._connect_device_thread, daemon=True).start()

    def _connect_device_thread(self):
        try:
            vid_to_connect = self.selected_vid_var.get()
            pid_to_connect = self.selected_pid_var.get()
            target_interface = self.target_interface_var.get()
            if self.dock.connect(target_interface_number=target_interface, vid=vid_to_connect, pid=pid_to_connect):
                self.master.after(0, lambda: self.status_label.config(text=f"Status: Connected ({self.dock.model})"))
                self.master.after(0, lambda: self.disconnect_button.config(state=tk.NORMAL))
                self.master.after(0, lambda: self.refresh_files_button.config(state=tk.NORMAL))
                self.master.after(0, lambda: self.download_button.config(state=tk.NORMAL)) # Enable download after connect
                self.master.after(0, lambda: self.delete_button.config(state=tk.NORMAL))
                self.master.after(0, lambda: self.play_button.config(state=tk.NORMAL))
                self.master.after(0, lambda: self.format_card_button.config(state=tk.NORMAL))
                self.master.after(0, lambda: self.sync_time_button.config(state=tk.NORMAL))
                
                device_info = self.dock.get_device_info() # This logs itself
                if device_info:
                     # self.dock.device_info is now populated by the call above
                     self.master.after(0, self.refresh_file_list_gui) # Auto-refresh files on connect
                     # Start periodic checks AFTER initial info and refresh
                     self.start_recording_status_check() 
                     if self.auto_refresh_files_var.get():
                         self.start_auto_file_refresh_periodic_check()
                else:
                    self.master.after(0, lambda: self.status_label.config(text="Status: Connected, but failed to get device info."))
                    self.stop_recording_status_check() # Don't start if device info failed
            else: 
                self.master.after(0, lambda: self.status_label.config(text="Status: Connection failed (unknown reason)."))
                self.master.after(0, lambda: self.connect_button.config(state=tk.NORMAL))
        except Exception as e:
            error_message = f"Status: Connection Error ({type(e).__name__})"
            self.master.after(0, lambda: self.status_label.config(text=error_message))
            self.master.after(0, lambda: self.connect_button.config(state=tk.NORMAL))
            logger.error("GUI", "_connect_device_thread", f"Connection error: {e}\n{traceback.format_exc()}")
            # If the dock itself initiated a disconnect due to the error, its state is already reset.
            if not self.dock.is_connected(): # Check if Jensen class disconnected itself
                self.master.after(0, self.handle_auto_disconnect_ui)


    def handle_auto_disconnect_ui(self):
        logger.warning("GUI", "handle_auto_disconnect_ui", "Device auto-disconnected or connection lost.")
        self.status_label.config(text="Status: Disconnected (Error/Lost)")
        self.connect_button.config(state=tk.NORMAL)
        self.disconnect_button.config(state=tk.DISABLED)
        self.refresh_files_button.config(state=tk.DISABLED)
        self.download_button.config(state=tk.DISABLED)
        self.delete_button.config(state=tk.DISABLED)
        self.play_button.config(state=tk.DISABLED)
        self.format_card_button.config(state=tk.DISABLED)
        self.sync_time_button.config(state=tk.DISABLED)
        for item in self.file_tree.get_children():
            # Stop periodic check on disconnect
            self.file_tree.delete(item)
        self.displayed_files_details.clear()
        self.total_files_label.config(text="Total: 0 files, 0.00 MB")
        self.selected_files_label.config(text="Selected: 0 files, 0.00 MB")
        # self.recording_status_label.config(text="Recording: N/A") # REMOVED
        self.card_info_label.config(text="Storage: --- / --- MB (Status: ---)") # Changed "Card" to "Storage"
        # self.card_info_label.config(text="Card: --- / --- MB (Status: ---)")
        self.stop_auto_file_refresh_periodic_check()
        self.stop_recording_status_check() # Stop periodic check on disconnect
        # If we want to ensure the GUI's dock object is also reset if it wasn't the source:
        if self.dock.is_connected(): # Should be false if Jensen disconnected itself
            self.dock.disconnect() # Ensure GUI's perspective is also disconnected

    def disconnect_device(self):
        self.dock.disconnect()
        self.status_label.config(text="Status: Disconnected")
        self.connect_button.config(state=tk.NORMAL)
        self.disconnect_button.config(state=tk.DISABLED)
        self.refresh_files_button.config(state=tk.DISABLED)
        self.play_button.config(state=tk.DISABLED)
        self.download_button.config(state=tk.DISABLED)
        self.delete_button.config(state=tk.DISABLED)
        self.sync_time_button.config(state=tk.DISABLED)
        for item in self.file_tree.get_children():
            self.file_tree.delete(item)
        self.stop_auto_file_refresh_periodic_check()
        self.stop_recording_status_check() # Stop periodic check on manual disconnect
        self.displayed_files_details.clear()
        self.total_files_label.config(text="Total: 0 files, 0.00 MB")
        self.selected_files_label.config(text="Selected: 0 files, 0.00 MB")

    def refresh_file_list_gui(self):
        if not self.dock.is_connected():
            messagebox.showerror("Error", "Not connected to HiDock device.")
            self.refresh_files_button.config(state=tk.DISABLED) # Ensure it's disabled if called when not connected
            return
        
        if self._is_ui_refresh_in_progress:
            logger.debug("GUI", "refresh_file_list_gui", "UI refresh already in progress, skipping new request.")
            return
            
        self._is_ui_refresh_in_progress = True
        self.refresh_files_button.config(state=tk.DISABLED)
        self.total_files_label.config(text="Total: Fetching...")
        # self.recording_status_label.config(text="Recording: Fetching...") # REMOVED - Status is now in the list
        self.card_info_label.config(text="Storage: Fetching...") # Changed "Card" to "Storage"
        self.selected_files_label.config(text="Selected: 0 files, 0.00 MB")
        threading.Thread(target=self._refresh_file_list_thread, daemon=True).start()

    def _refresh_file_list_thread(self):
        try:
            list_result = self.dock.list_files(timeout_s=self.default_command_timeout_ms_var.get() / 1000)
            if not self.dock.is_connected(): # Check if list_files caused a disconnect
                self.master.after(0, self.handle_auto_disconnect_ui)
                return

            files = list_result.get("files", [])
            total_files = list_result.get("totalFiles", 0)
            total_size_bytes = list_result.get("totalSize", 0)
            self.master.after(0, lambda: self.total_files_label.config(text=f"Total: {total_files} files, {total_size_bytes / (1024*1024):.2f} MB") if self.total_files_label.winfo_exists() else None)

            # Fetch and display card info
            card_info = self.dock.get_card_info(timeout_s=self.default_command_timeout_ms_var.get() / 1000)
            if card_info:
                # Device reports 'used' and 'capacity' directly in Megabytes (MB)
                used_storage_val = card_info['used'] # This is in MB
                total_storage_val = card_info['capacity'] # This is in MB
                unit = "MB"
                if total_storage_val > 1024: # If capacity is over 1024 MB, display in GB
                    used_storage_val /= 1024
                    total_storage_val /= 1024
                    unit = "GB"
                self.master.after(0, lambda: self.card_info_label.config(text=f"Storage: {used_storage_val:.2f}/{total_storage_val:.2f} {unit} (Status: {hex(card_info['status_raw'])})") if self.card_info_label.winfo_exists() else None)
                # self.master.after(0, lambda: self.card_info_label.config(text=f"Card: {used_mb:.2f}/{capacity_mb:.2f} MB (Status: {hex(card_info['status_raw'])})"))
            else:
                self.master.after(0, lambda: self.card_info_label.config(text="Storage: Info N/A") if self.card_info_label.winfo_exists() else None) # Changed "Card" to "Storage"
                # self.master.after(0, lambda: self.card_info_label.config(text="Card: Info N/A") if self.card_info_label.winfo_exists() else None)

            for item in self.file_tree.get_children(): # Clear existing items
                self.master.after(0, lambda item=item: self.file_tree.delete(item) if self.file_tree.exists(item) else None)
            self.master.after(0, self.displayed_files_details.clear) # This should be fine

            # Fetch recording status and add to the list if active
            all_files_to_display = list(files) # Make a mutable copy

            recording_info = self.dock.get_recording_file()
            if recording_info and recording_info.get("name"):
                # Check if this recording file is already in the main 'files' list (e.g., if refresh happened just as it stopped)
                # This prevents duplicates if the periodic check and manual refresh overlap.
                is_already_listed = any(f.get("name") == recording_info['name'] for f in files)
                if not is_already_listed:
                    recording_file_entry = {
                        "name": recording_info['name'],
                        "length": 0, 
                        "duration": "Recording...", 
                        "createDate": "In Progress", # Use "In Progress" for clarity
                        "createTime": "",
                        "time": datetime.now(), # For sorting purposes
                        "is_recording": True 
                    }
                    all_files_to_display.insert(0, recording_file_entry) # Add to the beginning

            if all_files_to_display: # Iterate over the combined list
                # Sort by current sort column if one is set, before initial display
                if self.treeview_sort_column:
                    all_files_to_display = self._sort_files_data(all_files_to_display, self.treeview_sort_column, self.treeview_sort_reverse)
                
                for f_info in all_files_to_display: # Use the correct list here
                    if f_info.get("is_recording"):
                        values = (
                            f_info['name'],
                            "-", # Size
                            f_info['duration'], # "Grabando..."
                            f_info.get('createDate', ''), # "En curso"
                            f_info.get('createTime', '')
                        )
                        tags_to_apply = ('recording',)
                    else:
                        values = (
                            f_info['name'],
                            f"{f_info['length'] / 1024:.2f}", # Size in KB
                            f"{f_info['duration']:.2f}", # Duration in seconds
                            f_info.get('createDate', ''), 
                            f_info.get('createTime', '')
                        )
                        local_filepath = self._get_local_filepath(f_info['name'])
                        tags_to_apply = ('downloaded',) if os.path.exists(local_filepath) else ()

                    self.master.after(0, lambda f_info=f_info, values=values, tags=tags_to_apply: \
                                      self.file_tree.insert("", tk.END, values=values, iid=f_info['name'], tags=tags) \
                                      if self.file_tree.winfo_exists() else None)
                    self.master.after(0, lambda f_info=f_info: self.displayed_files_details.append(f_info))
            else:
                if list_result.get("error"):
                    self.master.after(0, lambda: self.total_files_label.config(text=f"Total: Error - {list_result.get('error', 'Unknown')}") if self.total_files_label.winfo_exists() else None)
                else:
                    self.master.after(0, lambda: self.total_files_label.config(text="Total: 0 files, 0.00 MB") if self.total_files_label.winfo_exists() else None)

        except ConnectionError as ce: # Catch connection errors specifically if raised by list_files
            logger.error("GUI", "_refresh_file_list_thread", f"ConnectionError during file list: {ce}")
            self.master.after(0, self.handle_auto_disconnect_ui)
        except Exception as e:
            logger.error("GUI", "_refresh_file_list_thread", f"Error refreshing file list: {e}\n{traceback.format_exc()}")
            self.master.after(0, lambda: self.total_files_label.config(text="Total: Error loading files."))
            if not self.dock.is_connected() and self.master.winfo_exists(): # If any other exception also led to disconnect
                self.master.after(0, self.handle_auto_disconnect_ui)
        finally:
            self.master.after(0, lambda: self.refresh_files_button.config(state=tk.NORMAL) if self.refresh_files_button.winfo_exists() else None)
            self.master.after(0, lambda: self.on_file_selection_change(None) if self.file_tree.winfo_exists() else None) # Update selected stats
            # Reset the flag in the main thread after all UI updates are likely queued
            self.master.after(0, lambda: setattr(self, '_is_ui_refresh_in_progress', False) if hasattr(self, '_is_ui_refresh_in_progress') else None)

    def _get_local_filepath(self, device_filename):
        """Generates the expected local file path for a given device filename."""
        # This sanitization must match the one in _execute_single_download
        safe_filename = device_filename.replace(':','-').replace(' ','_').replace('\\','_').replace('/','_')
        return os.path.join(self.download_directory, safe_filename)

    def _sort_files_data(self, files_data, column_key, reverse_order):
        """Helper function to sort the file data list."""
        def get_sort_key(item):
            if column_key == "name":
                return item.get('name', '').lower()
            elif column_key == "size":
                return item.get('length', 0) 
            elif column_key == "duration":
                duration_val = item.get('duration', 0)
                if isinstance(duration_val, str): # Handle "Grabando..." or other string representations
                    # Return a tuple that sorts strings before numbers, or based on specific string content
                    return (0, duration_val.lower()) 
                else: # Assumed to be a number (float or int)
                    return (1, duration_val)
            elif column_key == "date": # Sort by actual datetime object if available
                return item.get('time', datetime.min) # datetime.min for items without time
            elif column_key == "time": # Sort by actual datetime object if available
                return item.get('time', datetime.min)
            return item.get(column_key, '') # Fallback

        return sorted(files_data, key=get_sort_key, reverse=reverse_order)

    def sort_treeview_column(self, column_name_map, is_numeric_string):
        """Sorts the treeview by the clicked column header."""
        # Map display column name to actual data key in self.displayed_files_details
        column_data_key = {
            "name": "name",
            "size": "size", # Will sort by 'length' in displayed_files_details
            "duration": "duration",
            "date": "date", # Will sort by 'time' (datetime object)
            "time": "time"  # Will sort by 'time' (datetime object)
        }.get(column_name_map, column_name_map)

        if self.treeview_sort_column == column_data_key:
            self.treeview_sort_reverse = not self.treeview_sort_reverse
        else:
            self.treeview_sort_column = column_data_key
            self.treeview_sort_reverse = False
        
        # Update column headings with sort indicators
        for col_id_key, original_text in self.original_tree_headings.items():
            # `col_id_key` is the key from original_tree_headings (e.g., "name", "size")
            if col_id_key == column_name_map: # Check if this is the column that was clicked
                arrow = " ▲" if not self.treeview_sort_reverse else " ▼"
                self.file_tree.heading(col_id_key, text=original_text + arrow)
            else: # Other columns
                self.file_tree.heading(col_id_key, text=original_text) # Reset to original text

        # Sort the master list of file details
        self.displayed_files_details = self._sort_files_data(
            self.displayed_files_details, 
            self.treeview_sort_column, 
            self.treeview_sort_reverse
        )

        # Clear and repopulate the Treeview
        for item in self.file_tree.get_children():
            self.file_tree.delete(item)
        
        for f_info in self.displayed_files_details:
            if f_info.get("is_recording"):
                values = (
                    f_info['name'],
                    "-", 
                    f_info['duration'], # "Grabando..."
                    f_info.get('createDate', ''), 
                    f_info.get('createTime', '')
                )
            else:
                values = (
                    f_info['name'], f"{f_info['length'] / 1024:.2f}", f"{f_info['duration']:.2f}",
                    f_info.get('createDate', ''), f_info.get('createTime', '')
                )
            # Preserve tags when re-inserting after sort
            local_filepath = self._get_local_filepath(f_info['name'])
            tags_for_sorted_item = ('recording',) if f_info.get("is_recording") else \
                                   (('downloaded',) if os.path.exists(local_filepath) else ())
            self.file_tree.insert("", tk.END, values=values, iid=f_info['name'], tags=tags_for_sorted_item)

        self.on_file_selection_change(None) # Update selection stats

    def start_recording_status_check(self):
        """Starts the periodic check for recording status."""
        interval_s = self.recording_check_interval_var.get()
        if interval_s <= 0:
            logger.info("GUI", "start_recording_status_check", "Recording check interval is 0 or less, check disabled.")
            self.stop_recording_status_check() # Ensure it's stopped if it was running
            return
        self.stop_recording_status_check() # Ensure any existing timer is stopped
        self._check_recording_status_periodically() # Run immediately and schedule next

    def request_cancel_operation(self):
        if self.cancel_operation_event:
            logger.info("GUI", "request_cancel_operation", "Cancellation requested by user.")
            self.cancel_operation_event.set()
            # It's also good to disable the cancel button immediately after it's pressed
            # to prevent multiple signals, though the event itself handles idempotency.
            # The operation ending (success, fail, cancel) should re-evaluate button states.
            # Ensure the button exists before trying to configure it.
            if hasattr(self, 'cancel_button') and self.cancel_button.winfo_exists():
                self.cancel_button.config(state=tk.DISABLED)
            else: # Should not happen if GUI is constructed correctly
                logger.warning("GUI", "request_cancel_operation", "Cancel button widget not found or does not exist.")
            self.cancel_button.config(state=tk.DISABLED)
            
    def stop_recording_status_check(self):
        """Stops the periodic check for recording status."""
        if self._recording_check_timer_id:
            self.master.after_cancel(self._recording_check_timer_id)
            self._recording_check_timer_id = None
            logger.debug("GUI", "stop_recording_status_check", "Recording status check stopped.")
        self._previous_recording_filename = None # Reset state

    def _check_recording_status_periodically(self):
        """Checks recording status and updates GUI if it changes."""
        if not self.dock.is_connected():
            self.stop_recording_status_check() # Stop if device is no longer connected
            return
        if self.is_long_operation_active: # Skip if a download/playback prep is active
            logger.debug("GUI", "_check_recording_status_periodically", "Long operation active, skipping recording status check.")
            self.stop_recording_status_check() # Stop if device is no longer connected
            return
        
        recording_info = self.dock.get_recording_file(timeout_s=self.default_command_timeout_ms_var.get() / 1000)
        if not self.dock.is_connected(): # Check again after the call, in case it disconnected
            self.stop_recording_status_check()
            return
            
        current_recording_filename = recording_info.get("name") if recording_info else None

        if current_recording_filename != self._previous_recording_filename:
            logger.info("GUI", "_check_recording_status_periodically", f"Recording status changed: {self._previous_recording_filename} -> {current_recording_filename}. Refreshing file list.")
            self._previous_recording_filename = current_recording_filename
            self.refresh_file_list_gui() # Refresh the list to show/hide the recording entry

        interval_ms = self.recording_check_interval_var.get() * 1000
        if interval_ms <= 0: # Should have been caught by start_recording_status_check, but as a safeguard
            logger.warning("GUI", "_check_recording_status_periodically", "Interval is 0 or less, stopping check.")
            self.stop_recording_status_check()
            return
        self._recording_check_timer_id = self.master.after(interval_ms, self._check_recording_status_periodically)

    def start_auto_file_refresh_periodic_check(self):
        self.stop_auto_file_refresh_periodic_check()
        if self.auto_refresh_files_var.get() and self.dock.is_connected():
            interval_s = self.auto_refresh_interval_s_var.get()
            if interval_s <= 0:
                logger.info("GUI", "start_auto_file_refresh_periodic_check", "Auto refresh interval is 0 or less, auto refresh disabled.")
                # No need to call stop again as it's called at the beginning of this func
                return
            logger.info("GUI", "start_auto_file_refresh_periodic_check", f"Starting auto file refresh with interval {interval_s}s.")
            self._check_auto_file_refresh_periodically()

    def stop_auto_file_refresh_periodic_check(self):
        if self._auto_file_refresh_timer_id:
            self.master.after_cancel(self._auto_file_refresh_timer_id)
            self._auto_file_refresh_timer_id = None
            logger.debug("GUI", "stop_auto_file_refresh", "Auto file refresh stopped.")

    def _check_auto_file_refresh_periodically(self):
        if not self.dock.is_connected() or not self.auto_refresh_files_var.get():
            self.stop_auto_file_refresh_periodic_check()
            return
        
        if self.is_long_operation_active: # Skip if a download/playback prep is active
            logger.debug("GUI", "_check_auto_file_refresh_periodically", "Long operation active, skipping auto file refresh.")

            return
        
        logger.debug("GUI", "_check_auto_file_refresh_periodically", "Auto-refreshing file list.")
        self.refresh_file_list_gui()

        interval_ms = self.auto_refresh_interval_s_var.get() * 1000
        if interval_ms <= 0: # Safeguard
            logger.warning("GUI", "_check_auto_file_refresh_periodically", "Interval is 0 or less, stopping auto-refresh.")
            self.stop_auto_file_refresh_periodic_check()
            return

        self._auto_file_refresh_timer_id = self.master.after(interval_ms, self._check_auto_file_refresh_periodically)

    def _reset_download_dir_for_settings(self, label_widget, dialog_dir_tracker, change_tracker, apply_btn, cancel_btn):
        """Handles resetting download directory specifically for the settings dialog."""
        default_dir = os.getcwd() # Application's current working directory
        if default_dir != dialog_dir_tracker[0]:
            dialog_dir_tracker[0] = default_dir
            if label_widget and label_widget.winfo_exists():
                label_widget.config(text=dialog_dir_tracker[0])

            if not change_tracker[0]: # Mark as changed and update buttons
                change_tracker[0] = True
                if apply_btn.winfo_exists(): apply_btn.config(state=tk.NORMAL)
                if cancel_btn.winfo_exists(): cancel_btn.config(text="Cancel")
            logger.debug("GUI", "_reset_download_dir_for_settings", f"Download directory selection reset in dialog to: {dialog_dir_tracker[0]}")

    def select_download_dir(self): # This is the old one, for a button outside settings if any.
        """Allows user to select download directory - updates config immediately."""
        # This method is now primarily for if there was a button outside settings.
        # The settings dialog uses _select_download_dir_for_settings.
        # For now, let's assume this method is not directly used by a UI element
        # that expects immediate save without the Apply/OK flow.
        # If it were, it would need to be self.download_directory = selected_dir, etc.
        logger.warning("GUI", "select_download_dir", "This method is deprecated for settings dialog. Use internal version.")
    
    def _set_long_operation_active_state(self, active: bool, operation_name: str = ""):
        self.is_long_operation_active = active
        if active:
            self.play_button.config(state=tk.DISABLED)
            self.download_button.config(state=tk.DISABLED)
            self.delete_button.config(state=tk.DISABLED)
            if hasattr(self, 'format_card_button'): self.format_card_button.config(state=tk.DISABLED)
            if hasattr(self, 'sync_time_button'): self.sync_time_button.config(state=tk.DISABLED)
            self.refresh_files_button.config(state=tk.DISABLED)
            self.cancel_button.config(state=tk.NORMAL)
            self.cancel_operation_event = threading.Event() # Fresh event for this operation
            logger.info("GUI", "_set_long_operation_active_state", f"Long operation '{operation_name}' started.")
        else:
            # Re-enable based on connection status and selection
            is_connected = self.dock.is_connected()
            has_selection = bool(self.file_tree.selection())

            self.play_button.config(state=tk.NORMAL if is_connected and has_selection else tk.DISABLED)
            self.download_button.config(state=tk.NORMAL if is_connected and has_selection else tk.DISABLED)
            self.delete_button.config(state=tk.NORMAL if is_connected and has_selection else tk.DISABLED)
            if hasattr(self, 'format_card_button'): self.format_card_button.config(state=tk.NORMAL if is_connected else tk.DISABLED)
            if hasattr(self, 'sync_time_button'): self.sync_time_button.config(state=tk.NORMAL if is_connected else tk.DISABLED)
            self.refresh_files_button.config(state=tk.NORMAL if is_connected else tk.DISABLED)
            self.cancel_button.config(state=tk.DISABLED)
            self.cancel_operation_event = None # Clear the event
            logger.info("GUI", "_set_long_operation_active_state", f"Long operation '{operation_name}' ended.")
            self.on_file_selection_change(None) # Re-evaluate button states/text

    def play_selected_audio_gui(self):
        if not pygame:
            messagebox.showerror("Playback Error", "Pygame library is not installed. Please install it to enable audio playback (pip install pygame).")
            return

        selected_iids = self.file_tree.selection()
        if not selected_iids:
            messagebox.showinfo("No Selection", "Please select a single audio file to play.")
            return
        if len(selected_iids) > 1:
            messagebox.showinfo("Multiple Selection", "Please select only one audio file to play at a time.")
            return
        
        if self.is_long_operation_active:
            messagebox.showwarning("Busy", "Another operation is already in progress. Please wait.")
            return

        file_iid = selected_iids[0]
        file_detail = next((f for f in self.displayed_files_details if f['name'] == file_iid), None)

        if not file_detail:
            messagebox.showerror("Error", "Could not find details for the selected file.")
            return

        # Basic check for WAV, as HDA playback is not supported directly
        if not (file_detail['name'].lower().endswith(".wav") or file_detail['name'].lower().endswith(".hda")):
            messagebox.showwarning("Unsupported Format", "Playback is attempted for .wav and .hda files. Success for .hda depends on system codecs.")
            return

        if self.is_audio_playing:
            self._stop_audio_playback(mode="user_stop") # User clicked "Stop Playback"
            # After stopping, on_file_selection_change will be called, which will update button text
            # If the same file is selected, it might become "Replay"
            return 
        
        # Check if the file already exists in the permanent download directory
        local_filepath = self._get_local_filepath(file_detail['name'])
        if os.path.exists(local_filepath):
            logger.info("GUI", "play_selected_audio_gui", f"Playing existing local file: {local_filepath}")
            self._cleanup_temp_playback_file() # Clean up any previous temp file
            self.current_playing_temp_file = None # Not using a temp file for this session
            self.current_playing_filename_for_replay = file_detail['name']
            self._start_playback_local_file(local_filepath, file_detail)
            return

        # If not found locally, proceed to download to a temporary file
        logger.info("GUI", "play_selected_audio_gui", f"Local file not found. Will download {file_detail['name']} to temporary location for playback.")

        self._set_long_operation_active_state(True, "Playback Preparation")

        self.update_overall_progress_label(f"Preparing to play {file_detail['name']}...")
        
        self._cleanup_temp_playback_file() # Clean up any previous temp file before creating a new one

        # Create a temporary file to download to
        try:
            # Suffix is important for pygame to recognize file type
            file_suffix = ".wav" if file_detail['name'].lower().endswith(".wav") else ".hda"
            temp_fd, self.current_playing_temp_file = tempfile.mkstemp(suffix=file_suffix)
            os.close(temp_fd) # Close the file descriptor, _download_for_playback_thread will open it in 'wb'
            logger.info("GUI", "play_selected_audio", f"Created temporary file for playback: {self.current_playing_temp_file}")
        except Exception as e:
            logger.error("GUI", "play_selected_audio", f"Failed to create temporary file: {e}")
            messagebox.showerror("Playback Error", f"Failed to create temporary file: {e}")
            self._set_long_operation_active_state(False, "Playback Preparation") # Reset state
            return

        self.current_playing_filename_for_replay = file_detail['name'] # Store for potential replay
        threading.Thread(target=self._download_for_playback_thread, args=(file_detail,), daemon=True).start()

    def _download_for_playback_thread(self, file_info):
        try:
            with open(self.current_playing_temp_file, "wb") as outfile_handle:
                def data_cb(chunk):
                    outfile_handle.write(chunk)
                def progress_cb(received, total):
                    # Can update a specific progress for this download if needed
                    self.master.after(0, self.update_file_progress, received, total, f"(Playback) {file_info['name']}")
                
                # Ensure cancel_operation_event is passed
                status = self.dock.stream_file(
                    file_info['name'], file_info['length'], data_cb, progress_cb,
                    timeout_s=self.file_stream_timeout_s_var.get(), # Ensure this is an int
                    cancel_event=self.cancel_operation_event # Pass the event
                )
            
            if status == "OK":
                self.master.after(0, self._start_playback_local_file, self.current_playing_temp_file, file_info)
            elif status == "cancelled":
                logger.info("GUI", "_download_for_playback_thread", f"Download for playback of {file_info['name']} was cancelled.")
                self.master.after(0, self.update_overall_progress_label, f"Playback prep for {file_info['name']} cancelled.")
                self._cleanup_temp_playback_file() # Ensure temp file is deleted
            elif status == "fail_disconnected":
                logger.error("GUI", "_download_for_playback_thread", f"Download for playback of {file_info['name']} failed: Device disconnected.")
                self.master.after(0, self.update_overall_progress_label, "Playback prep failed: Device disconnected.")
                self._cleanup_temp_playback_file() # Ensure temp file is deleted
                self.master.after(0, self.handle_auto_disconnect_ui)
            else: # Other failures
                logger.error("GUI", "_download_for_playback_thread", f"Download for playback of {file_info['name']} failed. Status: {status}")
                messagebox.showerror("Playback Error", f"Failed to download {file_info['name']} for playback. Status: {status}")
                self._cleanup_temp_playback_file() # Ensure temp file is deleted
                # Update progress label for generic failure
                self.master.after(0, self.update_overall_progress_label, f"Playback preparation for {file_info['name']} failed.")
        except Exception as e:
            # This exception block might catch errors from self.dock.stream_file if it raises
            # an exception not handled internally (e.g., ConnectionError if _send_command fails hard).
            if not self.dock.is_connected():
                self.master.after(0, self.handle_auto_disconnect_ui)
            logger.error("GUI", "_download_for_playback_thread", f"Error downloading for playback: {e}\n{traceback.format_exc()}")
            messagebox.showerror("Playback Error", f"Error during download for playback: {e}")
            self._cleanup_temp_playback_file() # Ensure temp file is deleted
            self.master.after(0, self.update_overall_progress_label, "Playback preparation failed.")
        finally:
            self.master.after(0, self._set_long_operation_active_state, False, "Playback Preparation")
            self.master.after(0, self.start_auto_file_refresh_periodic_check) # Restart auto-refresh

    def _start_playback_local_file(self, filepath, original_file_info):
        try:
            pygame.mixer.music.load(filepath)
            # Get duration - Sound object is more reliable for this
            sound = pygame.mixer.Sound(filepath)
            self.playback_total_duration = sound.get_length() # in seconds
            del sound # free the sound object
            self.is_audio_playing = True # Set before configuring button
            
            # Ensure playback_controls_frame and its essential components are created
            force_recreate_controls = False
            if not hasattr(self, 'playback_controls_frame') or \
               not self.playback_controls_frame.winfo_exists():
                force_recreate_controls = True
            else:
                # If frame widget exists, check if essential component attributes are also present on self.
                # These attributes are set within _create_playback_controls_frame.
                if not hasattr(self, 'total_duration_label') or \
                   not hasattr(self, 'playback_slider') or \
                   not hasattr(self, 'current_time_label'):
                    logger.warning("GUI", "_start_playback_local_file", 
                                   "Playback frame widget exists, but essential control attributes are missing. Forcing recreation.")
                    force_recreate_controls = True
            
            if force_recreate_controls:
                self._create_playback_controls_frame() 

            # Now that controls are guaranteed to exist, configure them
            self.total_duration_label.config(text=time.strftime('%M:%S', time.gmtime(self.playback_total_duration)))
            self.playback_slider.config(to=self.playback_total_duration)
            self.playback_slider.set(0) # Reset slider to beginning
            self.playback_slider.set(0)
            
            loops = -1 if self.loop_playback_var.get() else 0
            pygame.mixer.music.play(loops=loops)
            self.playback_controls_frame.pack(fill=tk.X, side=tk.BOTTOM, pady=5, before=self.controls_toggle_frame)
            self._update_playback_progress()
            self.update_overall_progress_label(f"Playing: {os.path.basename(filepath)}")
            self.current_playing_filename_for_replay = original_file_info['name'] # Store for replay
            self.play_button.config(text="⏹️ Stop Playback") # Change button text
        except Exception as e:
            logger.error("GUI", "_start_playback_local_file", f"Error starting playback: {e}\n{traceback.format_exc()}")
            messagebox.showerror("Playback Error", f"Could not play audio file {os.path.basename(filepath)}: {e}")
            self._cleanup_temp_playback_file()
            self.is_audio_playing = False
        # finally: # Button state is managed by on_file_selection_change or _set_long_operation_active_state
            # self.on_file_selection_change(None) # Re-evaluate button after attempt

    def _create_playback_controls_frame(self):
        # This method creates the playback controls frame and its children.
        # It's called if the frame doesn't exist when playback starts.
        self.playback_controls_frame = ttk.Frame(self.master, padding="5")

        self.current_time_label = ttk.Label(self.playback_controls_frame, text="00:00")
        self.current_time_label.pack(side=tk.LEFT, padx=5)

        self.playback_slider = ttk.Scale(self.playback_controls_frame, from_=0, to=100, orient=tk.HORIZONTAL, length=300, command=self._on_slider_value_changed_by_command)
        self.playback_slider.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)
        self.playback_slider.bind("<ButtonPress-1>", self._on_slider_press)
        self.playback_slider.bind("<ButtonRelease-1>", self._on_slider_release)
        self._user_is_dragging_slider = False # Initialize here as well

        self.total_duration_label = ttk.Label(self.playback_controls_frame, text="00:00")
        self.total_duration_label.pack(side=tk.LEFT, padx=5)

        # Volume Control
        ttk.Label(self.playback_controls_frame, text="Vol:").pack(side=tk.LEFT, padx=(10,0))
        self.volume_slider_widget = ttk.Scale(self.playback_controls_frame, from_=0, to=1, variable=self.volume_var, command=self._on_volume_change, orient=tk.HORIZONTAL, length=80)
        self.volume_slider_widget.pack(side=tk.LEFT, padx=(0,5))
        pygame.mixer.music.set_volume(self.volume_var.get()) # Set initial volume

        # Loop Checkbox
        self.loop_checkbox = ttk.Checkbutton(self.playback_controls_frame, text="Loop", variable=self.loop_playback_var, command=self._on_loop_toggle)
        self.loop_checkbox.pack(side=tk.LEFT, padx=5)

        # Stop button is now the main play_button when playing
        # self.stop_playback_button = ttk.Button(self.playback_controls_frame, text="Stop", command=self._stop_audio_playback)
        # self.stop_playback_button.pack(side=tk.LEFT, padx=5)
        logger.debug("GUI", "_create_playback_controls_frame", "Playback controls frame created.")

    def _update_playback_progress(self):
        if self.is_audio_playing and pygame.mixer.music.get_busy():
            current_pos_sec = pygame.mixer.music.get_pos() / 1000.0
            current_pos_sec = min(current_pos_sec, self.playback_total_duration) # Cap at total duration
            if not self._user_is_dragging_slider:
                 # Only update slider if its value is not already very close, to avoid jitter
                 if abs(self.playback_slider.get() - current_pos_sec) > 0.5: # Threshold of 0.5s
                    self.playback_slider.set(current_pos_sec)
            self.current_time_label.config(text=time.strftime('%M:%S', time.gmtime(current_pos_sec)))
            self.playback_update_timer_id = self.master.after(250, self._update_playback_progress) # Update 4 times a second
        elif self.is_audio_playing: # Music finished
            self._stop_audio_playback(mode="natural_end")

    def _on_slider_press(self, event):
        self._user_is_dragging_slider = True
        # Stop the automatic progress updates while the user is interacting with the slider.
        if self.playback_update_timer_id:
            self.master.after_cancel(self.playback_update_timer_id)
            self.playback_update_timer_id = None

    def _on_slider_release(self, event):
        # This event is triggered when the user releases the mouse button after dragging or clicking the slider.
        # The slider's value should already reflect the new position.
        seek_pos_sec = self.playback_slider.get() # Get the slider's current value
        self._user_is_dragging_slider = False # Reset the flag

        if self.is_audio_playing:
            try:
                logger.debug("GUI", "_on_slider_release", f"User released slider. Seeking to: {seek_pos_sec:.2f}s")
                loops = -1 if self.loop_playback_var.get() else 0
                
                # Stop current playback and restart from the new position.
                # Pygame's play(start=...) is the correct way to seek.
                pygame.mixer.music.stop() 
                pygame.mixer.music.play(loops=loops, start=seek_pos_sec)
                
                # Update label immediately after seek
                self.current_time_label.config(text=time.strftime('%M:%S', time.gmtime(seek_pos_sec)))
                
                # Restart the UI progress updates if music is playing.
                if pygame.mixer.music.get_busy():
                    if self.playback_update_timer_id: # Cancel any existing timer just in case
                        self.master.after_cancel(self.playback_update_timer_id)
                        self._update_playback_progress()
            except Exception as e:
                logger.error("GUI", "_on_slider_release_seek", f"Error seeking audio: {e}")

    def _on_slider_value_changed_by_command(self, value_str):
        # This method is called by the slider's 'command' option whenever its value changes.
        # We only want to update the time label here. Seeking is now handled by _on_slider_release.
        self.latest_slider_value_from_command = float(value_str)
        self.current_time_label.config(text=time.strftime('%M:%S', time.gmtime(self.latest_slider_value_from_command)))

    def _on_volume_change(self, value_str):
        if pygame and pygame.mixer.get_init():
            try:
                volume = float(value_str)
                pygame.mixer.music.set_volume(volume)
            except Exception as e:
                logger.error("GUI", "_on_volume_change", f"Error setting volume: {e}")

    def _on_loop_toggle(self):
        if self.is_audio_playing and pygame.mixer.music.get_busy():
            current_pos_sec = pygame.mixer.music.get_pos() / 1000.0
            pygame.mixer.music.play(loops=(-1 if self.loop_playback_var.get() else 0), start=current_pos_sec)

    def on_file_selection_change(self, event):
        is_connected = self.dock.is_connected()
        selected_items = self.file_tree.selection()
        num_selected = len(selected_items)
        size_selected_bytes = 0

        if not self.is_long_operation_active: # Only update if no long operation is running
            for item_iid in selected_items:
                file_detail = next((f for f in self.displayed_files_details if f['name'] == item_iid), None)
                if file_detail:
                    size_selected_bytes += file_detail.get('length', 0) # Use .get for safety
            self.selected_files_label.config(text=f"Selected: {num_selected} files, {size_selected_bytes / (1024*1024):.2f} MB")

            # Update Play button state and text
            if self.is_audio_playing: # If audio is currently playing, button is always "Stop"
                self.play_button.config(state=tk.NORMAL, text="⏹️ Stop Playback")
            elif num_selected == 1 and is_connected: # Playable if one item selected and connected
                file_iid = selected_items[0]
                file_detail = next((f for f in self.displayed_files_details if f['name'] == file_iid), None)
                can_play = file_detail and (file_detail['name'].lower().endswith(".wav") or file_detail['name'].lower().endswith(".hda"))
                
                if can_play:
                    local_filepath_check = self._get_local_filepath(file_detail['name'])
                    if os.path.exists(local_filepath_check):
                        self.play_button.config(state=tk.NORMAL, text="▶️ Play Local")
                    else:
                        self.play_button.config(state=tk.NORMAL, text="▶️ Play (Download)")
                else:
                    self.play_button.config(state=tk.DISABLED, text="▶️ Play Selected") # Not a playable file type
            else:
                self.play_button.config(state=tk.DISABLED, text="▶️ Play Selected") # 0 or >1 selected, or not connected

            # Update Download and Delete button states
            if num_selected > 0 and is_connected:
                self.download_button.config(state=tk.NORMAL)
                self.delete_button.config(state=tk.NORMAL)
            else: # No selection or not connected
                self.download_button.config(state=tk.DISABLED)
                self.delete_button.config(state=tk.DISABLED)
        # If a long operation is active, _set_long_operation_active_state handles button states.

    def _stop_audio_playback(self, mode="user_stop"):
        if pygame and pygame.mixer.get_init(): # Check if mixer is initialized
            pygame.mixer.music.stop()
            try:
                pygame.mixer.music.unload() # Explicitly unload to release file handle
                logger.debug("GUI", "_stop_audio_playback", "Pygame music unloaded.")
            except Exception as e:
                logger.warning("GUI", "_stop_audio_playback", f"Could not unload pygame music: {e}")
        self.is_audio_playing = False
        if self.playback_update_timer_id:
            self.master.after_cancel(self.playback_update_timer_id)
            self.playback_update_timer_id = None
        
        if hasattr(self, 'playback_controls_frame') and self.playback_controls_frame.winfo_exists():
            self.playback_controls_frame.pack_forget() # Hide controls
        self._cleanup_temp_playback_file()
        
        # After stopping, re-evaluate button state based on current selection
        self.on_file_selection_change(None) 

        if mode != "natural_end": # Only update label if stopped by user or error
            self.master.after(0, self.update_overall_progress_label, "Playback stopped.")

    def _cleanup_temp_playback_file(self):
        if self.current_playing_temp_file and os.path.exists(self.current_playing_temp_file):
            try:
                os.remove(self.current_playing_temp_file)
                logger.info("GUI", "_cleanup_temp_playback_file", f"Deleted temp file: {self.current_playing_temp_file}")
            except Exception as e:
                logger.error("GUI", "_cleanup_temp_playback_file", f"Error deleting temp file {self.current_playing_temp_file}: {e}")
        self.current_playing_temp_file = None
        self.current_playing_filename_for_replay = None # Clear this too

    def download_selected_files_gui(self):
        selected_iids = self.file_tree.selection()
        if not selected_iids:
            messagebox.showinfo("No Selection", "Please select one or more files to download.")
            return
        if not self.download_directory or not os.path.isdir(self.download_directory):
            messagebox.showerror("Error", "Please select a valid download directory first.")
            return
        
        if self.is_long_operation_active:
            messagebox.showwarning("Busy", "Another operation is already in progress. Please wait.")
            return

        files_to_download_info = []
        for iid in selected_iids:
            file_detail = next((f for f in self.displayed_files_details if f['name'] == iid), None)
            if file_detail:
                files_to_download_info.append(file_detail)
        
        self._set_long_operation_active_state(True, "Download Queue")

        # Start a single thread to process the download queue sequentially
        threading.Thread(target=self._process_download_queue_thread,
                         args=(files_to_download_info,),
                         daemon=True).start()

    def _process_download_queue_thread(self, files_to_download_info):
        self.is_long_operation_active = True
        batch_start_time = time.time() # Record start time for the whole batch
        # Ensure cancel button is enabled at the start of the operation,
        # as download_selected_files_gui might have been called while another op was finishing.
        self.master.after(0, lambda: self.cancel_button.config(state=tk.NORMAL) if self.cancel_button.winfo_exists() else None)
        total_files_in_queue = len(files_to_download_info)
        operation_aborted = False
        for i, file_info in enumerate(files_to_download_info):
            if not self.dock.is_connected(): # Check connection before each download
                logger.error("GUI", "_process_download_queue_thread", "Device disconnected, aborting download queue.")
                self.master.after(0, self.handle_auto_disconnect_ui)
                operation_aborted = True
                break
            if self.cancel_operation_event and self.cancel_operation_event.is_set():
                logger.info("GUI", "_process_download_queue_thread", "Download queue cancelled by user.")
                self.master.after(0, self.update_overall_progress_label, "Download queue cancelled.")
                operation_aborted = True
                break
            self._execute_single_download(file_info, i + 1, total_files_in_queue)
            # After _execute_single_download, check if it caused a disconnect or cancellation
            # The cancel_operation_event check is crucial here.
            # _execute_single_download might set it if its internal stream_file was cancelled.
            if not self.dock.is_connected() or \
               (hasattr(self, 'cancel_operation_event') and self.cancel_operation_event and self.cancel_operation_event.is_set()):
                operation_aborted = True # Mark as aborted to prevent "All complete" message
                # If it was a disconnect, handle_auto_disconnect_ui would have been called by _execute_single_download
                # If it was a cancel, the message is already set by the cancel request.
                if self.cancel_operation_event and self.cancel_operation_event.is_set():
                    logger.info("GUI", "_process_download_queue_thread", "Download queue aborted due to cancellation during a file download.")
                break 
        
        # Actions after the entire queue is processed (or aborted)
        batch_end_time = time.time()
        total_batch_duration = batch_end_time - batch_start_time
        
        if not operation_aborted:
            self.master.after(0, self.update_overall_progress_label, f"All {len(files_to_download_info)} file(s) downloaded in {total_batch_duration:.2f}s.")
        elif self.cancel_operation_event and self.cancel_operation_event.is_set():
            # If cancelled, the "Download queue cancelled." message is already set. We can append time.
            self.master.after(0, self.update_overall_progress_label, f"Download queue cancelled after {total_batch_duration:.2f}s.")
        # If aborted due to disconnect, handle_auto_disconnect_ui would have set a message.
        
        self.master.after(0, lambda: self.refresh_files_button.config(state=tk.NORMAL if self.dock.is_connected() else tk.DISABLED))
        self.master.after(0, self._set_long_operation_active_state, False, "Download Queue")
        self.master.after(0, self.start_auto_file_refresh_periodic_check) 
        self.master.after(0, lambda: self.file_progress_bar.config(value=0) if self.file_progress_bar.winfo_exists() else None)

    def delete_selected_files_gui(self):
        selected_iids = self.file_tree.selection()
        if not selected_iids:
            messagebox.showinfo("No Selection", "Please select one or more files to delete.")
            return

        if not messagebox.askyesno("Confirm Delete", f"Are you sure you want to permanently delete {len(selected_iids)} selected file(s)? This cannot be undone."):
            return

        files_to_delete_names = [iid for iid in selected_iids] # iid is the filename
        
        self.delete_button.config(state=tk.DISABLED)
        self.refresh_files_button.config(state=tk.DISABLED)
        self.download_button.config(state=tk.DISABLED)
        
        threading.Thread(target=self._delete_files_thread, args=(files_to_delete_names,), daemon=True).start()

    def _delete_files_thread(self, filenames):
        success_count = 0
        fail_count = 0
        for i, filename in enumerate(filenames):
            if not self.dock.is_connected():
                logger.error("GUI", "_delete_files_thread", "Device disconnected, aborting delete queue.")
                self.master.after(0, self.handle_auto_disconnect_ui)
                break
            
            self.master.after(0, self.update_overall_progress_label, f"Deleting {filename} ({i+1}/{len(filenames)})...")
            delete_status = self.dock.delete_file(filename, timeout_s=self.default_command_timeout_ms_var.get() / 1000)
            if delete_status and delete_status.get("result") == "success":
                success_count += 1
                logger.info("GUI", "_delete_files_thread", f"Successfully deleted {filename}")
            else:
                fail_count += 1
                logger.error("GUI", "_delete_files_thread", f"Failed to delete {filename}: {delete_status.get('error', delete_status.get('result'))}")
        
        self.master.after(0, self.update_overall_progress_label, f"Deletion complete. Succeeded: {success_count}, Failed: {fail_count}")
        self.master.after(0, self.refresh_file_list_gui) # Refresh list after deletions
        self.master.after(0, lambda: self.delete_button.config(state=tk.NORMAL if self.dock.is_connected() else tk.DISABLED))
        self.master.after(0, lambda: self.refresh_files_button.config(state=tk.NORMAL if self.dock.is_connected() else tk.DISABLED))
        self.master.after(0, lambda: self.download_button.config(state=tk.NORMAL if self.dock.is_connected() else tk.DISABLED))

    def format_sd_card_gui(self):
        if not self.dock.is_connected():
            messagebox.showerror("Error", "Not connected to HiDock device.")
            return

        if not messagebox.askyesno("Confirm Format Internal Storage", "WARNING: This will erase ALL data on the HiDock's internal storage. This action cannot be undone. Are you absolutely sure you want to proceed?"):
            return
        if not messagebox.askyesno("Final Confirmation", "FINAL WARNING: Formatting will erase everything. Continue?"):
            return
        
        # Add typed confirmation
        confirmation_text = tk.simpledialog.askstring("Type Confirmation", 
                                                      "To confirm formatting the internal storage, please type 'FORMAT' in the box below.",
                                                      parent=self.master)
        
        if confirmation_text is None or confirmation_text.upper() != "FORMAT":
            messagebox.showwarning("Format Cancelled", "Storage formatting was cancelled. Confirmation text did not match.", parent=self.master)
            return

        self.format_card_button.config(state=tk.DISABLED)
        threading.Thread(target=self._format_sd_card_thread, daemon=True).start()

    def _format_sd_card_thread(self):
        self.master.after(0, self.update_overall_progress_label, "Formatting Internal Storage... Please wait.")
        logger.info("GUI", "_format_sd_card_thread", "Starting internal storage format operation.")
        format_status = self.dock.format_card(timeout_s=max(60, self.default_command_timeout_ms_var.get() / 1000)) # Ensure at least 60s

        if format_status and format_status.get("result") == "success":
            self.master.after(0, messagebox.showinfo, "Format Success", "Internal storage formatted successfully.")
            logger.info("GUI", "_format_sd_card_thread", "Internal storage formatted successfully.")
        else:
            error_msg = format_status.get('error', format_status.get('result', 'Unknown error'))
            self.master.after(0, messagebox.showerror, "Format Failed", f"Failed to format internal storage: {error_msg}")
            logger.error("GUI", "_format_sd_card_thread", f"Internal storage format failed: {error_msg}")

        self.master.after(0, self.update_overall_progress_label, "Format operation finished.")
        self.master.after(0, self.refresh_file_list_gui) # Refresh list and card info
        self.master.after(0, lambda: self.format_card_button.config(state=tk.NORMAL if self.dock.is_connected() else tk.DISABLED))

    def sync_device_time_gui(self):
        if not self.dock.is_connected():
            messagebox.showerror("Error", "Not connected to HiDock device.")
            return
        
        if not messagebox.askyesno("Confirm Sync Time", "This will set the HiDock device's time to your computer's current time. Continue?"):
            return

        self.sync_time_button.config(state=tk.DISABLED)
        threading.Thread(target=self._sync_device_time_thread, daemon=True).start()

    def _sync_device_time_thread(self):
        self.master.after(0, self.update_overall_progress_label, "Syncing device time...")
        current_time = datetime.now()
        result = self.dock.set_device_time(current_time)
        if result and result.get("result") == "success":
            self.master.after(0, messagebox.showinfo, "Time Sync", "Device time synchronized successfully.")
        else:
            error_detail = result.get('error', 'Unknown error') if result else "Communication error"
            if result and 'device_code' in result:
                error_detail += f" (Device code: {result['device_code']})"
            self.master.after(0, messagebox.showerror, "Time Sync Error", f"Failed to sync device time: {error_detail}")
        self.master.after(0, lambda: self.sync_time_button.config(state=tk.NORMAL if self.dock.is_connected() else tk.DISABLED))
        self.master.after(0, self.update_overall_progress_label, "Time sync operation finished.")
    def _execute_single_download(self, file_info, file_index, total_files_to_download):
        self.master.after(0, self.update_overall_progress_label, f"Downloading {file_info['name']} ({file_index}/{total_files_to_download})...")
        # Reset progress bar for the new file
        self.master.after(0, lambda: self.file_progress_bar.config(value=0))

        download_start_time = time.time()
        safe_filename = file_info['name'].replace(':','-').replace(' ','_').replace('\\','_').replace('/','_')
        
        # Define temporary and final paths
        temp_download_filename = f"_temp_download_{safe_filename}" # Keep this for messages
        temp_download_path = os.path.join(self.download_directory, temp_download_filename)
        final_download_path = os.path.join(self.download_directory, safe_filename)

        status = "fail" # Default status, will be updated by stream_file

        try:
            with open(temp_download_path, "wb") as outfile_handle: # Write to temporary path
                def gui_data_cb(chunk):
                    try:
                        outfile_handle.write(chunk)
                    except Exception as e_write:
                        logger.error("GUI", "gui_data_cb", f"Error writing chunk to {temp_download_path}: {e_write}")
                        # This error should ideally stop the stream_file or be reported back

                def gui_progress_cb(received, total):
                    elapsed_time = time.time() - download_start_time
                    
                    if elapsed_time > 0:
                        speed_bps = received / elapsed_time  # bytes per second
                        if speed_bps > 0:
                            bytes_remaining = total - received
                            etr_seconds = bytes_remaining / speed_bps
                            etr_str = f"ETR: {time.strftime('%M:%S', time.gmtime(etr_seconds))}"
                        else:
                            etr_str = "ETR: calculating..."
                        speed_str = f"{speed_bps / 1024:.2f} KB/s" if speed_bps < 1024*1024 else f"{speed_bps / (1024*1024):.2f} MB/s"
                    else:
                        speed_str = "Speed: calculating..."
                        etr_str = "ETR: calculating..."

                    elapsed_str = f"Elapsed: {time.strftime('%M:%S', time.gmtime(elapsed_time))}"
                    
                    self.master.after(0, self.update_file_progress, received, total, file_info['name'])
                    self.master.after(0, self.update_overall_progress_label, f"Current: {file_info['name']} | {speed_str} | {elapsed_str} | {etr_str}")

                status = self.dock.stream_file(
                    file_info['name'],
                    file_info['length'],
                    gui_data_cb,
                    gui_progress_cb,
                    timeout_s=self.file_stream_timeout_s_var.get(), # Ensure this is an int
                    cancel_event=self.cancel_operation_event # Pass the event
                )
            # 'with open' block has exited, so outfile_handle is closed.
            # Now process based on status.
            if status == "OK":
                try:
                    if os.path.exists(final_download_path):
                        logger.info("GUI", "_execute_single_download", f"Target file {final_download_path} already exists. Attempting to overwrite.")
                        os.remove(final_download_path) # Attempt to remove the existing file
                    
                    os.rename(temp_download_path, final_download_path)
                    logger.info("GUI", "_execute_single_download", f"Successfully downloaded and renamed {file_info['name']} to {final_download_path}")
                except OSError as e_os_finalize: # Catch errors from os.remove or os.rename
                    logger.error("GUI", "_execute_single_download", f"OS error during finalization of {file_info['name']} (temp: {temp_download_path}, final: {final_download_path}): {e_os_finalize}. Temporary file kept as {temp_download_filename}.")
                    self.master.after(0, self.update_overall_progress_label, f"Download OK, finalize failed for: {file_info['name']}. Temp file kept as {temp_download_filename}")
                    # Do not return; let the function complete its course for this file.
                    # The overall batch processing will continue.
                else: # os.remove (if needed) and os.rename were successful
                    self.master.after(0, self.update_file_progress, file_info['length'], file_info['length'], file_info['name']) # Ensure 100%
                    final_elapsed_time = time.time() - download_start_time
                    self.master.after(0, self.update_overall_progress_label, f"Completed: {file_info['name']} in {final_elapsed_time:.2f}s.")
                    self.master.after(0, lambda f_name=file_info['name']: self.file_tree.item(f_name, tags=('downloaded',)) if self.file_tree.exists(f_name) else None)
            
            else: # status is not "OK"
                self.master.after(0, logger.error, "GUI", "_execute_single_download", f"Download failed for {file_info['name']}. Status: {status}")
                if status == "fail_disconnected" or not self.dock.is_connected():
                    self.master.after(0, self.handle_auto_disconnect_ui)
                    self.master.after(0, self.update_overall_progress_label, f"Disconnected: {file_info['name']}. Partial file kept as {temp_download_filename}")
                elif status == "cancelled":
                    if hasattr(self, 'cancel_operation_event') and self.cancel_operation_event: 
                        self.cancel_operation_event.set() # Ensure event is set if stream_file reported cancel
                    logger.info("GUI", "_execute_single_download", f"Download of {file_info['name']} was cancelled.")
                    self.master.after(0, self.update_overall_progress_label, f"Cancelled: {file_info['name']}. Partial file kept as {temp_download_filename}")
                else: # Generic "fail" from stream_file
                    self.master.after(0, self.update_overall_progress_label, f"Failed: {file_info['name']}. Partial file kept as {temp_download_filename}")
                # In all these non-"OK" cases, the temporary file (potentially partial) is kept.

        except ConnectionError as ce:
            self.master.after(0, logger.error, "GUI", "_execute_single_download", f"ConnectionError during download for {file_info['name']}: {ce}")
            self.master.after(0, self.handle_auto_disconnect_ui)
            # If a ConnectionError occurs, the temp file might exist. It's kept.
            self.master.after(0, self.update_overall_progress_label, f"Connection Error with {file_info['name']}. Temp file kept as {temp_download_filename}")
        except Exception as e: # Catch other exceptions for this specific file download
            self.master.after(0, logger.error, "GUI", "_execute_single_download", f"Error during download of {file_info['name']}: {e}\n{traceback.format_exc()}")
            if not self.dock.is_connected(): # If any other exception also led to disconnect
                self.master.after(0, self.handle_auto_disconnect_ui)
            # An unexpected error occurred. The temp file might exist. It's kept.
            self.master.after(0, self.update_overall_progress_label, f"Error with {file_info['name']}. Temp file kept as {temp_download_filename}")

    def update_file_progress(self, received, total, file_name):
        if total > 0:
            percentage = (received / total) * 100
            self.file_progress_bar['value'] = percentage
            # self.overall_progress_label.config(text=f"Downloading {file_name}: {received}/{total} ({percentage:.2f}%)")
        else:
            self.file_progress_bar['value'] = 0
        self.master.update_idletasks() # Force update of progress bar

    def update_overall_progress_label(self, message):
        self.overall_progress_label.config(text=message)

    def on_closing(self):
        if self._recording_check_timer_id:
            self.master.after_cancel(self._recording_check_timer_id)
            self._recording_check_timer_id = None
        
        if self._auto_file_refresh_timer_id:
            self.master.after_cancel(self._auto_file_refresh_timer_id)
            self._auto_file_refresh_timer_id = None
        
        if self.is_audio_playing:
            self._stop_audio_playback()
        if pygame and pygame.mixer.get_init(): pygame.mixer.quit()

        # Save current config (like download directory)
        self.config["autoconnect"] = self.autoconnect_var.get() # Ensure latest state is saved
        self.config["download_directory"] = self.download_directory
        self.config["log_level"] = self.log_level_var.get()
        self.config["selected_vid"] = self.selected_vid_var.get()
        self.config["selected_pid"] = self.selected_pid_var.get()
        self.config["target_interface"] = self.target_interface_var.get()
        self.config["recording_check_interval_s"] = self.recording_check_interval_var.get()
        self.config["default_command_timeout_ms"] = self.default_command_timeout_ms_var.get()
        self.config["file_stream_timeout_s"] = self.file_stream_timeout_s_var.get()
        self.config["auto_refresh_files"] = self.auto_refresh_files_var.get()
        self.config["auto_refresh_interval_s"] = self.auto_refresh_interval_s_var.get()
        self.config["quit_without_prompt_if_connected"] = self.quit_without_prompt_var.get()
        self.config["theme"] = self.theme_var.get()
        save_config(self.config)

        should_prompt_disconnect = self.dock and self.dock.is_connected()
        
        if should_prompt_disconnect:
            if self.quit_without_prompt_var.get() or \
               messagebox.askokcancel("Quit", "Do you want to quit? This will disconnect the HiDock device."):
                logger.info("GUI", "on_closing", "Quit without prompt enabled. Disconnecting and closing.")
                self.dock.disconnect()
                self.master.destroy()
        else:
            self.master.destroy()

# --- Main Execution ---
if __name__ == "__main__":
    root = tk.Tk()
    # app is created after root, so theme can be applied to root in app.__init__
    app = HiDockToolGUI(root)
    root.mainloop()