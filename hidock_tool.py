import os # For PYGAME_HIDE_SUPPORT_PROMPT
os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = "1" # Suppress Pygame welcome message

import usb.core
import usb.util
import usb.backend.libusb1 # Explicitly import the backend
import time
import struct
from datetime import datetime
import customtkinter as ctk # MODIFIED
import tkinter # ADDED for Menu
from tkinter import filedialog, messagebox # MODIFIED (simpledialog removed, some dialogs from tkinter kept)
import threading
import traceback # For detailed error logging
import tempfile # For temporary audio files
import subprocess # For opening directories
import sys # For platform detection
import json

from PIL import Image, ImageTk # ADDED

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

# --- Logger ---
CONFIG_FILE = "hidock_tool_config.json"

def load_config():
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"[INFO] Config::load_config - {CONFIG_FILE} not found, using defaults.")
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
            "appearance_mode": "System", # MODIFIED for customtkinter
            "color_theme": "blue",      # MODIFIED for customtkinter
            "suppress_console_output": False,
            "window_geometry": "900x800+100+100", # Adjusted default size
            "treeview_columns_display_order": "name,size,duration,date,time,status",
            "logs_pane_visible": False,
            "gui_log_filter_level": "DEBUG",
            "loop_playback": False,
            "playback_volume": 0.5,
            "treeview_sort_col_id": "time", # Default sort by time
            "treeview_sort_descending": True, # Default sort descending (newest first),
            "suppress_gui_log_output": False, # ADDED: New setting
            "log_colors": { # ADDED: Default log colors
                "ERROR":    ["#FF6347", "#FF4747"],    # Tomato Red / Lighter Red
                "WARNING":  ["#FFA500", "#FFB732"],    # Orange / Lighter Orange
                "INFO":     ["#606060", "#A0A0A0"],    # Dark Grey / Light Grey
                "DEBUG":    ["#202020", "#D0D0D0"],    # Very Dark Grey / Very Light Grey
                "CRITICAL": ["#DC143C", "#FF0000"]     # Crimson / Bright Red
            }
        }
    except json.JSONDecodeError:
        print(f"[ERROR] Config::load_config - Error decoding {CONFIG_FILE}. Using defaults.")
        # Return defaults on decode error as well (copied from FileNotFoundError block and updated)
        return {
            "autoconnect": False, "download_directory": os.getcwd(), "log_level": "INFO",
            "selected_vid": DEFAULT_VENDOR_ID, "selected_pid": DEFAULT_PRODUCT_ID,
            "target_interface": 0, "recording_check_interval_s": 3,
            "default_command_timeout_ms": 5000, "file_stream_timeout_s": 180,
            "auto_refresh_files": False, "auto_refresh_interval_s": 30,
            "quit_without_prompt_if_connected": False,
            "appearance_mode": "System", "color_theme": "blue",
            "suppress_console_output": False,
            "window_geometry": "900x800+100+100",
            "treeview_columns_display_order": "name,size,duration,date,time,status",
            "logs_pane_visible": False,
            "gui_log_filter_level": "DEBUG",
            "loop_playback": False,
            "playback_volume": 0.5,
            "treeview_sort_col_id": "time",
            "treeview_sort_descending": True,
            "suppress_gui_log_output": False, # ADDED: New setting
            "log_colors": {
                "ERROR":    ["#FF6347", "#FF4747"],
                "WARNING":  ["#FFA500", "#FFB732"],
                "INFO":     ["#606060", "#A0A0A0"],
                "DEBUG":    ["#202020", "#D0D0D0"],
                "CRITICAL": ["#DC143C", "#FF0000"]
            }
        }

class Logger:
    LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
    # ANSI escape codes for console colors
    COLOR_RED = '\033[91m'      # Error, Critical
    COLOR_YELLOW = '\033[93m'   # Warning
    COLOR_GREY = '\033[90m'     # Debug (Bright Black / Dark Grey)
    COLOR_WHITE = '\033[97m'    # Info (Bright White)
    COLOR_RESET = '\033[0m'     # Reset all attributes

    def __init__(self, initial_config=None):
        self.gui_log_callback = None
        self.config = initial_config if initial_config else {}
        self.set_level(self.config.get("log_level", "INFO"))

    def set_gui_log_callback(self, callback):
        self.gui_log_callback = callback

    def set_level(self, level_name):
        # Store the current level if it exists, to correctly log the change message
        # This ensures the "Log level set to..." message itself is logged correctly.
        # previous_internal_level = self.level if hasattr(self, 'level') else self.LEVELS["INFO"]
        
        new_level_value = self.LEVELS.get(level_name.upper(), self.LEVELS["INFO"])
        self.level = new_level_value # Set the new level first

        # Log the change. If the new level is very high (e.g., CRITICAL),
        # this INFO message might be suppressed. So, temporarily use INFO level for this specific log.
        current_actual_level = self.level
        if current_actual_level > self.LEVELS["INFO"]: self.level = self.LEVELS["INFO"]
        self._log("info", "Logger", "set_level", f"Log level set to {level_name.upper()}")
        self.level = current_actual_level # Restore the actual new level

    def update_config(self, new_config_dict):
        self.config.update(new_config_dict)

    def _log(self, level_str, module, procedure, message):
        msg_level_val = self.LEVELS.get(level_str.upper())
        if msg_level_val is None or msg_level_val < self.level:
            return

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        # Base log message (uncolored, for GUI and potentially for non-error console)
        base_log_message = f"[{timestamp}][{level_str.upper()}] {str(module)}::{str(procedure)} - {message}"

        if not self.config.get("suppress_console_output", False):
            level_upper = level_str.upper()
            console_message = base_log_message

            if level_upper in ["ERROR", "CRITICAL"]:
                console_message = f"{self.COLOR_RED}{base_log_message}{self.COLOR_RESET}"
                sys.stderr.write(console_message + "\n")
                sys.stderr.flush() # Ensure it's written immediately
            elif level_upper == "WARNING":
                console_message = f"{self.COLOR_YELLOW}{base_log_message}{self.COLOR_RESET}"
                print(console_message) # Warnings can go to stdout
            elif level_upper == "INFO":
                console_message = f"{self.COLOR_WHITE}{base_log_message}{self.COLOR_RESET}"
                print(console_message) # Info to stdout
            elif level_upper == "DEBUG":
                console_message = f"{self.COLOR_GREY}{base_log_message}{self.COLOR_RESET}"
                print(console_message) # Debug to stdout
            else: # Fallback for any other unforeseen level
                print(base_log_message) # Regular print to stdout

        if self.gui_log_callback:
            if not self.config.get("suppress_gui_log_output", False): # Check new flag
                # GUI callback always gets the uncolored base message
                self.gui_log_callback(base_log_message + "\n", level_str.upper())

    def info(self, module, procedure, message): self._log("info", module, procedure, message)
    def debug(self, module, procedure, message): self._log("debug", module, procedure, message)
    def error(self, module, procedure, message): self._log("error", module, procedure, message)
    def warning(self, module, procedure, message): self._log("warning", module, procedure, message)

logger = Logger(initial_config=load_config())

def save_config(config_data):
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, indent=4)
        logger.info("Config", "save_config", f"Configuration saved to {CONFIG_FILE}")
    except IOError:
        logger.error("Config", "save_config", f"Error writing to {CONFIG_FILE}.")
    except Exception as e:
        logger.error("Config", "save_config", f"Unexpected error saving config: {e}")

# --- HiDock Communication Class (UNCHANGED) ---
class HiDockJensen:
    def __init__(self, usb_backend_instance_ref): # Modified to accept backend
        self.usb_backend = usb_backend_instance_ref # Store the backend instance
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
        if not self.usb_backend:
            logger.error("Jensen", "_find_device", "USB backend is not available to HiDockJensen.")
            raise ConnectionError("USB backend not available to HiDockJensen class.")
        logger.debug("Jensen", "_find_device", f"Looking for VID={hex(vid_to_find)}, PID={hex(pid_to_find)}")
        device = usb.core.find(idVendor=vid_to_find, idProduct=pid_to_find, backend=self.usb_backend) # Use stored backend
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

        try:
            if self.device.is_kernel_driver_active(target_interface_number):
                logger.info("Jensen", "connect", f"Kernel driver is active on Interface {target_interface_number}. Attempting to detach.")
                self.device.detach_kernel_driver(target_interface_number)
                logger.info("Jensen", "connect", f"Detached kernel driver from Interface {target_interface_number}.")
                self.detached_kernel_driver_on_interface = target_interface_number
        except usb.core.USBError as e:
            logger.info("Jensen", "connect", f"Could not detach kernel driver from Interface {target_interface_number}: {e} (This is often ignorable on Windows or if no driver was attached).")
        except NotImplementedError:
            logger.info("Jensen", "connect", "Kernel driver detach not implemented/needed on this platform (e.g., Windows).")

        try:
            self.device.set_configuration()
            logger.info("Jensen", "connect", "Device configuration set.")
        except usb.core.USBError as e:
            if e.errno == 16: 
                logger.info("Jensen", "connect", "Configuration already set or interface busy (this is often OK).")
            else:
                logger.error("Jensen", "connect", f"Could not set configuration: {e} (errno: {e.errno})")
                self.disconnect() 
                return False

        cfg = self.device.get_active_configuration()
        intf = None
        try:
            intf = usb.util.find_descriptor(cfg, bInterfaceNumber=target_interface_number)
            if intf is None:
                raise usb.core.USBError(f"Interface {target_interface_number} found but is None.")
            logger.info("Jensen", "connect", f"Found Interface {intf.bInterfaceNumber}, Alternate Setting {intf.bAlternateSetting}")
        except usb.core.USBError as e:
            logger.error("Jensen", "connect", f"Could not find Interface {target_interface_number}: {e}")
            self.disconnect()
            return False

        try:
            usb.util.claim_interface(self.device, intf.bInterfaceNumber)
            self.claimed_interface_number = intf.bInterfaceNumber
            logger.info("Jensen", "connect", f"Claimed Interface {self.claimed_interface_number}")
        except usb.core.USBError as e:
            logger.error("Jensen", "connect", f"Could not claim Interface {intf.bInterfaceNumber}: {e} (errno: {e.errno})")
            if e.errno == 16: 
                logger.error("Jensen", "connect", "Interface busy. Another program or driver might be using it.")
            self.disconnect() 
            return False

        self.ep_out = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_OUT and \
                                   (e.bEndpointAddress & 0x0F) == (EP_OUT_ADDR & 0x0F)
        )
        self.ep_in = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_IN and \
                                   (e.bEndpointAddress & 0x0F) == (EP_IN_ADDR & 0x7F) 
        )

        if self.ep_out is None or self.ep_in is None:
            logger.error("Jensen", "connect", f"Could not find required IN/OUT endpoints ({hex(EP_OUT_ADDR)}/{hex(EP_IN_ADDR)}) on Interface {target_interface_number}.")
            self.disconnect()
            return False

        logger.info("Jensen", "connect", f"Using Interface {target_interface_number}. EP_OUT: {hex(self.ep_out.bEndpointAddress)}, EP_IN: {hex(self.ep_in.bEndpointAddress)}")

        if self.device.idProduct == 0xAF0C: self.model = "hidock-h1"
        elif self.device.idProduct == 0xAF0D: self.model = "hidock-h1e"
        elif self.device.idProduct == 0xAF0E: self.model = "hidock-p1"
        elif self.device.idProduct == pid : self.model = f"HiDock Device (PID: {hex(pid)})"
        else: self.model = f"unknown (PID: {hex(self.device.idProduct)})"
        logger.info("Jensen", "connect", f"Device model determined as: {self.model}")
        
        self.is_connected_flag = True
        return True

    def disconnect(self):
        with self._usb_lock:
            if not self.is_connected_flag and not self.device:
                logger.info("Jensen", "disconnect", "Already disconnected or no device object.")
                self.device = None; self.ep_out = None; self.ep_in = None
                self.claimed_interface_number = -1; self.detached_kernel_driver_on_interface = -1
                self.is_connected_flag = False; self.receive_buffer.clear()
                return

            logger.info("Jensen", "disconnect", "Disconnecting from device...")
            if self.device:
                if self.claimed_interface_number != -1:
                    try:
                        usb.util.release_interface(self.device, self.claimed_interface_number)
                        logger.info("Jensen", "disconnect", f"Released Interface {self.claimed_interface_number}.")
                    except usb.core.USBError as e:
                        logger.warning("Jensen", "disconnect", f"Could not release Interface {self.claimed_interface_number}: {e}")
                
                if self.detached_kernel_driver_on_interface != -1:
                    try:
                        self.device.attach_kernel_driver(self.detached_kernel_driver_on_interface)
                        logger.info("Jensen", "disconnect", f"Re-attached kernel driver to Interface {self.detached_kernel_driver_on_interface}.")
                    except Exception as e:
                        logger.info("Jensen", "disconnect", f"Could not re-attach kernel driver: {e} (often ignorable).")

                usb.util.dispose_resources(self.device)
            self.device = None; self.ep_out = None; self.ep_in = None
            self.claimed_interface_number = -1; self.detached_kernel_driver_on_interface = -1
            self.is_connected_flag = False; self.receive_buffer.clear()
            self.device_info = {}; self.model = "unknown"
            logger.info("Jensen", "disconnect", "Disconnected and resources disposed.")

    def _build_packet(self, command_id, body_bytes=b''):
        self.sequence_id += 1
        header = bytearray([0x12, 0x34])
        header.extend(struct.pack('>H', command_id))
        header.extend(struct.pack('>I', self.sequence_id))
        header.extend(struct.pack('>I', len(body_bytes)))
        return bytes(header) + body_bytes

    def _send_command(self, command_id, body_bytes=b'', timeout_ms=5000):
        if not self.device or not self.ep_out:
            logger.error("Jensen", "_send_command", "Not connected or ep_out missing.")
            if self.is_connected(): self.disconnect()
            raise ConnectionError("Device not connected or output endpoint not found.")
        
        packet = self._build_packet(command_id, body_bytes)
        logger.debug("Jensen", "_send_command", f"Sending CMD: {command_id}, Seq: {self.sequence_id}, Len: {len(body_bytes)}, Data: {packet.hex()[:64]}...")
        try:
            bytes_sent = self.ep_out.write(packet, timeout=int(timeout_ms))
            if bytes_sent != len(packet):
                logger.warning("Jensen", "_send_command", f"Sent {bytes_sent} != packet len {len(packet)} for CMD {command_id}.")
        except usb.core.USBError as e:
            logger.error("Jensen", "_send_command", f"USB write error CMD {command_id}: {e}")
            if e.errno == 32: # LIBUSB_ERROR_PIPE
                try: self.device.clear_halt(self.ep_out.bEndpointAddress); logger.info("Jensen", "_send_command", "Cleared halt on EP_OUT")
                except Exception as ce: logger.error("Jensen", "_send_command", f"Failed to clear halt: {ce}")
            raise 
        return self.sequence_id

    def _receive_response(self, expected_seq_id, timeout_ms=5000, streaming_cmd_id=None):
        if not self.device or not self.ep_in:
            logger.error("Jensen", "_receive_response", "Not connected or ep_in missing.")
            if self.is_connected(): self.disconnect()
            raise ConnectionError("Device not connected or input endpoint not found.")

        start_time = time.time()
        overall_timeout_sec = timeout_ms / 1000.0

        while time.time() - start_time < overall_timeout_sec:
            try:
                read_size = self.ep_in.wMaxPacketSize * 32 if self.ep_in.wMaxPacketSize else 2048 # Increased read size
                data_chunk = self.device.read(self.ep_in.bEndpointAddress, read_size, timeout=100) # Short individual timeout
                if data_chunk:
                    self.receive_buffer.extend(data_chunk)
                    logger.debug("Jensen", "_receive_response", f"Rcvd chunk: {bytes(data_chunk).hex()[:32]}... Buf len: {len(self.receive_buffer)}")
            except usb.core.USBTimeoutError: pass # Expected if no data
            except usb.core.USBError as e:
                logger.error("Jensen", "_receive_response", f"USB read error: {e}")
                if e.errno == 32: # LIBUSB_ERROR_PIPE
                    try: self.device.clear_halt(self.ep_in.bEndpointAddress); logger.info("Jensen", "_receive_response", "Cleared halt on EP_IN")
                    except Exception as ce: logger.error("Jensen", "_receive_response", f"Failed to clear halt on EP_IN: {ce}")
                return None 

            # Find sync marker if buffer is misaligned
            if len(self.receive_buffer) >= 2 and not (self.receive_buffer[0] == 0x12 and self.receive_buffer[1] == 0x34):
                sync_offset = self.receive_buffer.find(b'\x12\x34')
                if sync_offset != -1:
                    if sync_offset > 0: logger.warning("Jensen", "_receive_response", f"Discarded {sync_offset} prefix bytes: {self.receive_buffer[:sync_offset].hex()}")
                    self.receive_buffer = self.receive_buffer[sync_offset:]
                # else: marker not found yet, continue reading

            while len(self.receive_buffer) >= 12: # Min header size
                if not (self.receive_buffer[0] == 0x12 and self.receive_buffer[1] == 0x34):
                    logger.error("Jensen", "_receive_response", f"Invalid header sync after find: {self.receive_buffer[:2].hex()}. Breaking parse.")
                    break 

                header_prefix = self.receive_buffer[:12]
                response_cmd_id, response_seq_id, body_len_from_header = struct.unpack('>HII', header_prefix[2:])
                checksum_len = (body_len_from_header >> 24) & 0xFF
                body_len = body_len_from_header & 0x00FFFFFF
                total_msg_len = 12 + body_len + checksum_len

                if len(self.receive_buffer) >= total_msg_len:
                    msg_bytes_full = self.receive_buffer[:total_msg_len]
                    self.receive_buffer = self.receive_buffer[total_msg_len:] 

                    if response_seq_id == expected_seq_id or \
                       (streaming_cmd_id is not None and response_cmd_id == streaming_cmd_id):
                        logger.debug("Jensen", "_receive_response", f"RSP for CMD: {response_cmd_id}, Seq: {response_seq_id}, BodyLen: {body_len}, Body: {msg_bytes_full[12:12+body_len].hex()[:64]}...")
                        return {"id": response_cmd_id, "sequence": response_seq_id, "body": msg_bytes_full[12:12+body_len]}
                    else:
                        logger.warning("Jensen", "_receive_response", f"Seq/CMD mismatch. Expected Seq: {expected_seq_id}, Got CMD: {response_cmd_id} Seq: {response_seq_id}. Discarding.")
                else: break # Not enough data for full message

            if time.time() - start_time >= overall_timeout_sec: break

        logger.warning("Jensen", "_receive_response", f"Timeout for seq_id {expected_seq_id}. Buffer: {self.receive_buffer.hex()}")
        return None

    def _send_and_receive(self, command_id, body_bytes=b'', timeout_ms=5000):
        with self._usb_lock:
            try:
                if command_id != CMD_TRANSFER_FILE: self.receive_buffer.clear()
                seq_id = self._send_command(command_id, body_bytes, timeout_ms)
                return self._receive_response(seq_id, int(timeout_ms), streaming_cmd_id=CMD_TRANSFER_FILE if command_id == CMD_TRANSFER_FILE else None)
            except usb.core.USBError as e:
                logger.error("Jensen", "_send_and_receive", f"USBError CMD {command_id}: {e}")
                if self.is_connected(): self.disconnect()
                raise
            except ConnectionError as e: 
                logger.error("Jensen", "_send_and_receive", f"ConnectionError CMD {command_id}: {e}")
                raise 

    def get_device_info(self, timeout_s=5):
        response = self._send_and_receive(CMD_GET_DEVICE_INFO, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_GET_DEVICE_INFO:
            body = response["body"]
            if len(body) >= 4:
                version_code_bytes = body[0:4]
                version_number_raw = struct.unpack('>I', version_code_bytes)[0]
                version_code_str = ".".join(map(str, version_code_bytes[1:]))
                serial_number_str = "N/A"
                if len(body) > 4:
                    serial_number_bytes = body[4:20]
                    try:
                        printable_sn_bytes = bytearray(b for b in serial_number_bytes if 32 <= b <= 126 or b == 0)
                        null_idx = printable_sn_bytes.find(0)
                        if null_idx != -1: printable_sn_bytes = printable_sn_bytes[:null_idx]
                        serial_number_str = printable_sn_bytes.decode('ascii', errors='ignore').strip()
                        if not serial_number_str: serial_number_str = serial_number_bytes.hex()
                    except UnicodeDecodeError: serial_number_str = serial_number_bytes.hex()
                
                self.device_info = {"versionCode": version_code_str, "versionNumber": version_number_raw, "sn": serial_number_str}
                logger.info("Jensen", "get_device_info", f"Parsed Device Info: {self.device_info}")
                return self.device_info
            else: logger.error("Jensen", "get_device_info", "Body too short for version.")
        logger.error("Jensen", "get_device_info", "Failed to get device info or invalid response.")
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
        logger.error("Jensen", "get_file_count", "Failed to get file count.")
        return None

    def list_files(self, timeout_s=20):
        if not self.device_info.get("versionNumber"):
            if not self.get_device_info():
                logger.error("Jensen", "list_files", "Failed to get device info for version check.")
                return None 

        file_list_aggregate_data = bytearray()
        expected_files_from_count_cmd = -1
        current_version_number = self.device_info.get("versionNumber", float('inf'))

        if current_version_number <= 327722: # 0x5002A
            count_info = self.get_file_count(timeout_s=5)
            if not count_info or count_info.get("count", -1) == 0:
                return {"files": [], "totalFiles": 0, "totalSize": 0}
            expected_files_from_count_cmd = count_info["count"]
        
        response = self._send_and_receive(CMD_GET_FILE_LIST, timeout_ms=int(timeout_s * 1000))
        if not response or response["id"] != CMD_GET_FILE_LIST:
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
        
        parsed_file_count = 0
        while offset < len(data_view):
            try:
                if offset + 4 > len(data_view): break
                file_version = data_view[offset]; offset += 1
                name_len = struct.unpack('>I', b'\x00' + data_view[offset:offset+3])[0]; offset += 3
                if offset + name_len > len(data_view): break
                filename = "".join(chr(b) for b in data_view[offset : offset + name_len] if b > 0); offset += name_len
                
                min_remaining = 4 + 6 + 16 # length + unknown + signature
                if offset + min_remaining > len(data_view): break
                file_length_bytes = struct.unpack('>I', data_view[offset : offset + 4])[0]; offset += 4
                offset += 6 # Skip unknown
                signature_hex = data_view[offset : offset + 16].hex(); offset += 16

                create_date_str, create_time_str, time_obj, duration_sec = "", "", None, 0
                try:
                    if (filename.endswith((".wav", ".hda"))) and "REC" in filename.upper() and len(filename) >= 14 and filename[:14].isdigit():
                        time_obj = datetime.strptime(filename[:14], "%Y%m%d%H%M%S")
                    elif (filename.endswith((".hda", ".wav"))):
                        name_parts = filename.split('-')
                        if len(name_parts) > 1:
                            date_str_part, time_part_str = name_parts[0], name_parts[1][:6]
                            year_str, month_str_abbr, day_str = "", "", ""
                            if len(date_str_part) >= 7:
                                if date_str_part[:-5].isdigit() and len(date_str_part[:-5]) == 4: #
                                    year_str, month_str_abbr, day_str = date_str_part[:4], date_str_part[4:7], date_str_part[7:]
                                elif date_str_part[:-5].isdigit() and len(date_str_part[:-5]) == 2: # YY
                                    year_str, month_str_abbr, day_str = "20" + date_str_part[:2], date_str_part[2:5], date_str_part[5:]
                            month_map = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6, "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
                            if year_str and month_str_abbr in month_map and day_str.isdigit() and time_part_str.isdigit() and len(day_str)>0:
                                time_obj = datetime(int(year_str), month_map[month_str_abbr], int(day_str), int(time_part_str[0:2]), int(time_part_str[2:4]), int(time_part_str[4:6]))
                except (ValueError, IndexError) as date_e: logger.debug("Parser", "list_files_date", f"Date parse error for {filename}: {date_e}")
                
                if time_obj:
                    create_date_str, create_time_str = time_obj.strftime("%Y/%m/%d"), time_obj.strftime("%H:%M:%S")
                else: logger.warning("Parser", "list_files", f"Failed to parse date for: {filename}")

                if file_version == 1: duration_sec = (file_length_bytes / 32) * 2 
                elif file_version == 2: duration_sec = (file_length_bytes - 44) / (48000 * 2 * 1) if file_length_bytes > 44 else 0 
                elif file_version == 3: duration_sec = (file_length_bytes - 44) / (24000 * 2 * 1) if file_length_bytes > 44 else 0
                elif file_version == 5: duration_sec = file_length_bytes / 12000 
                else: duration_sec = file_length_bytes / (16000*2*1) 

                files.append({"name": filename, "createDate": create_date_str, "createTime": create_time_str, "time": time_obj, "duration": duration_sec, "version": file_version, "length": file_length_bytes, "signature": signature_hex})
                total_size_bytes += file_length_bytes
                parsed_file_count += 1
                if (total_files_from_header != -1 and parsed_file_count >= total_files_from_header) or \
                   (expected_files_from_count_cmd != -1 and parsed_file_count >= expected_files_from_count_cmd): break
            except (struct.error, IndexError) as e:
                logger.error("Jensen", "list_files_parser", f"Parsing error: {e}. Offset: {offset}, Buf len: {len(data_view)}")
                break
        
        valid_files = [f for f in files if f.get("time")]
        logger.info("Jensen", "list_files", f"Parsed {len(valid_files)} valid files.")
        return {"files": valid_files, "totalFiles": len(valid_files), "totalSize": total_size_bytes}

    def stream_file(self, filename, file_length, data_callback, progress_callback=None, timeout_s=180, cancel_event: threading.Event = None):
        with self._usb_lock:
            status_to_return = "fail"
            try:
                logger.info("Jensen", "stream_file", f"Streaming {filename}, length {file_length}")
                initial_seq_id = self._send_command(CMD_TRANSFER_FILE, filename.encode('ascii', errors='ignore'), timeout_ms=10000)
                if cancel_event and cancel_event.is_set(): return "cancelled"
                
                bytes_received = 0
                start_time = time.time()
                while bytes_received < file_length and time.time() - start_time < timeout_s:
                    if cancel_event and cancel_event.is_set(): status_to_return = "cancelled"; break
                    
                    response = self._receive_response(initial_seq_id, 15000, streaming_cmd_id=CMD_TRANSFER_FILE)
                    if response and response["id"] == CMD_TRANSFER_FILE:
                        chunk = response["body"]
                        if not chunk:
                            if bytes_received >= file_length: break
                            time.sleep(0.1); continue
                        bytes_received += len(chunk)
                        data_callback(chunk)
                        if progress_callback: progress_callback(bytes_received, file_length)
                        if bytes_received >= file_length: status_to_return = "OK"; break
                    elif response is None: logger.error("Jensen", "stream_file", "Timeout/error receiving chunk."); break
                    else: logger.warning("Jensen", "stream_file", f"Unexpected response ID {response['id']}."); break
                
                if status_to_return == "fail" and bytes_received < file_length:
                    logger.error("Jensen", "stream_file", f"Incomplete: {bytes_received}/{file_length}")
                    if not self.is_connected(): status_to_return = "fail_disconnected"
                elif status_to_return == "OK": logger.info("Jensen", "stream_file", "Stream success.")
            
            finally:
                self.receive_buffer.clear()
                if status_to_return != "OK" and self.device and self.ep_in: 
                    logger.debug("Jensen", "stream_file", "Attempting to flush stale IN data.")
                    for _ in range(20): 
                        try:
                            if not self.device.read(self.ep_in.bEndpointAddress, self.ep_in.wMaxPacketSize * 16, timeout=50): break
                        except usb.core.USBTimeoutError: break
                        except usb.core.USBError: break
            return status_to_return

    def delete_file(self, filename, timeout_s=10):
        response = self._send_and_receive(CMD_DELETE_FILE, filename.encode('ascii', errors='ignore'), timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_DELETE_FILE:
            result_code = response["body"][0] if response["body"] else 2
            status_map = {0: "success", 1: "not-exists", 2: "failed"}
            status_str = status_map.get(result_code, "unknown_error")
            logger.info("Jensen", "delete_file", f"Delete {filename}: {status_str} (code: {result_code})")
            return {"result": status_str, "code": result_code}
        logger.error("Jensen", "delete_file", f"Failed delete response for {filename}.")
        return {"result": "failed", "code": -1, "error": "No/invalid response"}

    def get_card_info(self, timeout_s=5):
        response = self._send_and_receive(CMD_GET_CARD_INFO, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_GET_CARD_INFO and len(response["body"]) >= 12:
            body = response["body"]
            used, capacity, status_raw = struct.unpack('>III', body[:12])
            logger.info("Jensen", "get_card_info", f"Card: Used={used}, Total={capacity}, Status={hex(status_raw)}")
            return {"used": used, "capacity": capacity, "status_raw": status_raw}
        logger.error("Jensen", "get_card_info", "Failed to get card info.")
        return None

    def format_card(self, timeout_s=60):
        response = self._send_and_receive(CMD_FORMAT_CARD, body_bytes=bytes([1,2,3,4]), timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_FORMAT_CARD:
            result_code = response["body"][0] if response["body"] else 1
            status_str = "success" if result_code == 0 else "failed"
            logger.info("Jensen", "format_card", f"Format status: {status_str} (code: {result_code})")
            return {"result": status_str, "code": result_code}
        logger.error("Jensen", "format_card", "Failed format response.")
        return {"result": "failed", "code": -1, "error": "No/invalid response"}

    def get_recording_file(self, timeout_s=5):
        response = self._send_and_receive(CMD_GET_RECORDING_FILE, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_GET_RECORDING_FILE:
            if not response["body"]: 
                logger.debug("Jensen", "get_recording_file", "No recording file info (empty body).")
                return None
            filename_bytes = response["body"]
            try:
                printable_bytes = bytearray(b for b in filename_bytes if 32 <= b <= 126 or b == 0)
                null_idx = printable_bytes.find(0)
                if null_idx != -1: printable_bytes = printable_bytes[:null_idx]
                filename = printable_bytes.decode('ascii').strip()
            except UnicodeDecodeError: filename = filename_bytes.hex()
            
            if not filename: logger.info("Jensen", "get_recording_file", "Decoded recording filename is empty."); return None
            logger.debug("Jensen", "get_recording_file", f"Current/Last recording: {filename}")
            return {"name": filename, "status": "recording_active_or_last"}
        logger.error("Jensen", "get_recording_file", "Failed to get recording file info.")
        return None

    def _to_bcd(self, value: int) -> int:
        if not (0 <= value <= 99): return 0
        return (value // 10 << 4) | (value % 10)

    def set_device_time(self, dt_object: datetime, timeout_s=5):
        year = dt_object.year
        payload = bytes([self._to_bcd(year // 100), self._to_bcd(year % 100),
                         self._to_bcd(dt_object.month), self._to_bcd(dt_object.day),
                         self._to_bcd(dt_object.hour), self._to_bcd(dt_object.minute),
                         self._to_bcd(dt_object.second)])
        response = self._send_and_receive(CMD_SET_DEVICE_TIME, payload, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_SET_DEVICE_TIME and response["body"] and response["body"][0] == 0:
            logger.info("Jensen", "set_device_time", "Device time set successfully.")
            return {"result": "success"}
        err_code = response["body"][0] if response and response["body"] else -1
        logger.error("Jensen", "set_device_time", f"Failed to set time. Device code: {err_code}.")
        return {"result": "failed", "error": "Device error.", "device_code": err_code}

    def get_device_settings(self, timeout_s=5):
        response = self._send_and_receive(CMD_GET_SETTINGS, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_GET_SETTINGS and len(response["body"]) >= 4:
            body = response["body"]
            settings = {"autoRecord": bool(body[0]), "autoPlay": bool(body[1]),
                        "bluetoothTone": bool(body[2]), "notificationSound": bool(body[3])}
            self.device_behavior_settings.update(settings)
            logger.info("Jensen", "get_device_settings", f"Received settings: {settings}")
            return settings
        logger.error("Jensen", "get_device_settings", f"Failed to get settings. Response: {response}")
        return None

    def set_device_setting(self, setting_name: str, value: bool, timeout_s=5):
        setting_map = {"autoRecord": 0, "autoPlay": 1, "bluetoothTone": 2, "notificationSound": 3}
        if setting_name not in setting_map:
            logger.error("Jensen", "set_device_setting", f"Unknown setting: {setting_name}")
            return {"result": "failed", "error": "Unknown setting name"}
        payload = bytes([setting_map[setting_name], 1 if value else 0])
        response = self._send_and_receive(CMD_SET_SETTINGS, payload, timeout_ms=int(timeout_s * 1000))
        if response and response["id"] == CMD_SET_SETTINGS and response["body"] and response["body"][0] == 0:
            logger.info("Jensen", "set_device_setting", f"Set '{setting_name}' to {value}.")
            self.device_behavior_settings[setting_name] = value
            return {"result": "success"}
        logger.error("Jensen", "set_device_setting", f"Failed to set '{setting_name}'. Response: {response}")
        return {"result": "failed", "error": "Device error or invalid response."}


# --- customtkinter GUI Application ---
class HiDockToolGUI(ctk.CTk): # MODIFIED: Inherit from ctk.CTk
    def __init__(self, *args, **kwargs): # MODIFIED: Master is self for CTk
        super().__init__(*args, **kwargs)
        self.config = load_config()

        self.title("HiDock Explorer Tool")
        saved_geometry = self.config.get("window_geometry", "900x800+100+100")
        try:
            self.geometry(saved_geometry)
        except Exception: # MODIFIED: More generic exception for geometry
            print(f"[WARNING] GUI::__init__ - Failed to apply saved geometry '{saved_geometry}'. Using default.")
            self.geometry("900x800+100+100")

        self.usb_backend_instance = None
        self.backend_initialized_successfully = False
        self.backend_init_error_message = "USB backend not yet initialized."
        try:
            self.backend_initialized_successfully, self.backend_init_error_message, self.usb_backend_instance = self._initialize_backend_early()
            if not self.backend_initialized_successfully:
                logger.error("GUI", "__init__", f"CRITICAL: USB backend init failed: {self.backend_init_error_message}")
        except Exception as e_backend_startup:
            self.backend_initialized_successfully = False
            self.backend_init_error_message = f"Unexpected Python error during USB backend init: {e_backend_startup}"
            logger.error("GUI", "__init__", f"CRITICAL: {self.backend_init_error_message}\n{traceback.format_exc()}")

        self.dock = HiDockJensen(self.usb_backend_instance)
        
        # Initialize tk Variables (customtkinter uses standard tk Vars)
        self.autoconnect_var = ctk.BooleanVar(value=self.config.get("autoconnect", False))
        self.download_directory = self.config.get("download_directory", os.getcwd())
        self.logger_processing_level_var = ctk.StringVar(value=self.config.get("log_level", "INFO"))
        self.selected_vid_var = ctk.IntVar(value=self.config.get("selected_vid", DEFAULT_VENDOR_ID))
        self.selected_pid_var = ctk.IntVar(value=self.config.get("selected_pid", DEFAULT_PRODUCT_ID))
        self.target_interface_var = ctk.IntVar(value=self.config.get("target_interface", 0))
        self.recording_check_interval_var = ctk.IntVar(value=self.config.get("recording_check_interval_s", 3))
        self.default_command_timeout_ms_var = ctk.IntVar(value=self.config.get("default_command_timeout_ms", 5000))
        self.file_stream_timeout_s_var = ctk.IntVar(value=self.config.get("file_stream_timeout_s", 180))
        self.auto_refresh_files_var = ctk.BooleanVar(value=self.config.get("auto_refresh_files", False))
        self.auto_refresh_interval_s_var = ctk.IntVar(value=self.config.get("auto_refresh_interval_s", 30))
        self.quit_without_prompt_var = ctk.BooleanVar(value=self.config.get("quit_without_prompt_if_connected", False))
        
        self.appearance_mode_var = ctk.StringVar(value=self.config.get("appearance_mode", "System")) # MODIFIED
        self.color_theme_var = ctk.StringVar(value=self.config.get("color_theme", "blue")) # MODIFIED

        self.suppress_console_output_var = ctk.BooleanVar(value=self.config.get("suppress_console_output", False))
        self.suppress_gui_log_output_var = ctk.BooleanVar(value=self.config.get("suppress_gui_log_output", False)) # ADDED
        self.gui_log_filter_level_var = ctk.StringVar(value=self.config.get("gui_log_filter_level", "DEBUG"))
        
        self.device_setting_auto_record_var = ctk.BooleanVar()
        self.device_setting_auto_play_var = ctk.BooleanVar()
        self.device_setting_bluetooth_tone_var = ctk.BooleanVar()
        self.device_setting_notification_sound_var = ctk.BooleanVar()

        self.treeview_columns_display_order_str = self.config.get("treeview_columns_display_order", "name,size,duration,date,time,status")
        
        self.logs_visible_var = ctk.BooleanVar(value=self.config.get("logs_pane_visible", False))
        self.logs_visible = self.logs_visible_var.get()
        
        self.loop_playback_var = ctk.BooleanVar(value=self.config.get("loop_playback", False))
        self.volume_var = ctk.DoubleVar(value=self.config.get("playback_volume", 0.5))

        self.saved_treeview_sort_column = self.config.get("treeview_sort_col_id", "time")
        self.saved_treeview_sort_reverse = self.config.get("treeview_sort_descending", True)

        # Initialize log color StringVars
        default_log_colors = {
            "ERROR":    ["#FF6347", "#FF4747"], "WARNING":  ["#FFA500", "#FFB732"],
            "INFO":     ["#606060", "#A0A0A0"], "DEBUG":    ["#202020", "#D0D0D0"],
            "CRITICAL": ["#DC143C", "#FF0000"]
        }
        loaded_log_colors = self.config.get("log_colors", default_log_colors)
        for level in Logger.LEVELS.keys():
            colors = loaded_log_colors.get(level, default_log_colors.get(level, ["#000000", "#FFFFFF"])) # Fallback
            setattr(self, f"log_color_{level.lower()}_light_var", ctk.StringVar(value=colors[0]))
            setattr(self, f"log_color_{level.lower()}_dark_var", ctk.StringVar(value=colors[1]))

        self.available_usb_devices = []
        self.displayed_files_details = []
        
        self.treeview_sort_column = None
        self.treeview_sort_reverse = False
        self._recording_check_timer_id = None
        self._auto_file_refresh_timer_id = None
        self._is_ui_refresh_in_progress = False
        self._previous_recording_filename = None
        self._fetched_device_settings_for_dialog = {}
        self.is_long_operation_active = False
        self.cancel_operation_event = None
        self.active_operation_name = None
        
        self.is_audio_playing = False
        self.current_playing_temp_file = None
        self.current_playing_filename_for_replay = None
        self.playback_update_timer_id = None
        self._user_is_dragging_slider = False
        self.playback_total_duration = 0.0
        self.playback_controls_frame = None

        self._is_button1_pressed_on_item = None # ADDED: For drag selection
        self._last_dragged_over_iid = None      # ADDED: For drag selection
        self._drag_action_is_deselect = False   # ADDED: To determine drag behavior

        self.default_progressbar_fg_color = None
        self.default_progressbar_progress_color = None

        self.original_tree_headings = {"name": "Name", "size": "Size (KB)", "duration": "Duration (s)", "date": "Date", "time": "Time", "status": "Status"}
        self.icons = {} # To store CTkImage objects

        global pygame
        if pygame:
            try:
                pygame.mixer.init()
                logger.info("GUI", "__init__", "Pygame mixer initialized.")
            except Exception as e:
                logger.error("GUI", "__init__", f"Pygame mixer init failed: {e}")
                pygame = None
        
        self._load_icons() # Load icons early
        self.create_widgets()
        
        logger.set_level(self.logger_processing_level_var.get())
        logger.set_gui_log_callback(self.log_to_gui_widget)
        
        self.apply_theme_and_color() # Apply customtkinter theme

        if not self.backend_initialized_successfully:
            self.update_status_bar(connection_status=f"USB Backend Error! Check logs.")
            if hasattr(self, 'file_menu'):
                 self.file_menu.entryconfig("Connect to HiDock", state="disabled") # MODIFIED (tk constant)
            if hasattr(self, 'toolbar_connect_button'):
                self.toolbar_connect_button.configure(state="disabled")


        self.update_all_status_info()
        self._update_optional_panes_visibility()

        self.bind("<F5>", self._on_f5_key_press)
        self.protocol("WM_DELETE_WINDOW", self.on_closing)
        self._set_minimum_window_size() # Set min size after all widgets are created

        if self.autoconnect_var.get():
            self.after(500, self.attempt_autoconnect_on_startup)

    def _load_icons(self):
        icon_size = (20, 20)
        icon_files = {
            "connect": "connect.png", "disconnect": "disconnect.png",
            "refresh": "refresh.png", "download": "download.png",
            "play": "play.png", "stop": "stop.png", "delete": "delete.png",
            "settings": "settings.png", "folder": "folder.png",
            "sync": "sync.png", "format_sd": "format_sd.png",
            "select_all": "select_all.png", "clear_selection": "clear_selection.png",
            "show_logs": "show_logs.png", "show_tools": "show_tools.png",
            "exit": "exit.png"
        }
        for name, filename in icon_files.items():
            try:
                img_path = os.path.join("icons", filename) # Assuming icons are in 'icons' subdirectory
                if os.path.exists(img_path):
                    pil_image = Image.open(img_path)
                    self.icons[name] = ctk.CTkImage(light_image=pil_image, dark_image=pil_image, size=icon_size)
                else:
                    self.icons[name] = None
                    logger.warning("GUI", "_load_icons", f"Icon not found: {img_path}")
            except Exception as e:
                logger.error("GUI", "_load_icons", f"Error loading icon {filename}: {e}")
                self.icons[name] = None
    
    def _create_menubar(self):
        # customtkinter does not have its own menu system for top-level menubars,
        # so we continue to use tkinter's menu for this.
        # It might not perfectly match the customtkinter theme but is functional.
        menubar = tkinter.Menu(self) # MODIFIED: use tkinter.Menu
        self.configure(menu=menubar) # self is the CTk root window

        # File Menu
        self.file_menu = tkinter.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="File", menu=self.file_menu)
        self.file_menu.add_command(label="Connect to HiDock", command=self.connect_device, accelerator="Ctrl+O", image=self.icons.get("connect", None), compound="left")
        self.file_menu.add_command(label="Disconnect", command=self.disconnect_device, state="disabled", accelerator="Ctrl+D", image=self.icons.get("disconnect", None), compound="left")
        self.file_menu.add_separator()
        self.file_menu.add_command(label="Settings", command=self.open_settings_window, accelerator="Ctrl+,", image=self.icons.get("settings", None), compound="left")
        self.file_menu.add_separator()
        self.file_menu.add_command(label="Exit", command=self.on_closing, accelerator="Alt+F4", image=self.icons.get("exit", None), compound="left")
        
        self.bind_all("<Control-o>", lambda e: self.connect_device() if self.file_menu.entrycget("Connect to HiDock", "state") == "normal" else None)
        self.bind_all("<Control-d>", lambda e: self.disconnect_device() if self.file_menu.entrycget("Disconnect", "state") == "normal" else None)
        self.bind_all("<Control-comma>", lambda e: self.open_settings_window())

        # View Menu
        self.view_menu = tkinter.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="View", menu=self.view_menu)
        self.view_menu.add_command(label="Refresh File List", command=self.refresh_file_list_gui, state="disabled", accelerator="F5", image=self.icons.get("refresh", None), compound="left")
        self.view_menu.add_separator()
        self.view_menu.add_checkbutton(label="Show Logs", onvalue=True, offvalue=False, variable=self.logs_visible_var, command=self.toggle_logs, image=self.icons.get("show_logs",None), compound="left") 

        # Actions Menu
        self.actions_menu = tkinter.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Actions", menu=self.actions_menu)
        self.actions_menu.add_command(label="Download Selected", command=self.download_selected_files_gui, state="disabled", image=self.icons.get("download",None), compound="left")
        self.actions_menu.add_command(label="Play Selected", command=self.play_selected_audio_gui, state="disabled", image=self.icons.get("play",None), compound="left")
        self.actions_menu.add_command(label="Delete Selected", command=self.delete_selected_files_gui, state="disabled", image=self.icons.get("delete",None), compound="left")
        self.actions_menu.add_separator()
        self.actions_menu.add_command(label="Select All", command=self.select_all_files_action, state="disabled", accelerator="Ctrl+A", image=self.icons.get("select_all",None), compound="left")
        self.actions_menu.add_command(label="Clear Selection", command=self.clear_selection_action, state="disabled", image=self.icons.get("clear_selection",None), compound="left")

        # Device Menu
        self.device_menu = tkinter.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Device", menu=self.device_menu)
        self.device_menu.add_command(label="Sync Device Time", command=self.sync_device_time_gui, state="disabled", image=self.icons.get("sync",None), compound="left")
        self.device_menu.add_command(label="Format Storage", command=self.format_sd_card_gui, state="disabled", image=self.icons.get("format_sd",None), compound="left")

    def _update_menubar_style(self):
        """Applies styling to the tkinter.Menu to attempt to match CustomTkinter theme."""
        if not (hasattr(self, 'file_menu') and self.file_menu): # Check if menubar is created
            return

        try:
            menu_bg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkFrame"]["fg_color"])
            menu_fg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkLabel"]["text_color"])
            active_menu_bg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkButton"]["hover_color"])
            active_menu_fg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkButton"]["text_color"]) # Or use label text_color
            # Fallback for disabled_fg if the key is not in the theme
            disabled_fg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkLabel"].get("text_color_disabled", ("gray70", "gray40")))

            menus_to_style = [self.file_menu, self.view_menu, self.actions_menu, self.device_menu]
            # Styling the main menubar itself (parent of cascades) can be tricky and platform-specific
            # self.configure(menu=menubar) was done with menubar.configure(bg=menu_bg, fg=menu_fg) might not work as expected for the top bar.

            for menu_widget in menus_to_style:
                if menu_widget:
                    menu_widget.configure(
                        background=menu_bg,
                        foreground=menu_fg,
                        activebackground=active_menu_bg,
                        activeforeground=active_menu_fg,
                        disabledforeground=disabled_fg,
                        relief="flat", # Try to remove 3D effects
                        borderwidth=0 # Try to remove 3D effects
                    )
            logger.info("GUI", "_update_menubar_style", "Attempted to apply theme to menubar.")
        except KeyError as e:
            logger.error("GUI", "_update_menubar_style", f"Theme color key missing for menubar: {e}. Menubar may not be styled correctly.")
        except Exception as e:
            logger.error("GUI", "_update_menubar_style", f"Error applying style to menubar: {e}")

    def _create_toolbar(self):
        spacing_options = {"side": "left", "padx": 2, "pady": 5} # Or padx=4 if 5 is too much

        self.toolbar_frame = ctk.CTkFrame(self, corner_radius=0) # MODIFIED
        self.toolbar_frame.pack(side="top", fill="x", pady=(0,2))

        self.toolbar_connect_button = ctk.CTkButton(self.toolbar_frame, text="Connect", command=self.connect_device, width=100, image=self.icons.get("connect")) # MODIFIED
        self.toolbar_refresh_button = ctk.CTkButton(self.toolbar_frame, text="Refresh", command=self.refresh_file_list_gui, width=100, image=self.icons.get("refresh")) # MODIFIED
        self.toolbar_download_button = ctk.CTkButton(self.toolbar_frame, text="Download", command=self.download_selected_files_gui, width=100, image=self.icons.get("download")) # MODIFIED
        self.toolbar_play_button = ctk.CTkButton(self.toolbar_frame, text="Play", command=self.play_selected_audio_gui, width=100, image=self.icons.get("play")) # MODIFIED
        self.toolbar_delete_button = ctk.CTkButton(self.toolbar_frame, text="Delete", command=self.delete_selected_files_gui, width=100, image=self.icons.get("delete")) # MODIFIED

        # self.toolbar_connect_button.pack(side="left", padx=(5, 2), pady=5)
        # self.toolbar_refresh_button.pack(side="left", padx=2, pady=5)
        # self.toolbar_download_button.pack(side="left", padx=2, pady=5)
        # self.toolbar_play_button.pack(side="left", padx=2, pady=5)
        # self.toolbar_delete_button.pack(side="left", padx=2, pady=5)
                
        self.toolbar_connect_button.pack(**spacing_options)
        self.toolbar_refresh_button.pack(**spacing_options)
        self.toolbar_download_button.pack(**spacing_options)
        self.toolbar_play_button.pack(**spacing_options)
        self.toolbar_delete_button.pack(**spacing_options)

        self.toolbar_settings_button = ctk.CTkButton(self.toolbar_frame, text="Settings", command=self.open_settings_window, width=100, image=self.icons.get("settings")) # MODIFIED
        self.toolbar_settings_button.pack(side="right", padx=5, pady=5)

    def _create_status_bar(self):
        self.status_bar_frame = ctk.CTkFrame(self, height=30, corner_radius=0) # MODIFIED
        self.status_bar_frame.pack(side="bottom", fill="x")

        self.status_connection_label = ctk.CTkLabel(self.status_bar_frame, text="Status: Disconnected", anchor="w")
        self.status_connection_label.pack(side="left", padx=5, pady=2)

        self.status_progress_text_label = ctk.CTkLabel(self.status_bar_frame, text="", anchor="w", width=250)
        self.status_progress_text_label.pack(side="left", padx=10, pady=2, fill="x", expand=True)

        self.status_file_progress_bar = ctk.CTkProgressBar(self.status_bar_frame, width=150, height=15)
        self.status_file_progress_bar.set(0) # Initial value
        self.status_file_progress_bar.pack(side="left", padx=5, pady= ( (10-15//2) if self.status_bar_frame.cget("height") > 15 else 2, (10-15//2) if self.status_bar_frame.cget("height") > 15 else 2) ) # Center progress bar vertically


    def _open_download_dir_in_explorer(self, event=None):
        if not self.download_directory or not os.path.isdir(self.download_directory):
            messagebox.showwarning("Open Directory", 
                                    f"Download directory is not set or does not exist:\n{self.download_directory}",
                                    parent=self) # MODIFIED parent
            logger.warning("GUI", "_open_download_dir_in_explorer",
                            f"Download directory '{self.download_directory}' not valid or not set.")
            return

        try:
            logger.info("GUI", "_open_download_dir_in_explorer", f"Opening download directory: {self.download_directory}")
            if sys.platform == "win32":
                os.startfile(os.path.realpath(self.download_directory))
            elif sys.platform == "darwin":
                subprocess.call(["open", self.download_directory])
            else: 
                subprocess.call(["xdg-open", self.download_directory])
        except FileNotFoundError: 
            messagebox.showerror("Open Directory", 
                                f"Could not open directory. Associated command not found for your system ('{sys.platform}').",
                                parent=self) # MODIFIED parent
            logger.error("GUI", "_open_download_dir_in_explorer", f"File explorer command not found for {sys.platform}.")
        except Exception as e:
            messagebox.showerror("Open Directory",
                                f"Failed to open directory:\n{self.download_directory}\nError: {e}",
                                parent=self) # MODIFIED parent
            logger.error("GUI", "_open_download_dir_in_explorer",
                        f"Failed to open directory '{self.download_directory}': {e}")

    def _select_download_dir_from_header_button(self, event=None):
        """Handles selecting the download directory via right-click on the header button."""
        new_dir = self._prompt_for_directory(initial_dir=self.download_directory, parent_window_for_dialog=self)
        
        if new_dir and new_dir != self.download_directory:
            self.download_directory = new_dir
            self.config["download_directory"] = new_dir
            save_config(self.config)
            
            if hasattr(self, 'download_dir_button_header') and self.download_dir_button_header.winfo_exists():
                self.download_dir_button_header.configure(text=f"Dir: {os.path.basename(self.download_directory)}")
            
            logger.info("GUI", "_select_download_dir_from_header_button", f"Download directory changed to: {new_dir}")
            self.update_all_status_info() # This will update the status bar and other relevant parts

    def _prompt_for_directory(self, initial_dir, parent_window_for_dialog):
        """Prompts the user to select a directory and returns the path."""
        new_dir = filedialog.askdirectory(
            initialdir=initial_dir,
            title="Select Download Directory",
            parent=parent_window_for_dialog
        )
        return new_dir
    
    def update_status_bar(self, connection_status=None, progress_text=None):
        # Check if widget exists before configuring (important for CTk widgets during setup/teardown)
        if hasattr(self, 'status_connection_label') and self.status_connection_label.winfo_exists():
            if connection_status is not None: self.status_connection_label.configure(text=connection_status)
        if hasattr(self, 'status_progress_text_label') and self.status_progress_text_label.winfo_exists():
            if progress_text is not None: self.status_progress_text_label.configure(text=progress_text)


    def update_all_status_info(self):
        conn_status_text = "Status: Disconnected"
        if self.dock.is_connected():
            conn_status_text = f"Status: Connected ({self.dock.model or 'HiDock'})"
            if self.dock.device_info and 'sn' in self.dock.device_info and self.dock.device_info['sn'] != "N/A":
                conn_status_text += f" SN: {self.dock.device_info['sn']}"
        elif not self.backend_initialized_successfully:
            conn_status_text = "Status: USB Backend FAILED!"
        
        storage_text = "Storage: ---"
        if self.dock.is_connected():
            card_info = self.dock.device_info.get("_cached_card_info") 
            if card_info and card_info.get('capacity', 0) > 0 : # Only show if capacity is known and > 0
                used_mb = card_info['used']
                capacity_mb = card_info['capacity']
                unit = "MB"
                if capacity_mb > 1024 * 0.9: # Use GB if capacity is close to or over 1GB
                    used_gb = used_mb / 1024
                    capacity_gb = capacity_mb / 1024
                    storage_text = f"Storage: {used_gb:.2f}/{capacity_gb:.2f} GB"
                else:
                    storage_text = f"Storage: {used_mb:.0f}/{capacity_mb:.0f} MB"
                storage_text += f" (Status: {hex(card_info['status_raw'])})"
            else:
                storage_text = "Storage: Fetching..." 

        total_items = len(self.file_tree.get_children()) if hasattr(self, 'file_tree') and self.file_tree.winfo_exists() else 0
        selected_items_count = len(self.file_tree.selection()) if hasattr(self, 'file_tree') and self.file_tree.winfo_exists() else 0
        size_selected_bytes = 0
        if selected_items_count > 0 and hasattr(self, 'file_tree') and self.file_tree.winfo_exists():
            for item_iid in self.file_tree.selection():
                file_detail = next((f for f in self.displayed_files_details if f['name'] == item_iid), None)
                if file_detail: size_selected_bytes += file_detail.get('length', 0)
        
        file_counts_text = f"Files: {total_items} total / {selected_items_count} sel. ({size_selected_bytes / (1024*1024):.2f} MB)"

        # Update the labels/button in files_header_frame
        if hasattr(self, 'status_storage_label_header') and self.status_storage_label_header.winfo_exists():
            self.status_storage_label_header.configure(text=storage_text)
        if hasattr(self, 'status_file_counts_label_header') and self.status_file_counts_label_header.winfo_exists():
            self.status_file_counts_label_header.configure(text=file_counts_text)
        if hasattr(self, 'download_dir_button_header') and self.download_dir_button_header.winfo_exists():
            self.download_dir_button_header.configure(text=f"Dir: {os.path.basename(self.download_directory)}")

        # Update remaining status bar elements
        self.update_status_bar(
            connection_status=conn_status_text
            # progress_text is handled by its own calls
        )

    def _update_menu_states(self): # Also updates toolbar button states
        is_connected = self.dock.is_connected()
        has_selection = bool(hasattr(self, 'file_tree') and self.file_tree.winfo_exists() and self.file_tree.selection())
        num_selected = len(self.file_tree.selection()) if has_selection else 0

        # Menu states (using tkinter state strings "normal", "disabled")
        if hasattr(self, 'file_menu'):
            self.file_menu.entryconfig("Connect to HiDock", state="normal" if not is_connected and self.backend_initialized_successfully else "disabled")
            self.file_menu.entryconfig("Disconnect", state="normal" if is_connected else "disabled")

        if hasattr(self, 'view_menu'):
            self.view_menu.entryconfig("Refresh File List", state="normal" if is_connected else "disabled")
            # Checkbutton variable handles its state, no need to set state directly unless to disable the whole item
        
        can_play_selected = is_connected and num_selected == 1
        if can_play_selected:
            file_iid = self.file_tree.selection()[0]
            file_detail = next((f for f in self.displayed_files_details if f['name'] == file_iid), None)
            if not (file_detail and (file_detail['name'].lower().endswith(".wav") or file_detail['name'].lower().endswith(".hda"))):
                can_play_selected = False
        
        if hasattr(self, 'actions_menu'):
            self.actions_menu.entryconfig("Download Selected", state="normal" if is_connected and has_selection else "disabled")
            self.actions_menu.entryconfig("Play Selected", state="normal" if can_play_selected else "disabled")
            self.actions_menu.entryconfig("Delete Selected", state="normal" if is_connected and has_selection else "disabled")
            
            can_select_all = (hasattr(self, 'file_tree') and self.file_tree.winfo_exists() and 
                              len(self.file_tree.get_children()) > 0 and 
                              num_selected < len(self.file_tree.get_children()))
            self.actions_menu.entryconfig("Select All", state="normal" if can_select_all else "disabled")
            self.actions_menu.entryconfig("Clear Selection", state="normal" if has_selection else "disabled")

        if hasattr(self, 'device_menu'):
            self.device_menu.entryconfig("Sync Device Time", state="normal" if is_connected else "disabled")
            self.device_menu.entryconfig("Format Storage", state="normal" if is_connected else "disabled")

        # Toolbar button states (using CTk configure(state=...))
        if hasattr(self, 'toolbar_connect_button') and self.toolbar_connect_button.winfo_exists():
            if is_connected:
                self.toolbar_connect_button.configure(text="Disconnect", command=self.disconnect_device, state="normal", image=self.icons.get("disconnect"))
            else:
                self.toolbar_connect_button.configure(text="Connect", command=self.connect_device, 
                                                   state="normal" if self.backend_initialized_successfully else "disabled", image=self.icons.get("connect"))
        
        if hasattr(self, 'toolbar_refresh_button') and self.toolbar_refresh_button.winfo_exists():
            self.toolbar_refresh_button.configure(state="normal" if is_connected and not self._is_ui_refresh_in_progress and not self.is_long_operation_active else "disabled")
        
        if hasattr(self, 'toolbar_download_button') and self.toolbar_download_button.winfo_exists():
            if self.is_long_operation_active and self.active_operation_name == "Download Queue":
                self.toolbar_download_button.configure(text="Cancel DL", command=self.request_cancel_operation, state="normal", image=self.icons.get("stop")) # Generic stop/cancel icon
            else:
                self.toolbar_download_button.configure(text="Download", command=self.download_selected_files_gui,
                    state="normal" if is_connected and has_selection and not self.is_long_operation_active and not self.is_audio_playing else "disabled", image=self.icons.get("download"))

        if hasattr(self, 'toolbar_play_button') and self.toolbar_play_button.winfo_exists():
            if self.is_audio_playing:
                self.toolbar_play_button.configure(text="Stop", command=self._stop_audio_playback, state="normal", image=self.icons.get("stop"))
            elif self.is_long_operation_active and self.active_operation_name == "Playback Preparation":
                self.toolbar_play_button.configure(text="Cancel Prep", command=self.request_cancel_operation, state="normal", image=self.icons.get("stop"))
            else:
                self.toolbar_play_button.configure(text="Play", command=self.play_selected_audio_gui,
                    state="normal" if can_play_selected and not self.is_long_operation_active else "disabled", image=self.icons.get("play"))

        if hasattr(self, 'toolbar_delete_button') and self.toolbar_delete_button.winfo_exists():
            if self.is_long_operation_active and self.active_operation_name == "Deletion":
                self.toolbar_delete_button.configure(text="Cancel Del.", command=self.request_cancel_operation, state="normal", image=self.icons.get("stop"))
            else:
                self.toolbar_delete_button.configure(text="Delete", command=self.delete_selected_files_gui,
                    state="normal" if is_connected and has_selection and not self.is_long_operation_active and not self.is_audio_playing else "disabled", image=self.icons.get("delete"))
        
        if hasattr(self, 'toolbar_settings_button') and self.toolbar_settings_button.winfo_exists():
            self.toolbar_settings_button.configure(state="normal")

    def _update_treeview_style(self):
        """Applies styling to the ttk.Treeview to match the CustomTkinter theme."""
        if not (hasattr(self, 'file_tree') and self.file_tree.winfo_exists()):
            logger.debug("GUI", "_update_treeview_style", "file_tree not found or not existent, skipping style update.")
            return

        from tkinter import ttk
        style = ttk.Style()
        
        # Ensure ThemeManager has loaded data
        if not ctk.ThemeManager.theme:
            logger.warning("GUI", "_update_treeview_style", "CTk ThemeManager.theme is not populated. Cannot style Treeview.")
            return

        # Font setup based on CTkFont defaults
        default_ctk_font = ctk.CTkFont() # Gets a font object with current theme's defaults
        font_family = default_ctk_font.cget("family")
        base_size = default_ctk_font.cget("size")

        # Adjust font sizes as needed. These are examples.
        tree_font_size = base_size -1  # e.g., if base_size is 13, this is 12. TkDefaultFont was smaller.
        if tree_font_size < 10: tree_font_size = 10 # Minimum size
        tree_font = (font_family, tree_font_size)
        
        heading_font_size = base_size # e.g., 13
        heading_font = (font_family, heading_font_size, "bold")
        
        tag_font_size = base_size - 2 # e.g., 11
        if tag_font_size < 9: tag_font_size = 9 # Minimum size
        tag_font_bold = (font_family, tag_font_size, "bold")

        # Get current appearance mode
        current_mode = ctk.get_appearance_mode()

        try:
            # Colors for Treeview body
            tree_body_bg_color = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkFrame"]["fg_color"])
            tree_body_text_color = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkLabel"]["text_color"])
            tree_selected_bg_color = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkButton"]["fg_color"])
            tree_selected_text_color = tree_body_text_color # Selected text often same as body text

            # Colors for Treeview.Heading (DEFAULT state)
            # Align with a subtle button color (less emphasis than main button fill)
            default_heading_bg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkFrame"]["top_fg_color"])
            default_heading_fg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkButton"]["text_color"]) # Default text color for headings

            # Colors for Treeview.Heading (ACTIVE/HOVER state)
            active_heading_bg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkButton"]["hover_color"])
            #     # Active heading text color should contrast with active_heading_bg. Often same as default_heading_fg.
            active_heading_fg = default_heading_fg

        except KeyError as e:
            logger.error("GUI", "_update_treeview_style", f"Theme color key missing: {e}. Using fallbacks.")
            tree_body_bg_color = "#ebebeb" if current_mode == "Light" else "#2b2b2b"
            tree_body_text_color = "black" if current_mode == "Light" else "white"
            tree_selected_bg_color = "#325882" 
            tree_selected_text_color = tree_body_text_color

            default_heading_bg = "#dbdbdb" if current_mode == "Light" else "#3b3b3b"
            default_heading_fg = "black" if current_mode == "Light" else "white"
            active_heading_bg = "#c8c8c8" if current_mode == "Light" else "#4f4f4f" # Slightly different for active
            active_heading_fg = default_heading_fg

        # Explicitly use a theme that allows more customization, like "clam"
        # This is crucial for Treeview.Heading styling to take effect on some platforms.
        style.theme_use('clam') 
        logger.debug("GUI", "_update_treeview_style", "Set ttk theme to 'clam'.")

        # --- custom ttk.Scrollbar styling ---
        try:
            trough_color = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkScrollbar"]["fg_color"]) 
            thumb_color = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkScrollbar"]["button_color"])
            arrow_color = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkScrollbar"]["button_hover_color"]) 

            style.configure("Treeview.Scrollbar", troughcolor=trough_color, background=thumb_color, arrowcolor=arrow_color)
            style.map("Treeview.Scrollbar",
                    background=[('active', self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkScrollbar"]["button_hover_color"]))],
                    arrowcolor=[('active', self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkLabel"]["text_color"]))]) 
            logger.debug("GUI", "_update_treeview_style", "Attempted to style ttk.Scrollbar.")
        except KeyError as e:
            logger.warning("GUI", "_update_treeview_style", f"Theme key missing for ttk.Scrollbar styling: {e}")
        except Exception as e:
            logger.error("GUI", "_update_treeview_style", f"Error styling ttk.Scrollbar: {e}")

        # Configure Treeview body
        style.configure("Treeview", background=tree_body_bg_color, foreground=tree_body_text_color, fieldbackground=tree_body_bg_color, font=tree_font)
        style.map("Treeview", 
                  background=[('selected', tree_selected_bg_color)], 
                  foreground=[('selected', tree_body_text_color)]) # REVERTED: Explicitly set selected foreground

        # Configure Treeview.Heading (default and states)
        style.configure("Treeview.Heading", 
                        background=default_heading_bg, 
                        foreground=default_heading_fg, 
                        relief="flat", font=heading_font)
        style.map("Treeview.Heading",
                  background=[('active', active_heading_bg), ('pressed', tree_selected_bg_color)],
                  foreground=[('active', active_heading_fg), ('pressed', tree_selected_text_color)],
                  relief=[('active', 'groove'), ('pressed', 'sunken')])

    def apply_theme_and_color(self):
        mode = self.appearance_mode_var.get()
        theme_name = self.color_theme_var.get()
        
        logger.info("GUI", "apply_theme_and_color", f"Setting appearance: {mode}, color theme: {theme_name}")
        ctk.set_appearance_mode(mode)
        
        try:
            ctk.set_default_color_theme(theme_name)
        except Exception as e:
            logger.error("GUI", "apply_theme_and_color", f"Failed to set color theme '{theme_name}': {e}. Using 'blue'.")
            ctk.set_default_color_theme("blue") # Fallback
            self.color_theme_var.set("blue") # Update config var if fallback occurs
            self.config["color_theme"] = "blue"

        # Defer Treeview style update to allow CTk to process its theme changes first.
        self.after(50, self._update_treeview_style)
        self.after(55, self._update_menubar_style) # Also update menubar style
        self.after(60, self._update_default_progressbar_colors)

    def _apply_appearance_mode_theme_color(self, color_tuple_or_str):
        """ Gets the correct color from a (light, dark) tuple based on current appearance mode. """
        if isinstance(color_tuple_or_str, (list, tuple)):
            current_mode = ctk.get_appearance_mode()
            if current_mode == "Dark":
                return color_tuple_or_str[1]
            else: # Light or System (assuming system defaults to light if not dark)
                return color_tuple_or_str[0]
        return color_tuple_or_str # It's already a single color string

    def create_widgets(self):
        self._create_menubar() 
        self._create_toolbar()
        self._create_status_bar() 

        main_content_frame = ctk.CTkFrame(self, fg_color="transparent") # MODIFIED
        main_content_frame.pack(fill="both", expand=True, padx=5, pady=5)

        # Configure main_content_frame grid
        self.main_content_frame = main_content_frame # Store reference
        self.main_content_frame.grid_rowconfigure(0, weight=1) # files_frame, initially takes all space
        self.main_content_frame.grid_rowconfigure(1, weight=0) # log_frame, initially no space
        self.main_content_frame.grid_columnconfigure(0, weight=1)

        files_frame = ctk.CTkFrame(self.main_content_frame) # Child of self.main_content_frame
        files_frame.grid(row=0, column=0, sticky="nsew", padx=0, pady=(0,5))
        files_frame.grid_columnconfigure(0, weight=1) # For files_header_frame and tree_frame
        files_frame.grid_rowconfigure(0, weight=0)    # files_header_frame (fixed height)
        files_frame.grid_rowconfigure(1, weight=1)    # tree_frame (expandable)

        # --- Files Header Frame (contains label, storage, counts, dir button) ---
        files_header_frame = ctk.CTkFrame(files_frame, fg_color="transparent")
        files_header_frame.grid(row=0, column=0, sticky="ew", padx=5, pady=(5,2))

        # Uncomment if you want a label in the header
        # This label is not needed as we have the download directory button
        # self.files_label = ctk.CTkLabel(files_header_frame, text="📄 Available Files")
        # self.files_label.pack(side="left", padx=(0, 15), pady=2)

        # --- Status Labels in Header ---
        self.status_storage_label_header = ctk.CTkLabel(files_header_frame, text="Storage: ---", anchor="w")
        self.status_storage_label_header.pack(side="left", padx=10, pady=2)

        # File counts label in header
        # This label shows total files and selected files in the header
        self.status_file_counts_label_header = ctk.CTkLabel(files_header_frame, text="Files: 0 / 0", anchor="w")
        self.status_file_counts_label_header.pack(side="left", padx=10, pady=2)

        # --- Pack order for right-aligned items in header: Dir button is furthest right ---
        self.download_dir_button_header = ctk.CTkButton(files_header_frame,
                                                 text=f"Dir: {os.path.basename(self.download_directory)}",
                                                 image=self.icons.get("folder"), compound="left",
                                                 anchor="center", width=130, height=24, # Adjusted size
                                                 command=self._open_download_dir_in_explorer)
        self.download_dir_button_header.bind("<Button-3>", self._select_download_dir_from_header_button) 
        self.download_dir_button_header.pack(side="right", padx=(10,0), pady=2)

        # Clear Selection Button (to the left of Dir button)
        self.clear_selection_button_header = ctk.CTkButton(files_header_frame,
                                                           text="-",
                                                           width=30,
                                                           height=24,
                                                           command=self.clear_selection_action)
        self.clear_selection_button_header.pack(side="right", padx=(2, 5), pady=2)

        # Select All Button (to the left of Clear Selection button)
        self.select_all_button_header = ctk.CTkButton(files_header_frame,
                                                      text="*",
                                                      width=30,
                                                      height=24,
                                                      command=self.select_all_files_action)
        self.select_all_button_header.pack(side="right", padx=(2, 2), pady=2)
        
        # --- Treeview (using ttk.Treeview) ---
        from tkinter import ttk # Keep ttk for Treeview
        # The ttk.Treeview widget is placed inside a ctk.CTkFrame
        tree_frame = ctk.CTkFrame(files_frame, fg_color="transparent", border_width=0) # Use transparent background for consistency
        tree_frame.grid(row=1, column=0, sticky="nsew", padx=5, pady=5) # Use grid for layout
        tree_frame.grid_columnconfigure(0, weight=1) # Treeview takes all horizontal space
        tree_frame.grid_rowconfigure(0, weight=1) # Treeview takes all vertical space
        # tree_frame.grid_columnconfigure(1, weight=0) # Ensure minspace for scrollbar

        columns = ("name", "size", "duration", "date", "time", "status")
        self.file_tree = ttk.Treeview(tree_frame, columns=columns, show="headings", selectmode="extended")

        self.file_tree.tag_configure("downloaded", foreground="blue")
        self.file_tree.tag_configure("recording", foreground="red", font=("Arial", 10, "bold"))
        self.file_tree.tag_configure("size_mismatch", foreground="orange")
        self.file_tree.tag_configure("downloaded_ok", foreground="green")
        self.file_tree.tag_configure("downloading", foreground="dark orange")
        self.file_tree.tag_configure("queued", foreground="gray50")
        self.file_tree.tag_configure("cancelled", foreground="firebrick3")
        self.file_tree.tag_configure("playing", foreground="purple")
        logger.info("GUI", "create_widgets", "Treeview style updated.")

        # Store original headings for later use
        if self.treeview_columns_display_order_str:
            loaded_column_order = self.treeview_columns_display_order_str.split(',')
            valid_loaded_order = [c for c in loaded_column_order if c in columns]
            if len(valid_loaded_order) == len(columns) and set(valid_loaded_order) == set(columns):
                try:
                    self.file_tree["displaycolumns"] = valid_loaded_order
                except Exception as e: # MODIFIED: More generic Tkinter TclError
                    logger.warning("GUI", "create_widgets", f"Failed to apply saved column order '{valid_loaded_order}': {e}. Using default.")
                    self.file_tree["displaycolumns"] = columns
            else:
                self.file_tree["displaycolumns"] = columns
        else:
            self.file_tree["displaycolumns"] = columns
        
        for col, text in self.original_tree_headings.items():
            is_numeric = col in ["size", "duration"]
            self.file_tree.heading(col, text=text, command=lambda c=col, n=is_numeric: self.sort_treeview_column(c, n))
            if col == "name": self.file_tree.column(col, width=250, minwidth=150, stretch=True)
            elif col in ["size", "duration"]: self.file_tree.column(col, width=80, minwidth=60, anchor="e")
            elif col in ["date", "time"]: self.file_tree.column(col, width=100, minwidth=80, anchor="center")
            else: self.file_tree.column(col, width=100, minwidth=80, anchor="w")

        self.file_tree.grid(row=0, column=0, sticky="nsew") # Fill available space in tree_frame
        
        # CTkScrollbar might not work directly with ttk.Treeview. Use ttk.Scrollbar.
        scrollbar = ttk.Scrollbar(tree_frame, orient="vertical", command=self.file_tree.yview)
        scrollbar.grid(row=0, column=1, sticky="ns")
        
        self.file_tree.configure(yscrollcommand=scrollbar.set)
        
        # Tag configurations are applied after theme in apply_theme_and_color
        self.file_tree.bind("<<TreeviewSelect>>", self.on_file_selection_change)
        self.file_tree.bind("<Double-1>", self._on_file_double_click)
        self.file_tree.bind("<Button-3>", self._on_file_right_click) # Button-3 for Tkinter/TTK context menu
        self.file_tree.bind("<Control-a>", lambda event: self.select_all_files_action())
        self.file_tree.bind("<Control-A>", lambda event: self.select_all_files_action()) # For uppercase A
        self.file_tree.bind("<Delete>", self._on_delete_key_press)
        self.file_tree.bind("<Return>", self._on_enter_key_press)
        self.file_tree.bind("<ButtonPress-1>", self._on_file_button1_press)
        self.file_tree.bind("<B1-Motion>", self._on_file_b1_motion)
        self.file_tree.bind("<ButtonRelease-1>", self._on_file_button1_release)

        # --- Optional Panes (Logs, Device Tools) ---
        # log_frame is now a direct child of main_content_frame
        self.log_frame = ctk.CTkFrame(self.main_content_frame)
        
        log_controls_sub_frame = ctk.CTkFrame(self.log_frame, fg_color="transparent")
        log_controls_sub_frame.pack(fill="x", pady=(5, 5), padx=5)
        
        self.clear_log_button = ctk.CTkButton(log_controls_sub_frame, text="Clear Log", command=self.clear_log_gui, width=100)
        self.clear_log_button.pack(side="left", padx=(0, 10))
        
        ctk.CTkLabel(log_controls_sub_frame, text="Log Level:").pack(side="left", padx=(0, 5))
        self.log_section_level_combo = ctk.CTkComboBox(log_controls_sub_frame, variable=self.gui_log_filter_level_var, 
                                                       values=list(Logger.LEVELS.keys()), state="readonly", width=120,
                                                       command=self.on_gui_log_filter_change) # command for combobox
        self.log_section_level_combo.pack(side="left")
        
        self.download_logs_button = ctk.CTkButton(log_controls_sub_frame, text="Download Logs", command=self.download_gui_logs, width=130)
        self.download_logs_button.pack(side="left", padx=(10,0))
        
        self.log_text_area = ctk.CTkTextbox(self.log_frame, height=100, state='disabled', wrap="word") # MODIFIED
        self.log_text_area.pack(fill="both", expand=True, padx=5, pady=(0,5))
        
        self._update_log_text_area_tag_colors() # Apply initial log colors

    def _on_file_button1_press(self, event):
        item_iid = self.file_tree.identify_row(event.y)
        self._is_button1_pressed_on_item = item_iid # Anchor for potential drag
        self._last_dragged_over_iid = item_iid     # Initialize for drag logic
        self._drag_action_is_deselect = False      # Default to select-drag

        if not item_iid: # Clicked on empty space
            self._is_button1_pressed_on_item = None # No valid anchor
            logger.debug("GUI", "_on_file_button1_press", "Button 1 pressed on empty space.")
            return # Let default Treeview behavior handle (deselect all)

        current_selection = self.file_tree.selection()
        is_currently_selected_before_toggle = item_iid in current_selection

        # Determine drag action based on item's state *before* this click's toggle action
        if is_currently_selected_before_toggle:
            self._drag_action_is_deselect = True
            logger.debug("GUI", "_on_file_button1_press", f"Drag will DESELECT. Anchor '{item_iid}' was selected.")
        else:
            # _drag_action_is_deselect remains False (default)
            logger.debug("GUI", "_on_file_button1_press", f"Drag will SELECT. Anchor '{item_iid}' was not selected.")

        # Check for modifier keys
        ctrl_pressed = (event.state & 0x0004) != 0
        shift_pressed = (event.state & 0x0001) != 0

        if shift_pressed:
            logger.debug("GUI", "_on_file_button1_press", f"Shift+Click on item: {item_iid}. Allowing default range selection.")
            # For Shift+Click, allow default Treeview processing for range selection.
            # Our _is_button1_pressed_on_item serves as anchor if a drag follows immediately.
            return # Do NOT return "break"

        # For simple click (no modifiers) or Ctrl+Click, toggle the specific item.
        if is_currently_selected_before_toggle:
            self.file_tree.selection_remove(item_iid)
            logger.debug("GUI", "_on_file_button1_press", f"Toggled OFF item: {item_iid} (Modifier: {'Ctrl' if ctrl_pressed else 'None'})")
        else:
            self.file_tree.selection_add(item_iid)
            logger.debug("GUI", "_on_file_button1_press", f"Toggled ON item: {item_iid} (Modifier: {'Ctrl' if ctrl_pressed else 'None'})")
        
        return "break" # Prevent default Treeview behavior that would deselect others on simple click.
    
    def _on_file_b1_motion(self, event):
        if not hasattr(self, '_is_button1_pressed_on_item') or not self._is_button1_pressed_on_item:
            return # No drag anchor established by _on_file_button1_press

        item_iid_under_cursor = self.file_tree.identify_row(event.y)
        
        # Process only if actually moved to a new distinct item to avoid excessive processing
        if item_iid_under_cursor != self._last_dragged_over_iid: # Can be None if dragged to empty space
            self._last_dragged_over_iid = item_iid_under_cursor
            
            if self._is_button1_pressed_on_item: # If drag started on a valid item
                all_children = self.file_tree.get_children('')
                try:
                    anchor_index = all_children.index(self._is_button1_pressed_on_item)
                    
                    # If dragging off items, we might want to select up to the edge.
                    # For now, if not over a valid item, use the anchor itself as the current end.
                    # This means dragging into empty space doesn't change selection beyond the last item.
                    current_motion_index = -1
                    if item_iid_under_cursor and item_iid_under_cursor in all_children:
                        current_motion_index = all_children.index(item_iid_under_cursor)
                    else: # Dragged to empty space or invalid item

                        if not item_iid_under_cursor: # Strict: if not over an item, no range change by motion.
                            return
                        # Fallthrough if item_iid_under_cursor was initially valid but not in all_children (should not happen)

                    start_range_idx = min(anchor_index, current_motion_index)
                    end_range_idx = max(anchor_index, current_motion_index)
                    
                    items_in_current_drag_sweep = all_children[start_range_idx : end_range_idx + 1]
                    
                    if self._drag_action_is_deselect:
                        logger.debug("GUI", "_on_file_b1_motion", f"Drag-DESELECTING items in sweep: {items_in_current_drag_sweep}")
                        for item_to_process in items_in_current_drag_sweep:
                            self.file_tree.selection_remove(item_to_process)
                    else: # Default drag action is to select (add to selection)
                        logger.debug("GUI", "_on_file_b1_motion", f"Drag-SELECTING items in sweep: {items_in_current_drag_sweep}")
                        for item_to_process in items_in_current_drag_sweep:
                            self.file_tree.selection_add(item_to_process)
                except ValueError:
                    logger.warning("GUI", "_on_file_b1_motion", "Anchor or current item not found in tree children during drag.")
                    pass # Item not found in children list
    
    def _on_file_button1_release(self, event):
        logger.debug("GUI", "_on_file_button1_release", f"Button 1 released. Final selection: {self.file_tree.selection()}")
        self._is_button1_pressed_on_item = None
        self._last_dragged_over_iid = None
        self._drag_action_is_deselect = False # Reset drag action mode
        
        # The _update_menu_states() and the backend check should be at the end of create_widgets(),
        # but calling _update_menu_states() after a selection change via drag might be useful here.
        self._update_menu_states()
        
    def _update_optional_panes_visibility(self):
        if not hasattr(self, 'main_content_frame'):
            logger.error("GUI", "_update_optional_panes_visibility", "main_content_frame not found.")
            return
        if not hasattr(self, 'log_frame'):
            logger.error("GUI", "_update_optional_panes_visibility", "log_frame not found.")
            return

        logs_are_visible = self.logs_visible_var.get()

        if logs_are_visible:
            if not self.log_frame.winfo_ismapped():
                self.log_frame.grid(row=1, column=0, sticky="nsew", padx=5, pady=(5,0))
            # Adjust weights for main_content_frame rows
            self.main_content_frame.grid_rowconfigure(0, weight=3)  # files_frame gets 3 parts
            self.main_content_frame.grid_rowconfigure(1, weight=1)  # log_frame gets 1 part
        else:
            if self.log_frame.winfo_ismapped():
                self.log_frame.grid_forget()
            # Adjust weights for main_content_frame rows
            self.main_content_frame.grid_rowconfigure(0, weight=1)  # files_frame takes all available space
            self.main_content_frame.grid_rowconfigure(1, weight=0)  # log_frame takes no space

    def toggle_logs(self):
        self.logs_visible = self.logs_visible_var.get()
        self._update_optional_panes_visibility()

    def _update_log_text_area_tag_colors(self):
        if not (hasattr(self, 'log_text_area') and self.log_text_area.winfo_exists()):
            return
        
        log_levels_to_configure = ["ERROR", "WARNING", "INFO", "DEBUG", "CRITICAL"]

        for level_name_upper in log_levels_to_configure:
            level_name_lower = level_name_upper.lower()
            light_var = getattr(self, f"log_color_{level_name_lower}_light_var", None)
            dark_var = getattr(self, f"log_color_{level_name_lower}_dark_var", None)

            if light_var and dark_var:
                color_tuple = (light_var.get(), dark_var.get())
                try:
                    self.log_text_area.tag_config(level_name_upper, foreground=self._apply_appearance_mode_theme_color(color_tuple))
                except Exception as e:
                    logger.error("GUI", "_update_log_text_area_tag_colors", f"Error applying color for {level_name_upper} with {color_tuple}: {e}")
            else:
                logger.warning("GUI", "_update_log_text_area_tag_colors", f"Color StringVars for log level {level_name_upper} not found.")
        logger.info("GUI", "_update_log_text_area_tag_colors", "Log text area tag colors updated.")

    def open_settings_window(self):
        settings_win = ctk.CTkToplevel(self) # MODIFIED
        settings_win.title("Application Settings")
        settings_win.transient(self)
        settings_win.attributes("-alpha", 0) # Start fully transparent
        settings_win.grab_set()

        # Flag to prevent button state updates during initial population
        self._settings_dialog_initializing = True

        main_content_frame = ctk.CTkFrame(settings_win, fg_color="transparent") # MODIFIED
        main_content_frame.pack(fill="both", expand=True, padx=10, pady=10)

        initial_config_vars = {
            "autoconnect": self.autoconnect_var.get(),
            "log_level": self.logger_processing_level_var.get(),
            "selected_vid": self.selected_vid_var.get(),
            "selected_pid": self.selected_pid_var.get(),
            "target_interface": self.target_interface_var.get(),
            "recording_check_interval_s": self.recording_check_interval_var.get(),
            "default_command_timeout_ms": self.default_command_timeout_ms_var.get(),
            "file_stream_timeout_s": self.file_stream_timeout_s_var.get(),
            "auto_refresh_files": self.auto_refresh_files_var.get(),
            "auto_refresh_interval_s": self.auto_refresh_interval_s_var.get(),
            "quit_without_prompt_if_connected": self.quit_without_prompt_var.get(),
            "appearance_mode": self.appearance_mode_var.get(), # MODIFIED
            "color_theme": self.color_theme_var.get(),       # MODIFIED
            "suppress_console_output": self.suppress_console_output_var.get(),
            "suppress_gui_log_output": self.suppress_gui_log_output_var.get() # ADDED
        }
        # Add initial log color vars
        for level_key in Logger.LEVELS.keys():
            level_lower = level_key.lower()
            initial_config_vars[f"log_color_{level_lower}_light"] = getattr(self, f"log_color_{level_lower}_light_var").get()
            initial_config_vars[f"log_color_{level_lower}_dark"] = getattr(self, f"log_color_{level_lower}_dark_var").get()
        
        conceptual_device_setting_keys = {
            "autoRecord": "auto_record", 
            "autoPlay": "auto_play",
            "bluetoothTone": "bluetooth_tone",
            "notificationSound": "notification_sound"
        }
        for conceptual_key, snake_case_part in conceptual_device_setting_keys.items():
            tk_var_attribute_name = f"device_setting_{snake_case_part}_var"
            if hasattr(self, tk_var_attribute_name):
                initial_config_vars[tk_var_attribute_name] = getattr(self, tk_var_attribute_name).get()
            else: 
                logger.error("Settings", "open_settings_window", f"Attribute {tk_var_attribute_name} for {conceptual_key} not found.")
        
        _initial_download_directory_container = [self.download_directory] # MODIFIED: Use a list container
        settings_changed_tracker = [False] 
        current_dialog_download_dir = [self.download_directory] 

        # --- Define buttons and callback function EARLIER ---
        # These frames and buttons are defined here. Their packing into the layout happens later.
        buttons_frame = ctk.CTkFrame(main_content_frame, fg_color="transparent") 
        action_buttons_subframe = ctk.CTkFrame(buttons_frame, fg_color="transparent")
        
        # Define colors for buttons
        COLOR_OK_BLUE = "#3B8ED0"       # A standard CTk blue
        COLOR_CANCEL_RED = "#D32F2F"    # A material design red
        COLOR_APPLY_GREY = "#757575"    # A medium dark grey
        COLOR_CLOSE_GREY = "#757575"    # Same dark grey for Close

        ok_button = ctk.CTkButton(action_buttons_subframe, text="OK", state="disabled", fg_color=COLOR_OK_BLUE) # Created disabled
        apply_button = ctk.CTkButton(action_buttons_subframe, text="Apply", fg_color=COLOR_APPLY_GREY, state="disabled") # Created disabled
        cancel_close_button = ctk.CTkButton(action_buttons_subframe, text="Close", fg_color=COLOR_CLOSE_GREY)

        # Initial packing: Only Close button. OK and Apply are created but not packed.
        cancel_close_button.pack(side="left", padx=(0,0)) # Will be the only button initially

        # Helper to finalize initialization and set button states
        def _finalize_initialization_and_button_states():
            # This outer function is what's called by the hook or directly.
            # It schedules the core finalization logic to run after a brief delay,
            # allowing any pending var.set() traces (which are also often after(0)) to fire
            # while _settings_dialog_initializing is still True.

            def _core_final_setup():
                if not settings_win.winfo_exists():
                    logger.warning("SettingsDialog", "_core_final_setup", "Settings window closed before core final setup.")
                    return

                # Now, set initializing to False, as all programmatic changes should be done.
                self._settings_dialog_initializing = False
                settings_changed_tracker[0] = False # Reset tracker: UI is now "clean"
                logger.debug("SettingsDialog", "_core_final_setup", "Core final setup: Dialog initialization complete. Change tracking active.")

                # Ensure initial button state is correctly "Close" only
                # And that OK/Apply are properly configured (disabled) even if not visible
                if ok_button.winfo_exists():
                    if ok_button.winfo_ismapped(): ok_button.pack_forget()
                    ok_button.configure(state="disabled") 
                if apply_button.winfo_exists():
                    if apply_button.winfo_ismapped(): apply_button.pack_forget()
                    apply_button.configure(state="disabled")
                
                if cancel_close_button.winfo_exists():
                    cancel_close_button.configure(text="Close", fg_color=COLOR_CLOSE_GREY, state="normal")
                    if not cancel_close_button.winfo_ismapped():
                        # If cancel_close_button was somehow forgotten, re-pack it.
                        # This also ensures it's the only one if ok/apply were just forgotten.
                        cancel_close_button.pack(side="left", padx=(0,0))
                
                settings_win.update_idletasks() 
                settings_win.attributes("-alpha", 1.0) 
                settings_win.after(100, lambda: settings_win.focus_set() if settings_win.winfo_exists() else None)

            if settings_win.winfo_exists():
                # Use a small delay (e.g., 50ms). after(0) might still have race conditions
                # with other after(0) tasks like var.set(). A slightly longer delay gives
                # a higher chance for those to complete while _settings_dialog_initializing is True.
                settings_win.after(50, _core_final_setup) 
            else:
                logger.warning("SettingsDialog", "_finalize_init_outer", "Settings window closed before scheduling core final setup.")

        def _update_button_states_on_change(*args): 
            if not settings_win.winfo_exists(): return

            if self._settings_dialog_initializing:
                logger.debug("SettingsDialog", "_update_button_states_on_change", "Dialog initializing, skipping button update.")
                return

            if not settings_changed_tracker[0]:
                settings_changed_tracker[0] = True
                logger.debug("SettingsDialog", "_update_button_states_on_change", "First change post-init, transitioning buttons to OK/Apply/Cancel.")

                if ok_button.winfo_exists() and ok_button.winfo_ismapped(): ok_button.pack_forget()
                if apply_button.winfo_exists() and apply_button.winfo_ismapped(): apply_button.pack_forget()
                if cancel_close_button.winfo_exists() and cancel_close_button.winfo_ismapped(): cancel_close_button.pack_forget()

                ok_button.pack(side="left", padx=(0,5))
                apply_button.pack(side="left", padx=5)
                cancel_close_button.pack(side="left", padx=(5,0))

                ok_button.configure(state="normal")
                apply_button.configure(state="normal" if self.dock.is_connected() else "disabled")
                cancel_close_button.configure(text="Cancel", fg_color=COLOR_CANCEL_RED)

            elif apply_button.winfo_exists() and apply_button.winfo_ismapped(): # If already changed, update Apply state
                apply_button.configure(state="normal" if self.dock.is_connected() else "disabled")
        # --- End of early definitions ---

        # --- Define helper functions for settings dialog ---
        def _check_if_settings_actually_changed_settings():
            for key, initial_val in initial_config_vars.items():
                current_var = None
                if hasattr(self, key) and isinstance(getattr(self, key), ctk.Variable): # ctk.BooleanVar etc.
                    current_var = getattr(self, key)
                elif hasattr(self, f"{key}_var") and isinstance(getattr(self, f"{key}_var"), ctk.Variable):
                    current_var = getattr(self, f"{key}_var")
                
                if current_var and current_var.get() != initial_val: return True

            # MODIFIED: Compare with container's content
            if current_dialog_download_dir[0] != _initial_download_directory_container[0]: return True
            return False

        tabview = ctk.CTkTabview(main_content_frame) # MODIFIED
        tabview.pack(expand=True, fill="both", pady=(0, 10))

        tab_general = tabview.add(" General ")
        tab_connection = tabview.add(" Connection ")
        tab_operation = tabview.add(" Operation ")
        tab_device_specific = tabview.add(" Device Specific ")
        tab_logging = tabview.add(" Logging ") # MODIFIED: Renamed tab
        
        # --- Populate Tab 1: General ---
        gen_scroll_frame = ctk.CTkScrollableFrame(tab_general, fg_color="transparent")
        gen_scroll_frame.pack(fill="both", expand=True)

        appearance_settings_frame = ctk.CTkFrame(gen_scroll_frame) # MODIFIED
        appearance_settings_frame.pack(fill="x", pady=5, anchor="n")
        ctk.CTkLabel(appearance_settings_frame, text="Application Theme:", font=ctk.CTkFont(weight="bold")).pack(anchor="w", pady=(5,2), padx=5)
        ctk.CTkLabel(appearance_settings_frame, text="Appearance Mode:").pack(anchor="w", pady=(5,0), padx=10)
        appearance_mode_combo = ctk.CTkComboBox(appearance_settings_frame, variable=self.appearance_mode_var, 
                                                values=["Light", "Dark", "System"], state="readonly") # MODIFIED
        appearance_mode_combo.pack(fill="x", pady=2, padx=10)
        ctk.CTkLabel(appearance_settings_frame, text="Color Theme:").pack(anchor="w", pady=(5,0), padx=10)
        color_theme_combo = ctk.CTkComboBox(appearance_settings_frame, variable=self.color_theme_var, 
                                             values=["blue", "dark-blue", "green"], state="readonly") # MODIFIED (add custom theme paths here if any)
        color_theme_combo.pack(fill="x", pady=(2,10), padx=10)

        
        quit_prompt_frame = ctk.CTkFrame(gen_scroll_frame) # MODIFIED
        quit_prompt_frame.pack(fill="x", pady=5, anchor="n")
        ctk.CTkLabel(quit_prompt_frame, text="Application Exit:", font=ctk.CTkFont(weight="bold")).pack(anchor="w", pady=(5,2), padx=5)
        quit_checkbutton = ctk.CTkCheckBox(quit_prompt_frame, text="Quit without confirmation if device is connected", 
                                           variable=self.quit_without_prompt_var) # MODIFIED
        quit_checkbutton.pack(anchor="w", pady=(5,10), padx=10)

        download_settings_frame = ctk.CTkFrame(gen_scroll_frame) # MODIFIED
        download_settings_frame.pack(fill="x", pady=5, anchor="n")
        ctk.CTkLabel(download_settings_frame, text="Download Settings:", font=ctk.CTkFont(weight="bold")).pack(anchor="w", pady=(5,2), padx=5)
        
        current_dl_dir_label_settings = ctk.CTkLabel(download_settings_frame, text=self.download_directory, 
                                                     wraplength=380, anchor="w", justify="left") # MODIFIED
        current_dl_dir_label_settings.pack(fill="x", pady=2, padx=10)
        
        dir_buttons_frame = ctk.CTkFrame(download_settings_frame, fg_color="transparent") # MODIFIED
        dir_buttons_frame.pack(fill="x", pady=(0,5), padx=10)
        select_dir_button_settings = ctk.CTkButton(dir_buttons_frame, text="Select Download Directory...", 
                                                   command=lambda: self._select_download_dir_for_settings_dialog(current_dl_dir_label_settings, current_dialog_download_dir, settings_changed_tracker, apply_button, cancel_close_button)) # MODIFIED
        select_dir_button_settings.pack(side="left", pady=(5,0))
        reset_dir_button = ctk.CTkButton(dir_buttons_frame, text="Reset to App Folder", 
                                         command=lambda: self._reset_download_dir_for_settings(current_dl_dir_label_settings, current_dialog_download_dir, settings_changed_tracker, apply_button, cancel_close_button)) # MODIFIED
        reset_dir_button.pack(side="left", padx=5, pady=(5,0))


        # --- Populate Tab 2: Connection ---
        conn_scroll_frame = ctk.CTkScrollableFrame(tab_connection, fg_color="transparent")
        conn_scroll_frame.pack(fill="both", expand=True)

        device_selection_frame = ctk.CTkFrame(conn_scroll_frame) # MODIFIED
        device_selection_frame.pack(fill="x", pady=5, anchor="n")
        ctk.CTkLabel(device_selection_frame, text="USB Device Selection:", font=ctk.CTkFont(weight="bold")).pack(anchor="w", pady=(5,2), padx=5)
        
        device_combo_scan_frame = ctk.CTkFrame(device_selection_frame, fg_color="transparent")
        device_combo_scan_frame.pack(fill="x", padx=10, pady=(0,10))
        self.settings_device_combobox = ctk.CTkComboBox(device_combo_scan_frame, state="readonly", width=350) # MODIFIED
        self.settings_device_combobox.pack(side="left", fill="x", expand=True, padx=(0,5))
        scan_button = ctk.CTkButton(device_combo_scan_frame, text="Scan", width=80,
                                    command=lambda: self.scan_usb_devices_for_settings(settings_win, change_callback=_update_button_states_on_change)) # MODIFIED
        scan_button.pack(side="left")
        self.scan_usb_devices_for_settings(settings_win, initial_load=True, change_callback=_update_button_states_on_change)
        self.settings_device_combobox.configure(command=lambda e=None: on_device_selected(settings_changed_tracker, apply_button, cancel_close_button)) # MODIFIED CTkComboBox uses command

        autoconnect_checkbutton = ctk.CTkCheckBox(conn_scroll_frame, text="Autoconnect on startup", variable=self.autoconnect_var) # MODIFIED
        autoconnect_checkbutton.pack(pady=10, padx=10, anchor="w")
        
        ctk.CTkLabel(conn_scroll_frame, text="Target USB Interface Number:").pack(anchor="w", pady=(5,0), padx=10)
        target_interface_entry = ctk.CTkEntry(conn_scroll_frame, textvariable=self.target_interface_var, width=60) # MODIFIED Spinbox -> Entry
        target_interface_entry.pack(anchor="w", pady=2, padx=10)
        
        # --- Populate Tab 3: Operation ---
        op_scroll_frame = ctk.CTkScrollableFrame(tab_operation, fg_color="transparent")
        op_scroll_frame.pack(fill="both", expand=True)

        operational_settings_frame = ctk.CTkFrame(op_scroll_frame) # MODIFIED
        operational_settings_frame.pack(fill="x", pady=5, anchor="n")
        ctk.CTkLabel(operational_settings_frame, text="Timings & Auto-Refresh:", font=ctk.CTkFont(weight="bold")).pack(anchor="w", pady=(5,2), padx=5)
        
        ctk.CTkLabel(operational_settings_frame, text="Recording Status Check Interval (seconds):").pack(anchor="w", pady=(5,0), padx=10)
        recording_interval_entry = ctk.CTkEntry(operational_settings_frame, textvariable=self.recording_check_interval_var, width=60) # MODIFIED
        recording_interval_entry.pack(anchor="w", pady=2, padx=10)
        
        ctk.CTkLabel(operational_settings_frame, text="Default Command Timeout (ms):").pack(anchor="w", pady=(5,0), padx=10)
        cmd_timeout_entry = ctk.CTkEntry(operational_settings_frame, textvariable=self.default_command_timeout_ms_var, width=100) # MODIFIED
        cmd_timeout_entry.pack(anchor="w", pady=2, padx=10)
        
        ctk.CTkLabel(operational_settings_frame, text="File Streaming Timeout (seconds):").pack(anchor="w", pady=(5,0), padx=10)
        stream_timeout_entry = ctk.CTkEntry(operational_settings_frame, textvariable=self.file_stream_timeout_s_var, width=100) # MODIFIED
        stream_timeout_entry.pack(anchor="w", pady=2, padx=10)
        
        auto_refresh_check = ctk.CTkCheckBox(operational_settings_frame, text="Automatically refresh file list when connected", 
                                             variable=self.auto_refresh_files_var) # MODIFIED
        auto_refresh_check.pack(anchor="w", pady=(10,0), padx=10)
        ctk.CTkLabel(operational_settings_frame, text="Auto Refresh Interval (seconds):").pack(anchor="w", pady=(0,0), padx=10)
        auto_refresh_interval_entry = ctk.CTkEntry(operational_settings_frame, textvariable=self.auto_refresh_interval_s_var, width=60) # MODIFIED
        auto_refresh_interval_entry.pack(anchor="w", pady=(2,10), padx=10)

        # --- Populate Tab 4: Device Specific ---
        dev_spec_scroll_frame = ctk.CTkScrollableFrame(tab_device_specific, fg_color="transparent")
        dev_spec_scroll_frame.pack(fill="both", expand=True)
        
        device_behavior_frame = ctk.CTkFrame(dev_spec_scroll_frame) # MODIFIED
        device_behavior_frame.pack(fill="x", pady=5, anchor="n")
        ctk.CTkLabel(device_behavior_frame, text="Device Behavior Settings (Requires Connection):", font=ctk.CTkFont(weight="bold")).pack(anchor="w", pady=(5,2), padx=5)
        
        self.auto_record_checkbox = ctk.CTkCheckBox(device_behavior_frame, text="Auto Record on Power On", 
                                                    variable=self.device_setting_auto_record_var, state="disabled") # MODIFIED
        self.auto_record_checkbox.pack(anchor="w", padx=10, pady=2)
        self.auto_play_checkbox = ctk.CTkCheckBox(device_behavior_frame, text="Auto Play on Insert (if applicable)", 
                                                  variable=self.device_setting_auto_play_var, state="disabled") # MODIFIED
        self.auto_play_checkbox.pack(anchor="w", padx=10, pady=2)
        self.bt_tone_checkbox = ctk.CTkCheckBox(device_behavior_frame, text="Bluetooth Connection Tones", 
                                                variable=self.device_setting_bluetooth_tone_var, state="disabled") # MODIFIED
        self.bt_tone_checkbox.pack(anchor="w", padx=10, pady=2)
        self.notification_sound_checkbox = ctk.CTkCheckBox(device_behavior_frame, text="Notification Sounds", 
                                                           variable=self.device_setting_notification_sound_var, state="disabled") # MODIFIED
        self.notification_sound_checkbox.pack(anchor="w", padx=10, pady=(2,10))

        if self.dock.is_connected():
            def _after_device_settings_loaded_hook_settings():
                _finalize_initialization_and_button_states()
            threading.Thread(target=self._load_device_settings_for_dialog, args=(settings_win, _after_device_settings_loaded_hook_settings), daemon=True).start() # Pass the new hook
        else:
            settings_changed_tracker[0] = False
            # apply_button and cancel_close_button defined later, state set there.
        
        vars_to_trace = [self.autoconnect_var, self.logger_processing_level_var, self.selected_vid_var, self.selected_pid_var,
                         self.target_interface_var, self.recording_check_interval_var, self.default_command_timeout_ms_var,
                         self.file_stream_timeout_s_var, self.auto_refresh_files_var, self.auto_refresh_interval_s_var,
                         self.quit_without_prompt_var, self.appearance_mode_var, self.color_theme_var, 
                         self.suppress_console_output_var, self.suppress_gui_log_output_var, # MODIFIED (added new var)
                         self.device_setting_auto_record_var, self.device_setting_auto_play_var, self.device_setting_bluetooth_tone_var, self.device_setting_notification_sound_var]
        for level_key_trace in Logger.LEVELS.keys():
            level_lower_trace = level_key_trace.lower()
            vars_to_trace.append(getattr(self, f"log_color_{level_lower_trace}_light_var"))
            vars_to_trace.append(getattr(self, f"log_color_{level_lower_trace}_dark_var"))

        # --- Populate Tab 5: Logging (formerly Log Colors) ---
        logging_tab_scroll_frame = ctk.CTkScrollableFrame(tab_logging, fg_color="transparent") # MODIFIED: Parent is tab_logging
        logging_tab_scroll_frame.pack(fill="both", expand=True)

        # Moved Log Settings Frame (originally from General tab)
        log_settings_frame = ctk.CTkFrame(logging_tab_scroll_frame) # MODIFIED: Parent is logging_tab_scroll_frame
        log_settings_frame.pack(fill="x", pady=5, anchor="n")
        ctk.CTkLabel(log_settings_frame, text="General Logging Settings:", font=ctk.CTkFont(weight="bold")).pack(anchor="w", pady=(5,2), padx=5) # MODIFIED: Label text
        ctk.CTkLabel(log_settings_frame, text="Logger Processing Level:").pack(anchor="w", pady=(5,0), padx=10)
        log_level_combo = ctk.CTkComboBox(log_settings_frame, variable=self.logger_processing_level_var, 
                                          values=list(Logger.LEVELS.keys()), state="readonly")
        log_level_combo.pack(fill="x", pady=2, padx=10)
        suppress_console_check = ctk.CTkCheckBox(log_settings_frame, text="Suppress console output (logs still go to GUI)", 
                                                 variable=self.suppress_console_output_var)
        suppress_console_check.pack(anchor="w", pady=(5,0), padx=10)
        suppress_gui_log_check = ctk.CTkCheckBox(log_settings_frame, text="Suppress GUI log output (logs only to console/stderr)",
                                                 variable=self.suppress_gui_log_output_var)
        suppress_gui_log_check.pack(anchor="w", pady=(0,10), padx=10)

        # Log Color Settings Group
        log_color_settings_group_frame = ctk.CTkFrame(logging_tab_scroll_frame) # MODIFIED: Parent is logging_tab_scroll_frame
        log_color_settings_group_frame.pack(fill="x", pady=5, anchor="n", padx=0) # Use padx=0 if individual items have padx

        ctk.CTkLabel(log_color_settings_group_frame, text="Log Level Colors (Hex Codes, e.g., #RRGGBB):", font=ctk.CTkFont(weight="bold")).pack(anchor="w", pady=(5,10), padx=5)

        for level_name_upper in ["ERROR", "WARNING", "INFO", "DEBUG", "CRITICAL"]:
            level_name_lower = level_name_upper.lower()
            level_frame = ctk.CTkFrame(log_color_settings_group_frame) # MODIFIED: Parent is log_color_settings_group_frame
            level_frame.pack(fill="x", pady=3, padx=5)
            
            ctk.CTkLabel(level_frame, text=f"{level_name_upper}:", width=80, anchor="w").pack(side="left", padx=(0,10))
            
            ctk.CTkLabel(level_frame, text="Light:", width=40).pack(side="left", padx=(0,2))
            light_entry = ctk.CTkEntry(level_frame, textvariable=getattr(self, f"log_color_{level_name_lower}_light_var"), width=90)
            light_entry.pack(side="left", padx=(0,2)) # Added small padx
            
            light_color_var_ref = getattr(self, f"log_color_{level_name_lower}_light_var")
            light_preview_frame = ctk.CTkFrame(level_frame, width=20, height=20, corner_radius=3, border_width=1)
            light_preview_frame.pack(side="left", padx=(0, 10)) # Adjusted padx
            light_color_var_ref.trace_add("write", lambda *args, f=light_preview_frame, v=light_color_var_ref: self._update_color_preview_widget(f, v))
            self._update_color_preview_widget(light_preview_frame, light_color_var_ref) # Initial update
            
            ctk.CTkLabel(level_frame, text="Dark:", width=40).pack(side="left", padx=(0,2))
            dark_entry = ctk.CTkEntry(level_frame, textvariable=getattr(self, f"log_color_{level_name_lower}_dark_var"), width=90)
            dark_entry.pack(side="left", padx=(0,2)) # Added small padx

            dark_color_var_ref = getattr(self, f"log_color_{level_name_lower}_dark_var")
            dark_preview_frame = ctk.CTkFrame(level_frame, width=20, height=20, corner_radius=3, border_width=1)
            dark_preview_frame.pack(side="left", padx=(3, 5))
            dark_color_var_ref.trace_add("write", lambda *args, f=dark_preview_frame, v=dark_color_var_ref: self._update_color_preview_widget(f, v))
            self._update_color_preview_widget(dark_preview_frame, dark_color_var_ref) # Initial update
           
        # --- Layout for Buttons Frame (at the end of main_content_frame) ---
        buttons_frame.pack(fill="x", side="bottom", pady=(10,0), padx=10)
        action_buttons_subframe.pack(side="right")
        
        # Add a note about restarting for some settings if needed
        ctk.CTkLabel(main_content_frame, text="Note: Appearance/Theme changes apply immediately. Other settings update on Apply/OK.",
                      font=ctk.CTkFont(size=10, slant="italic")).pack(side="bottom", fill="x", pady=(5,0), padx=10)
        
        for var_to_trace in vars_to_trace:
            var_to_trace.trace_add('write', _update_button_states_on_change)
        # Bind
        def on_device_selected(change_tracker_ref, apply_btn_ref, cancel_btn_ref, event=None): # event can be choice string for CTkComboBox
            if not self.settings_device_combobox or not self.settings_device_combobox.winfo_exists(): return
            selection = self.settings_device_combobox.get()
            if not selection or selection == "--- Devices with Issues ---": return
            selected_device_info = next((dev for dev in self.available_usb_devices if dev[0] == selection), None)
            if selected_device_info:
                _, vid, pid = selected_device_info
                if self.selected_vid_var.get() != vid: self.selected_vid_var.set(vid) # Will trigger trace
                if self.selected_pid_var.get() != pid: self.selected_pid_var.set(pid) # Will trigger trace
                logger.debug("Settings", "on_device_selected", f"Selected device: VID={hex(vid)}, PID={hex(pid)}")
                # If .set() didn't change value, trace isn't fired, so manually call
                if self.selected_vid_var.get() == vid and self.selected_pid_var.get() == pid:
                    _update_button_states_on_change()
            else:
                logger.warning("Settings", "on_device_selected", f"Could not find details for: '{selection}'")

        def _perform_apply_settings_logic(update_dialog_baseline=False):
            # nonlocal initial_download_directory # MODIFIED: No longer needed due to container
            for config_key in initial_config_vars: # config_key is the actual key for self.config
                ctk_var_to_get_from = None
                if config_key == "appearance_mode":
                    ctk_var_to_get_from = self.appearance_mode_var
                elif config_key == "color_theme":
                    ctk_var_to_get_from = self.color_theme_var
                elif config_key == "quit_without_prompt_if_connected":
                    ctk_var_to_get_from = self.quit_without_prompt_var
                # For device settings, the key in initial_config_vars is the var attribute name
                # e.g., "device_setting_auto_record_var"
                elif config_key.startswith("device_setting_") and hasattr(self, config_key) and isinstance(getattr(self, config_key), ctk.Variable):
                    ctk_var_to_get_from = getattr(self, config_key)
                # For log color vars, key is "log_color_level_mode", var is "log_color_level_mode_var"
                # The key in initial_config_vars is like "log_color_error_light"
                # The ctk.Variable is like self.log_color_error_light_var
                elif config_key.startswith("log_color_") and hasattr(self, f"{config_key}_var") and isinstance(getattr(self, f"{config_key}_var"), ctk.Variable):
                    ctk_var_to_get_from = getattr(self, f"{config_key}_var")
                # For general settings like "autoconnect" (config_key) -> self.autoconnect_var
                elif hasattr(self, f"{config_key}_var"): 
                    ctk_var_to_get_from = getattr(self, f"{config_key}_var")
                
                if ctk_var_to_get_from is not None and isinstance(ctk_var_to_get_from, ctk.Variable):
                    self.config[config_key] = ctk_var_to_get_from.get()
                # else:
                #    logger.warning("GUI", "_perform_apply_settings_logic", f"Config key '{config_key}' from initial_config_vars not mapped to a ctk.Variable for self.config update.")
            
            # Save log colors
            if "log_colors" not in self.config: self.config["log_colors"] = {}
            for level_key_save in Logger.LEVELS.keys():
                level_lower_save = level_key_save.lower()
                light_var_name = f"log_color_{level_lower_save}_light_var"
                dark_var_name = f"log_color_{level_lower_save}_dark_var"
                if hasattr(self, light_var_name) and hasattr(self, dark_var_name):
                    self.config["log_colors"][level_key_save] = [
                        getattr(self, light_var_name).get(), 
                        getattr(self, dark_var_name).get()
                    ]

            self.download_directory = current_dialog_download_dir[0] 
            self.config["download_directory"] = self.download_directory
            self.apply_theme_and_color() # Apply theme changes

            if self.dock.is_connected() and self._fetched_device_settings_for_dialog:
                changed_device_settings = {}
                for conceptual_key, snake_case_part in conceptual_device_setting_keys.items():
                    tk_var_attr = getattr(self, f"device_setting_{snake_case_part}_var", None) # Add default None
                    fetched_val = self._fetched_device_settings_for_dialog.get(conceptual_key)
                    if tk_var_attr and tk_var_attr.get() != fetched_val: 
                        if fetched_val is not None or tk_var_attr.get() is not None: # Ensure actual change, not None vs None
                            changed_device_settings[conceptual_key] = tk_var_attr.get()
                if changed_device_settings:
                    threading.Thread(target=self._apply_device_settings_thread, args=(changed_device_settings,), daemon=True).start()
            
            save_config(self.config)
            logger.set_level(self.logger_processing_level_var.get())
            logger.update_config({"suppress_console_output": self.suppress_console_output_var.get(), "suppress_gui_log_output": self.suppress_gui_log_output_var.get()})
            self._update_log_text_area_tag_colors() # Apply new log colors to the GUI
            self.update_all_status_info() # This will update the download_dir display and other status elements

            if self.dock.is_connected(): 
                self.start_recording_status_check() 
                self.start_auto_file_refresh_periodic_check() 
            logger.info("GUI", "apply_settings_action", "Settings applied and saved.")

            if update_dialog_baseline:
                for key in initial_config_vars:
                    ctk_var_for_baseline = None
                    if key == "appearance_mode": ctk_var_for_baseline = self.appearance_mode_var
                    elif key == "color_theme": ctk_var_for_baseline = self.color_theme_var
                    elif key == "quit_without_prompt_if_connected": ctk_var_for_baseline = self.quit_without_prompt_var
                    elif key.startswith("device_setting_") and hasattr(self, key) and isinstance(getattr(self, key), ctk.Variable):
                        ctk_var_for_baseline = getattr(self, key)
                    elif key.startswith("log_color_") and hasattr(self, f"{key}_var") and isinstance(getattr(self, f"{key}_var"), ctk.Variable):
                        ctk_var_for_baseline = getattr(self, f"{key}_var")
                    elif hasattr(self, f"{key}_var"):
                        ctk_var_for_baseline = getattr(self, f"{key}_var")
                    
                    if ctk_var_for_baseline:
                        initial_config_vars[key] = ctk_var_for_baseline.get()
                
                # Update baseline for log colors (already handled by the loop above if keys are in initial_config_vars)
                # The initial_config_vars keys for log colors are like "log_color_error_light",
                # and the corresponding ctk.Variables are "log_color_error_light_var".
                # The loop above with `elif config_key.startswith("log_color_") and hasattr(self, f"{config_key}_var")`
                # should correctly get their values for the baseline.

                _initial_download_directory_container[0] = current_dialog_download_dir[0] # MODIFIED: Update container
                if self._fetched_device_settings_for_dialog:
                    for conceptual_key, snake_case_part in conceptual_device_setting_keys.items():
                        # Ensure fetched_dialog is updated with current var values before reset
                        var_to_get_from = getattr(self, f"device_setting_{snake_case_part}_var")
                        if var_to_get_from: # Check if var exists
                            self._fetched_device_settings_for_dialog[conceptual_key] = var_to_get_from.get()


        def ok_action():
            if settings_changed_tracker[0]: _perform_apply_settings_logic(update_dialog_baseline=False)
            # Key unbinding/rebinding for theme changes is handled by _perform_apply_settings_logic.
            settings_win.destroy()

        def apply_action_ui_handler():
            if settings_changed_tracker[0]:
                # This part applies the theme and updates the internal config model and device settings
                _perform_apply_settings_logic(update_dialog_baseline=True) 
                # Key unbinding/rebinding for theme changes is handled by _perform_apply_settings_logic.

                # This allows CTk theme changes to settle before we modify dialog widgets or focus.
                def _update_dialog_ui_after_apply():
                    if settings_win.winfo_exists(): # Ensure window wasn't closed by an unexpected side effect
                        logger.debug("GUI", "_update_dialog_ui_after_apply", "Attempting to restore settings dialog state post-theme-apply.")
                        settings_changed_tracker[0] = False # Reset tracker as changes are now baseline
                        
                        if ok_button.winfo_exists():
                            ok_button.configure(state="disabled") # OK is disabled
                            ok_button.pack_forget() # Hide OK button

                        if apply_button.winfo_exists() and apply_button.winfo_ismapped(): 
                            apply_button.configure(state="disabled") # Disable it
                            apply_button.pack_forget() # Hide Apply button

                        if cancel_close_button.winfo_exists(): 
                            cancel_close_button.configure(text="Close", fg_color=COLOR_CLOSE_GREY) # Back to Close, dark grey
                        
                        # Forcefully bring the dialog back to a visible and interactive state
                        settings_win.update_idletasks() # Process any pending geometry/drawing tasks
                        settings_win.withdraw()         # Force hide
                        settings_win.update_idletasks() # Allow processing of withdraw
                        settings_win.deiconify()        # Ensure it's not withdrawn (iconified) / Force show
                        settings_win.lift()             # Bring it to the top of the stacking order
                        settings_win.grab_set()         # Re-affirm the event grab
                        settings_win.focus_set() 
                        
                        if ok_button.winfo_exists(): # OK button is a common focus target after apply
                            ok_button.focus_set()
                        elif apply_button.winfo_exists(): # Fallback to apply button if OK isn't suitable
                            apply_button.focus_set()
                        logger.debug("GUI", "_update_dialog_ui_after_apply", "Settings dialog state restoration attempted.")
                    else:
                        logger.warning("GUI", "_update_dialog_ui_after_apply", "Settings window was not found during post-apply UI update.")

                if settings_win.winfo_exists():
                    settings_win.after(160, _update_dialog_ui_after_apply) # Increased delay to 160ms
                else:
                    logger.warning("GUI", "apply_action_ui_handler", "Settings window closed unexpectedly during apply logic.")
        def cancel_close_action():
            if settings_changed_tracker[0]: 
                for dict_key, initial_val in initial_config_vars.items():
                    tk_var_to_reset = None
                    # Check for direct attribute name (e.g. device_setting_auto_record_var)
                    if hasattr(self, dict_key) and isinstance(getattr(self, dict_key), ctk.Variable):
                        tk_var_to_reset = getattr(self, dict_key)
                    # Check for constructed attribute name (e.g. autoconnect -> autoconnect_var)
                    elif hasattr(self, f"{dict_key}_var") and isinstance(getattr(self, f"{dict_key}_var"), ctk.Variable):
                        tk_var_to_reset = getattr(self, f"{dict_key}_var")
                    
                    if tk_var_to_reset: tk_var_to_reset.set(initial_val)
                
                for level_key_revert in Logger.LEVELS.keys(): # Revert log color vars
                    level_l_revert = level_key_revert.lower()
                    getattr(self, f"log_color_{level_l_revert}_light_var").set(initial_config_vars[f"log_color_{level_l_revert}_light"])
                    getattr(self, f"log_color_{level_l_revert}_dark_var").set(initial_config_vars[f"log_color_{level_l_revert}_dark"])
                
                current_dialog_download_dir[0] = _initial_download_directory_container[0] # MODIFIED: Revert from container
                if current_dl_dir_label_settings.winfo_exists(): current_dl_dir_label_settings.configure(text=current_dialog_download_dir[0])
                logger.info("GUI", "cancel_close_action", "Settings changes cancelled.")
            settings_win.destroy()

        ok_button.configure(command=ok_action)
        apply_button.configure(command=apply_action_ui_handler)
        cancel_close_button.configure(command=cancel_close_action)
        # Buttons are packed dynamically by _update_button_states_on_change or initially only cancel_close_button
        
        settings_win.bind('<Return>', lambda event: ok_button.invoke())
        settings_win.bind('<Escape>', lambda event: cancel_close_button.invoke())
        
        # If not connected, async load won't happen, so call finalize init here.
        # If connected, _after_device_settings_loaded_hook_settings will call _finalize_initialization_and_button_states.
        if not self.dock.is_connected():
            _finalize_initialization_and_button_states() # This will schedule the _core_final_setup

        # Adjust window size after content is packed
        min_width, min_height = 600, 550 
        settings_win.geometry(f"{max(min_width, settings_win.winfo_reqwidth()+20)}x{max(min_height, settings_win.winfo_reqheight()+20)}")
        settings_win.minsize(min_width, min_height)

    def _update_color_preview_widget(self, frame_widget, color_string_var):
        if not frame_widget.winfo_exists():
            return
        color_hex = color_string_var.get()
        try:
            # Basic validation: starts with # and is 7 chars long (#RRGGBB) or 9 chars long (#RRGGBBAA for CTk)
            if color_hex.startswith("#") and (len(color_hex) == 7 or len(color_hex) == 9):
                frame_widget.configure(fg_color=color_hex)
            else:
                # Invalid format, set to a neutral/error color (light grey for light mode, dark grey for dark mode)
                frame_widget.configure(fg_color=self._apply_appearance_mode_theme_color(("#e0e0e0", "#404040")))
        except tkinter.TclError: # Handles invalid color names if not caught by basic check
            frame_widget.configure(fg_color=self._apply_appearance_mode_theme_color(("#e0e0e0", "#404040")))
        except Exception as e:
            logger.error("GUI", "_update_color_preview_widget", f"Unexpected error updating preview for color '{color_hex}': {e}")
            frame_widget.configure(fg_color=self._apply_appearance_mode_theme_color(("#e0e0e0", "#404040"))) # Fallback

    def _apply_saved_sort_state_to_tree_and_ui(self, files_data_list):
        if self.saved_treeview_sort_column and self.saved_treeview_sort_column in self.original_tree_headings:
            logger.info("GUI", "_apply_saved_sort_state", f"Applying saved sort: Col='{self.saved_treeview_sort_column}', Reverse={self.saved_treeview_sort_reverse}")
            self.treeview_sort_column = self.saved_treeview_sort_column
            self.treeview_sort_reverse = self.saved_treeview_sort_reverse
            
            files_data_list = self._sort_files_data(files_data_list, self.treeview_sort_column, self.treeview_sort_reverse)
            self.after(0, self._update_treeview_sort_indicator_ui_only) # MODIFIED after
            self.saved_treeview_sort_column = None 
        return files_data_list

    def _update_treeview_sort_indicator_ui_only(self):
        if not hasattr(self, 'file_tree') or not self.file_tree.winfo_exists(): return
        if not self.treeview_sort_column: 
            for col_id, original_text in self.original_tree_headings.items():
                self.file_tree.heading(col_id, text=original_text)
            return

        for col_id, original_text in self.original_tree_headings.items():
            arrow = ""
            if col_id == self.treeview_sort_column:
                arrow = " ▼" if self.treeview_sort_reverse else " ▲"
            try:
                if self.file_tree.winfo_exists():
                    self.file_tree.heading(col_id, text=original_text + arrow)
            except Exception as e: # MODIFIED: Generic TclError
                logger.warning("GUI", "_update_treeview_sort_indicator", f"Error updating heading for {col_id}: {e}")

    def _select_download_dir_for_settings_dialog(self, label_widget, dialog_dir_tracker, change_tracker, apply_btn, cancel_btn):
        selected_dir = filedialog.askdirectory(initialdir=dialog_dir_tracker[0], title="Select Download Directory", parent=label_widget.master.master.master) # Get CTkToplevel
        if selected_dir and selected_dir != dialog_dir_tracker[0]:
            dialog_dir_tracker[0] = selected_dir
            if label_widget and label_widget.winfo_exists(): label_widget.configure(text=dialog_dir_tracker[0])
            if not change_tracker[0]: 
                change_tracker[0] = True
                if apply_btn.winfo_exists(): apply_btn.configure(state="normal")
                if cancel_btn.winfo_exists(): cancel_btn.configure(text="Cancel")
            logger.debug("GUI", "_select_download_dir_for_settings", f"Download dir selection changed to: {dialog_dir_tracker[0]}")

    def _load_device_settings_for_dialog(self, settings_win_ref, on_complete_hook=None):
        try:
            settings = self.dock.get_device_settings()
            def safe_update(task): 
                if settings_win_ref.winfo_exists(): task()

            if settings:
                self._fetched_device_settings_for_dialog = settings.copy()
                self.after(0, lambda: safe_update(lambda: self.device_setting_auto_record_var.set(settings.get("autoRecord", False)) if self.device_setting_auto_record_var else None)) # MODIFIED: after + check var
                self.after(0, lambda: safe_update(lambda: self.device_setting_auto_play_var.set(settings.get("autoPlay", False)) if self.device_setting_auto_play_var else None))
                self.after(0, lambda: safe_update(lambda: self.device_setting_bluetooth_tone_var.set(settings.get("bluetoothTone", False)) if self.device_setting_bluetooth_tone_var else None))
                self.after(0, lambda: safe_update(lambda: self.device_setting_notification_sound_var.set(settings.get("notificationSound", False)) if self.device_setting_notification_sound_var else None))
                
                for cb in [self.auto_record_checkbox, self.auto_play_checkbox, self.bt_tone_checkbox, self.notification_sound_checkbox]:
                    if cb and cb.winfo_exists(): # Check if checkbox exists
                        self.after(0, lambda widget=cb: safe_update(lambda: widget.configure(state="normal")))
            else: logger.warning("GUI", "_load_device_settings_for_dialog", "Failed to load device settings.")
        except Exception as e:
            logger.error("GUI", "_load_device_settings_for_dialog", f"Error loading device settings: {e}")
            if settings_win_ref.winfo_exists(): messagebox.showerror("Error", f"Failed to load device settings: {e}", parent=settings_win_ref)
        finally:
            if on_complete_hook: self.after(0, lambda: safe_update(on_complete_hook))


    def _apply_device_settings_thread(self, settings_to_apply):
        if not settings_to_apply: logger.info("GUI", "_apply_device_settings_thread", "No device behavior settings changed."); return
        all_successful = True
        for name, value in settings_to_apply.items():
            result = self.dock.set_device_setting(name, value)
            if not result or result.get("result") != "success":
                all_successful = False
                logger.error("GUI", "_apply_device_settings_thread", f"Failed to set '{name}' to {value}.")
                self.after(0, lambda n=name: messagebox.showwarning("Settings Error", f"Failed to apply setting: {n}", parent=self)) # MODIFIED: after, parent
        if all_successful: logger.info("GUI", "_apply_device_settings_thread", "All changed device settings applied.")


    def scan_usb_devices_for_settings(self, parent_window, initial_load=False, change_callback=None):
        try:
            logger.info("GUI", "scan_usb_devices", "Scanning for USB devices...")
            self.available_usb_devices.clear()
            if not self.backend_initialized_successfully:
                messagebox.showerror("USB Error", "Libusb backend not initialized.", parent=parent_window)
                if hasattr(self, 'settings_device_combobox') and self.settings_device_combobox and self.settings_device_combobox.winfo_exists(): # Check if exists
                    self.settings_device_combobox.configure(values=["USB Backend Error"]); self.settings_device_combobox.set("USB Backend Error")
                return

            found_devices = usb.core.find(find_all=True, backend=self.usb_backend_instance)
            if not found_devices:
                if hasattr(self, 'settings_device_combobox') and self.settings_device_combobox and self.settings_device_combobox.winfo_exists(): # Check if exists
                    self.settings_device_combobox.configure(values=["No devices found"]); self.settings_device_combobox.set("No devices found")
                return

            good_devs, problem_devs = [], []
            for dev in found_devices:
                is_target = (dev.idVendor == self.selected_vid_var.get() and dev.idProduct == self.selected_pid_var.get())
                is_active = (self.dock.is_connected() and self.dock.device and dev.idVendor == self.dock.device.idVendor and dev.idProduct == self.dock.device.idProduct)
                try:
                    mfg = usb.util.get_string(dev, dev.iManufacturer) if dev.iManufacturer else "N/A"
                    prod = usb.util.get_string(dev, dev.iProduct) if dev.iProduct else "N/A"
                    desc = f"{mfg} - {prod} (VID: {hex(dev.idVendor)}, PID: {hex(dev.idProduct)})"
                    good_devs.append((desc, dev.idVendor, dev.idProduct))
                except Exception as e:
                    logger.warning("GUI", "scan_usb_devices", f"Error getting string for VID={hex(dev.idVendor)} PID={hex(dev.idProduct)}: {e}")
                    name_disp = self.dock.model if self.dock.model != "unknown" else "HiDock Device"
                    desc = f"Currently Connected: {name_disp} (VID={hex(dev.idVendor)}, PID={hex(dev.idProduct)})" if is_target and is_active else f"[Error Reading] (VID={hex(dev.idVendor)}, PID={hex(dev.idProduct)})"
                    (good_devs if is_target and is_active else problem_devs).insert(0 if is_target and is_active else len(problem_devs), (desc, dev.idVendor, dev.idProduct))
            
            if good_devs and "Currently Connected" in good_devs[0][0]: good_devs = [good_devs[0]] + sorted(good_devs[1:], key=lambda x: x[0])
            else: good_devs.sort(key=lambda x: x[0])
            problem_devs.sort(key=lambda x: x[0])
            self.available_usb_devices.extend(good_devs + problem_devs)
            
            combo_list = [t[0] for t in good_devs]
            if problem_devs:
                if combo_list: combo_list.append("--- Devices with Issues ---")
                combo_list.extend([t[0] for t in problem_devs])
            
            current_sel_str = next((d for d,v,p in self.available_usb_devices if v == self.selected_vid_var.get() and p == self.selected_pid_var.get()), None)

            if hasattr(self, 'settings_device_combobox') and self.settings_device_combobox and self.settings_device_combobox.winfo_exists(): # Check if exists
                self.settings_device_combobox.configure(values=combo_list if combo_list else ["No devices accessible"])
                if current_sel_str and current_sel_str in combo_list: self.settings_device_combobox.set(current_sel_str)
                elif combo_list and combo_list[0] != "--- Devices with Issues ---":
                    if not initial_load: # Only auto-select first if not initial load and no specific match
                        self.settings_device_combobox.set(combo_list[0])
                        sel_info = next((dt for dt in self.available_usb_devices if dt[0] == combo_list[0]), None)
                        if sel_info: self.selected_vid_var.set(sel_info[1]); self.selected_pid_var.set(sel_info[2]) # Triggers trace
                        if change_callback: change_callback() 
                elif not combo_list : self.settings_device_combobox.set("No devices accessible")
            logger.info("GUI", "scan_usb_devices", f"Found {len(good_devs)} good, {len(problem_devs)} problem devices.")
        except Exception as e:
            logger.error("GUI", "scan_usb_devices_for_settings", f"Unhandled exception: {e}\n{traceback.format_exc()}")
            if parent_window and parent_window.winfo_exists(): messagebox.showerror("Scan Error", f"Error during USB scan: {e}", parent=parent_window)

    def log_to_gui_widget(self, message, level_name="INFO"):
        def _update_log_task(msg, lvl):
            if not (hasattr(self, 'log_text_area') and self.log_text_area.winfo_exists()): return

            gui_filter_val = Logger.LEVELS.get(self.gui_log_filter_level_var.get().upper(), Logger.LEVELS["DEBUG"])
            msg_level_val = Logger.LEVELS.get(lvl.upper(), 0)
            if msg_level_val < gui_filter_val: return
            
            self.log_text_area.configure(state='normal')
            self.log_text_area.insert("end", msg, lvl) # Use "end" for CTkTextbox
            self.log_text_area.see("end")
            self.log_text_area.configure(state='disabled')
        if self.winfo_exists(): self.after(0, _update_log_task, message, level_name) # MODIFIED: self.after

    def clear_log_gui(self):
        if hasattr(self, 'log_text_area') and self.log_text_area.winfo_exists(): # Check if exists
            self.log_text_area.configure(state='normal'); self.log_text_area.delete(1.0, "end"); self.log_text_area.configure(state='disabled')
            logger.info("GUI", "clear_log_gui", "Log display cleared.")

    def on_gui_log_filter_change(self, choice_not_used): # MODIFIED: CTkComboBox command passes the choice
        logger.info("GUI", "on_gui_log_filter_change", f"GUI log display filter to {self.gui_log_filter_level_var.get()}.")
        # No need to manually refresh, log_to_gui_widget will apply filter

    def download_gui_logs(self):
        if not (hasattr(self, 'log_text_area') and self.log_text_area.winfo_exists()): return
        log_content = self.log_text_area.get(1.0, "end")
        if not log_content.strip(): messagebox.showinfo("Download Logs", "Log display is empty.", parent=self); return # MODIFIED parent
        filepath = filedialog.asksaveasfilename(defaultextension=".log", filetypes=[("Log files", "*.log"), ("Text", "*.txt")], title="Save GUI Logs", parent=self) # MODIFIED parent
        if filepath:
            try:
                with open(filepath, 'w', encoding='utf-8') as f: f.write(log_content)
                logger.info("GUI", "download_gui_logs", f"GUI logs saved to {filepath}")
                messagebox.showinfo("Download Logs", f"Logs saved to:\n{filepath}", parent=self) # MODIFIED parent
            except Exception as e:
                logger.error("GUI", "download_gui_logs", f"Error saving logs: {e}")
                messagebox.showerror("Download Logs Error", f"Failed to save logs: {e}", parent=self) # MODIFIED parent

    def _initialize_backend_early(self):
        # This method is non-UI, so it remains largely unchanged.
        # Using global logger for early messages.
        error_to_report, local_backend_instance = None, None
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            dll_paths_to_try = [os.path.join(script_dir, name) for name in ["libusb-1.0.dll"]] + \
                               [os.path.join(script_dir, "MS64", "dll", name) for name in ["libusb-1.0.dll"]] + \
                               [os.path.join(script_dir, "MS32", "dll", name) for name in ["libusb-1.0.dll"]]
            dll_path = next((p for p in dll_paths_to_try if os.path.exists(p)), None)

            if not dll_path:
                logger.warning("GUI", "_initialize_backend_early", "libusb-1.0.dll not found locally. Trying system paths.")
                local_backend_instance = usb.backend.libusb1.get_backend()
                if not local_backend_instance: error_to_report = "Libusb backend failed from system paths."
            else:
                logger.info("GUI", "_initialize_backend_early", f"Attempting backend with DLL: {dll_path}")
                local_backend_instance = usb.backend.libusb1.get_backend(find_library=lambda x: dll_path)
                if not local_backend_instance: error_to_report = f"Failed with DLL: {dll_path}. Check 32/64 bit."
            
            if error_to_report: logger.error("GUI", "_initialize_backend_early", error_to_report); return False, error_to_report, None
            logger.info("GUI", "_initialize_backend_early", f"Backend initialized: {local_backend_instance}")
            return True, None, local_backend_instance
        except Exception as e:
            error_to_report = f"Unexpected error initializing libusb: {e}"
            logger.error("GUI", "_initialize_backend_early", f"{error_to_report}\n{traceback.format_exc()}")
            return False, error_to_report, None


    def attempt_autoconnect_on_startup(self):
        if not self.backend_initialized_successfully: logger.warning("GUI", "attempt_autoconnect", "Skipping autoconnect, USB backend error."); return
        if self.autoconnect_var.get() and not self.dock.is_connected():
            logger.info("GUI", "attempt_autoconnect", "Attempting autoconnect..."); self.connect_device()

    def connect_device(self):
        if not self.backend_initialized_successfully:
            logger.error("GUI", "connect_device", "Cannot connect: USB backend not initialized.")
            self.update_status_bar(connection_status="Status: USB Backend FAILED!")
            if self.backend_init_error_message: messagebox.showerror("USB Backend Error", self.backend_init_error_message, parent=self) # MODIFIED parent
            self._update_menu_states()
            return
        if not self.winfo_exists(): logger.warning("GUI", "connect_device", "Master window gone, aborting."); return # MODIFIED self.winfo_exists
        
        self.update_status_bar(connection_status="Status: Connecting...")
        self._update_menu_states() 
        threading.Thread(target=self._connect_device_thread, daemon=True).start()

    def _connect_device_thread(self):
        try:
            vid, pid, interface = self.selected_vid_var.get(), self.selected_pid_var.get(), self.target_interface_var.get()
            if self.dock.connect(target_interface_number=interface, vid=vid, pid=pid):
                device_info = self.dock.get_device_info() 
                self.dock.device_info['_cached_card_info'] = self.dock.get_card_info()
                self.after(0, self.update_all_status_info) # MODIFIED self.after
                self.after(0, self._update_menu_states)
                if device_info:
                    self.after(0, self.refresh_file_list_gui)
                    self.start_recording_status_check()
                    if self.auto_refresh_files_var.get(): self.start_auto_file_refresh_periodic_check()
                else:
                    self.after(0, lambda: self.update_status_bar(connection_status="Status: Connected, but failed to get device info."))
                    self.stop_recording_status_check(); self.stop_auto_file_refresh_periodic_check()
            else: 
                logger.error("GUI", "_connect_device_thread", "dock.connect returned False.")
                self.after(0, lambda: self.handle_auto_disconnect_ui() if self.winfo_exists() else None) # MODIFIED
        except Exception as e:
            logger.error("GUI", "_connect_device_thread", f"Connection error: {e}\n{traceback.format_exc()}")
            if self.winfo_exists(): # MODIFIED
                self.after(0, lambda: self.update_status_bar(connection_status=f"Status: Connection Error ({type(e).__name__})"))
                if not self.dock.is_connected(): self.after(0, lambda: self.handle_auto_disconnect_ui() if self.winfo_exists() else None) # MODIFIED
        finally:
            if self.winfo_exists(): self.after(0, self._update_menu_states) # MODIFIED

    def handle_auto_disconnect_ui(self):
        logger.warning("GUI", "handle_auto_disconnect_ui", "Device auto-disconnected or connection lost.")
        self.update_status_bar(connection_status="Status: Disconnected (Error/Lost)")
        if hasattr(self, 'file_tree') and self.file_tree.winfo_exists():
            for item in self.file_tree.get_children(): self.file_tree.delete(item)
        self.displayed_files_details.clear()
        self.update_all_status_info()
        self.stop_auto_file_refresh_periodic_check()
        self.stop_recording_status_check()
        if self.dock.is_connected(): self.dock.disconnect()
        self._update_menu_states()

    def disconnect_device(self):
        self.dock.disconnect()
        self.update_status_bar(connection_status="Status: Disconnected")
        if hasattr(self, 'file_tree') and self.file_tree.winfo_exists():
            for item in self.file_tree.get_children(): self.file_tree.delete(item)
        self.displayed_files_details.clear()
        self.stop_auto_file_refresh_periodic_check()
        self.stop_recording_status_check()
        self.update_all_status_info()
        self._update_menu_states()

    def refresh_file_list_gui(self):
        if not self.backend_initialized_successfully: logger.warning("GUI", "refresh_file_list_gui", "Backend not init."); return
        if not self.dock.is_connected(): messagebox.showerror("Error", "Not connected.", parent=self); self._update_menu_states(); return # MODIFIED parent
        if self._is_ui_refresh_in_progress: logger.debug("GUI", "refresh_file_list_gui", "Refresh in progress."); return
        if self.is_long_operation_active : logger.debug("GUI", "refresh_file_list_gui", "Long operation active, refresh deferred."); return
            
        self._is_ui_refresh_in_progress = True
        self.update_status_bar(progress_text="Fetching file list...")
        self._update_menu_states()
        threading.Thread(target=self._refresh_file_list_thread, daemon=True).start()

    def _refresh_file_list_thread(self):
        try:
            list_result = self.dock.list_files(timeout_s=self.default_command_timeout_ms_var.get() / 1000)
            if not self.dock.is_connected(): self.after(0, self.handle_auto_disconnect_ui); return # MODIFIED

            files = list_result.get("files", [])
            self.dock.device_info['_cached_card_info'] = self.dock.get_card_info() 
            self.after(0, self.update_all_status_info) # MODIFIED

            if hasattr(self, 'file_tree') and self.file_tree.winfo_exists():
                for item in self.file_tree.get_children(): self.after(0, lambda i=item: self.file_tree.delete(i) if self.file_tree.exists(i) else None) # MODIFIED
            self.after(0, self.displayed_files_details.clear) # MODIFIED

            all_files_to_display = list(files)
            recording_info = self.dock.get_recording_file()
            if recording_info and recording_info.get("name") and not any(f.get("name") == recording_info['name'] for f in files):
                all_files_to_display.insert(0, {"name": recording_info['name'], "length": 0, "duration": "Recording...", "createDate": "In Progress", "createTime": "", "time": datetime.now(), "is_recording": True})

            if all_files_to_display:
                if self.saved_treeview_sort_column and self.saved_treeview_sort_column in self.original_tree_headings:
                    all_files_to_display = self._apply_saved_sort_state_to_tree_and_ui(all_files_to_display)
                elif self.treeview_sort_column: 
                    all_files_to_display = self._sort_files_data(all_files_to_display, self.treeview_sort_column, self.treeview_sort_reverse)
                    self.after(0, self._update_treeview_sort_indicator_ui_only) # MODIFIED

                for f_info in all_files_to_display:
                    status_text, tags = f_info.get('gui_status'), f_info.get('gui_tags')
                    if status_text is None:
                        if f_info.get("is_recording"): status_text, tags = "Recording", ('recording',)
                        else:
                            local_path = self._get_local_filepath(f_info['name'])
                            if os.path.exists(local_path):
                                try:
                                    status_text, tags = ("Mismatch", ('size_mismatch',)) if os.path.getsize(local_path) != f_info['length'] else ("Downloaded", ('downloaded_ok',))
                                except OSError: status_text, tags = "Error Checking Size", ('size_mismatch',)
                            else: status_text, tags = "On Device", ()
                        f_info['gui_status'], f_info['gui_tags'] = status_text, tags
                    
                    vals = (f_info['name'], "-", f_info['duration'], f_info.get('createDate',''), f_info.get('createTime',''), status_text) if f_info.get("is_recording") \
                           else (f_info['name'], f"{f_info['length']/1024:.2f}", f"{f_info['duration']:.2f}", f_info.get('createDate',''), f_info.get('createTime',''), status_text)
                    self.after(0, lambda fi=f_info, v=vals, t=tags: self.file_tree.insert("","end",values=v,iid=fi['name'],tags=t) if self.file_tree.winfo_exists() else None) # MODIFIED
                    self.after(0, lambda fi=f_info: self.displayed_files_details.append(fi)) # MODIFIED
            else:
                self.after(0, lambda: self.update_status_bar(progress_text=f"Error: {list_result.get('error','Unknown')}" if list_result.get("error") else "No files found.")) # MODIFIED
        except ConnectionError as ce: logger.error("GUI","_refresh_thread",f"ConnErr: {ce}"); self.after(0,self.handle_auto_disconnect_ui) # MODIFIED
        except Exception as e: logger.error("GUI","_refresh_thread",f"Error: {e}\n{traceback.format_exc()}"); self.after(0, lambda: self.update_status_bar(progress_text="Error loading files.")) # MODIFIED
        finally:
            self.after(0, lambda: setattr(self, '_is_ui_refresh_in_progress', False)) # MODIFIED
            self.after(0, self._update_menu_states) # MODIFIED
            self.after(0, lambda: self.update_status_bar(progress_text="Ready." if self.dock.is_connected() else "Disconnected.")) # MODIFIED
            self.after(0, self.update_all_status_info) # MODIFIED

    def _on_file_double_click(self, event):
        if not self.dock.is_connected() and not self.is_audio_playing: return
        item_iid = self.file_tree.identify_row(event.y)
        if not item_iid: return
        self.file_tree.selection_set(item_iid)
        file_detail = next((f for f in self.displayed_files_details if f['name'] == item_iid), None)
        if not file_detail: return
        status = file_detail.get('gui_status', "On Device")
        if self.is_audio_playing and self.current_playing_filename_for_replay == item_iid: self._stop_audio_playback(); return
        elif status in ["Downloaded", "Downloaded OK", "downloaded_ok"]: self.play_selected_audio_gui() # Added lowercase tag
        elif status in ["On Device", "Mismatch", "Cancelled"] or "Error" in status:
            if not file_detail.get("is_recording"): self.download_selected_files_gui()

    def _on_file_right_click(self, event):
        # Using tk.Menu for context menu as CTk doesn't have a direct replacement easily
        clicked_item_iid = self.file_tree.identify_row(event.y)
        current_selection = self.file_tree.selection()
        if clicked_item_iid and clicked_item_iid not in current_selection:
            self.file_tree.selection_set(clicked_item_iid) # This will trigger on_file_selection_change
            current_selection = (clicked_item_iid,) # Update local var for this method's logic
        
        # Update menu states based on potentially new selection
        self._update_menu_states() 

        context_menu = tkinter.Menu(self, tearoff=0) 
        try:
            menu_bg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkFrame"]["fg_color"])
            menu_fg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkLabel"]["text_color"])
            active_menu_bg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkButton"]["hover_color"])
            active_menu_fg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkButton"]["text_color"])
            disabled_fg = self._apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkLabel"]["text_color_disabled"])
            context_menu.configure(
                background=menu_bg,
                foreground=menu_fg,
                activebackground=active_menu_bg,
                activeforeground=active_menu_fg,
                disabledforeground=disabled_fg,
                relief="flat", borderwidth=0
            )
        except Exception as e:
            logger.warning("GUI", "_on_file_right_click", f"Could not style context menu: {e}")

        num_selected = len(current_selection)

        if num_selected == 1:
            item_iid = current_selection[0]
            file_detail = next((f for f in self.displayed_files_details if f['name'] == item_iid), None)
            if file_detail:
                status = file_detail.get('gui_status', "On Device")
                is_playable = file_detail['name'].lower().endswith((".wav", ".hda"))

                if self.is_audio_playing and self.current_playing_filename_for_replay == item_iid:
                    context_menu.add_command(label=f"Stop Playback", command=self._stop_audio_playback, image=self.icons.get("stop"), compound="left")
                elif is_playable and status not in ["Recording", "Downloading", "Queued"]:
                    context_menu.add_command(label=f"Play", command=self.play_selected_audio_gui, image=self.icons.get("play"), compound="left")
                
                if status in ["On Device", "Mismatch", "Cancelled"] or "Error" in status:
                    if not file_detail.get("is_recording"): context_menu.add_command(label=f"Download", command=self.download_selected_files_gui, image=self.icons.get("download"), compound="left")
                elif status == "Downloaded" or status == "Downloaded OK" or status == "downloaded_ok": 
                    context_menu.add_command(label=f"Re-download", command=self.download_selected_files_gui, image=self.icons.get("download"), compound="left")
                
                if status in ["Downloading", "Queued"] or "Preparing Playback" in status or self.active_operation_name: # Generic cancel
                    context_menu.add_command(label=f"Cancel Operation", command=self.request_cancel_operation, image=self.icons.get("stop"), compound="left")
                if not file_detail.get("is_recording"): 
                    context_menu.add_command(label=f"Delete", command=self.delete_selected_files_gui, image=self.icons.get("delete"), compound="left")
        elif num_selected > 1:
            context_menu.add_command(label=f"Download Selected ({num_selected})", command=self.download_selected_files_gui, image=self.icons.get("download"), compound="left")
            if not any(next((f for f in self.displayed_files_details if f['name'] == iid), {}).get("is_recording") for iid in current_selection):
                context_menu.add_command(label=f"Delete Selected ({num_selected})", command=self.delete_selected_files_gui, image=self.icons.get("delete"), compound="left")
        
        if context_menu.index("end") is not None: context_menu.add_separator() # MODIFIED: tk.END -> "end"
        context_menu.add_command(label=f"Refresh List", command=self.refresh_file_list_gui, 
                                 state="normal" if self.dock.is_connected() else "disabled", image=self.icons.get("refresh"), compound="left")
        if context_menu.index("end") is None: return # No items added
        try: context_menu.tk_popup(event.x_root, event.y_root)
        finally: context_menu.grab_release()


    def _update_file_status_in_treeview(self, filename_iid, new_status_text, new_tags_tuple=()):
        if not (self.winfo_exists() and hasattr(self, 'file_tree') and self.file_tree.winfo_exists() and self.file_tree.exists(filename_iid)): return # MODIFIED
        try:
            current_values = list(self.file_tree.item(filename_iid, 'values'))
            status_col_idx = self.file_tree['columns'].index('status')
            if status_col_idx < len(current_values):
                current_values[status_col_idx] = new_status_text
                self.file_tree.item(filename_iid, values=tuple(current_values), tags=new_tags_tuple)
                for detail in self.displayed_files_details:
                    if detail['name'] == filename_iid: detail['gui_status'], detail['gui_tags'] = new_status_text, new_tags_tuple; break
        except Exception as e: logger.error("GUI", "_update_file_status_in_treeview", f"Error for {filename_iid}: {e}\n{traceback.format_exc()}")

    def _get_local_filepath(self, device_filename):
        safe_filename = device_filename.replace(':','-').replace(' ','_').replace('\\','_').replace('/','_')
        return os.path.join(self.download_directory, safe_filename)

    def _sort_files_data(self, files_data, column_key, reverse_order):
        def get_sort_key(item):
            val = item.get(column_key)
            if column_key == "name": return item.get('name', '').lower()
            if column_key == "size": return item.get('length', 0)
            if column_key == "duration": return (0, item.get('duration','').lower()) if isinstance(item.get('duration'),str) else (1, item.get('duration',0))
            if column_key in ["date", "time"]: return item.get('time', datetime.min)
            if column_key == "status": return item.get('gui_status', '').lower()
            return val if val is not None else '' 
        return sorted(files_data, key=get_sort_key, reverse=reverse_order)

    def sort_treeview_column(self, column_name_map_key, is_numeric_string_unused):
        column_data_key = column_name_map_key
        if self.treeview_sort_column == column_data_key:
            self.treeview_sort_reverse = not self.treeview_sort_reverse
        else:
            self.treeview_sort_column = column_data_key
            self.treeview_sort_reverse = False
        
        self.saved_treeview_sort_column = None
        self.saved_treeview_sort_reverse = False

        self._update_treeview_sort_indicator_ui_only()
        
        self.displayed_files_details = self._sort_files_data(
            self.displayed_files_details, 
            self.treeview_sort_column, 
            self.treeview_sort_reverse
        )
        
        if hasattr(self, 'file_tree') and self.file_tree.winfo_exists():
            for item in self.file_tree.get_children():
                self.file_tree.delete(item)
            for f_info in self.displayed_files_details:
                status, tags = f_info.get('gui_status',"On Device"), f_info.get('gui_tags',())
                vals = (f_info['name'], "-", status, f_info.get('createDate',''), f_info.get('createTime',''), status) if f_info.get("is_recording") \
                    else (f_info['name'], f"{f_info['length']/1024:.2f}", f"{f_info['duration']:.2f}", f_info.get('createDate',''), f_info.get('createTime',''), status)
                self.file_tree.insert("", "end", values=vals, iid=f_info['name'], tags=tags) # MODIFIED tk.END
        
        self.on_file_selection_change(None)

    def start_recording_status_check(self):
        interval_s = self.recording_check_interval_var.get()
        if interval_s <= 0: logger.info("GUI", "start_rec_check", "Rec check interval <= 0, disabled."); self.stop_recording_status_check(); return
        self.stop_recording_status_check() 
        self._check_recording_status_periodically()

    def request_cancel_operation(self):
        if self.cancel_operation_event:
            logger.info("GUI", "request_cancel_operation", "Cancellation requested.")
            self.cancel_operation_event.set()
            self._set_long_operation_active_state(False, "Operation Cancelled") 
            self.update_status_bar(progress_text="Operation cancelling...")

    def stop_recording_status_check(self):
        if self._recording_check_timer_id: self.after_cancel(self._recording_check_timer_id); self._recording_check_timer_id = None # MODIFIED self.after_cancel

    def _check_recording_status_periodically(self):
        try:
            if not self.dock.is_connected(): self.stop_recording_status_check(); return
            if self.is_long_operation_active: return 

            recording_info = self.dock.get_recording_file(timeout_s=self.default_command_timeout_ms_var.get() / 1000)
            if not self.dock.is_connected(): self.stop_recording_status_check(); return
            current_recording_filename = recording_info.get("name") if recording_info else None
            if current_recording_filename != self._previous_recording_filename:
                self._previous_recording_filename = current_recording_filename
                self.refresh_file_list_gui() 
        except Exception as e: logger.error("GUI", "_check_rec_status", f"Unhandled: {e}\n{traceback.format_exc()}")
        finally:
            if self._recording_check_timer_id is not None and self.winfo_exists(): # MODIFIED check winfo_exists
                interval_ms = self.recording_check_interval_var.get() * 1000
                if interval_ms <= 0: self.stop_recording_status_check()
                else: self._recording_check_timer_id = self.after(interval_ms, self._check_recording_status_periodically) # MODIFIED self.after

    def start_auto_file_refresh_periodic_check(self):
        self.stop_auto_file_refresh_periodic_check()
        if self.auto_refresh_files_var.get() and self.dock.is_connected():
            interval_s = self.auto_refresh_interval_s_var.get()
            if interval_s <= 0: logger.info("GUI", "start_auto_refresh", "Interval <=0, disabled."); return
            self._check_auto_file_refresh_periodically()

    def stop_auto_file_refresh_periodic_check(self):
        if self._auto_file_refresh_timer_id: self.after_cancel(self._auto_file_refresh_timer_id); self._auto_file_refresh_timer_id = None # MODIFIED

    def _check_auto_file_refresh_periodically(self):
        try:
            if not self.dock.is_connected() or not self.auto_refresh_files_var.get(): self.stop_auto_file_refresh_periodic_check(); return
            if self.is_long_operation_active: return 
            self.refresh_file_list_gui()
        except Exception as e: logger.error("GUI", "_check_auto_refresh", f"Unhandled: {e}\n{traceback.format_exc()}")
        finally:
            if self._auto_file_refresh_timer_id is not None and self.winfo_exists(): # MODIFIED
                interval_ms = self.auto_refresh_interval_s_var.get() * 1000
                if interval_ms <= 0: self.stop_auto_file_refresh_periodic_check()
                else: self._auto_file_refresh_timer_id = self.after(interval_ms, self._check_auto_file_refresh_periodically) # MODIFIED


    def _reset_download_dir_for_settings(self, label_widget, dialog_dir_tracker, change_tracker, apply_btn, cancel_btn):
        default_dir = os.getcwd()
        if default_dir != dialog_dir_tracker[0]:
            dialog_dir_tracker[0] = default_dir
            if label_widget and label_widget.winfo_exists(): label_widget.configure(text=dialog_dir_tracker[0])
            if not change_tracker[0]: 
                change_tracker[0] = True
                if apply_btn.winfo_exists(): apply_btn.configure(state="normal")
                if cancel_btn.winfo_exists(): cancel_btn.configure(text="Cancel")

    def _set_long_operation_active_state(self, active: bool, operation_name: str = ""):
        self.is_long_operation_active = active
        if active:
            self.update_status_bar(progress_text=f"{operation_name} in progress...")
            self.cancel_operation_event = threading.Event()
            self.active_operation_name = operation_name
        else:
            self.update_status_bar(progress_text=f"{operation_name} finished." if operation_name else "Ready.")
            self.cancel_operation_event = None
            self.active_operation_name = None
        self._update_menu_states()
        self.on_file_selection_change(None) 

    def play_selected_audio_gui(self):
        if not pygame: messagebox.showerror("Playback Error", "Pygame not installed or mixer failed to initialize.", parent=self); return # MODIFIED
        selected_iids = self.file_tree.selection()
        if not selected_iids or len(selected_iids) > 1: return
        file_iid = selected_iids[0]
        file_detail = next((f for f in self.displayed_files_details if f['name'] == file_iid), None)
        if not file_detail or not (file_detail['name'].lower().endswith((".wav", ".hda"))): return

        if self.is_long_operation_active and not self.is_audio_playing: messagebox.showwarning("Busy", "Another operation in progress.", parent=self); return # MODIFIED
        if self.is_audio_playing: self._stop_audio_playback(mode="user_stop_via_button"); return

        local_filepath = self._get_local_filepath(file_detail['name'])
        if os.path.exists(local_filepath) and file_detail.get('gui_status') not in ["Mismatch", "Error (Download)"]:
            self._cleanup_temp_playback_file(); self.current_playing_temp_file = None
            self._start_playback_local_file(local_filepath, file_detail)
        else:
            self._update_file_status_in_treeview(file_detail['name'], "Preparing Playback...", ('queued',))
            self._set_long_operation_active_state(True, "Playback Preparation")
            self.update_status_bar(progress_text=f"Preparing to play {file_detail['name']}...")
            self._cleanup_temp_playback_file()
            try:
                temp_fd, self.current_playing_temp_file = tempfile.mkstemp(suffix=".wav" if file_detail['name'].lower().endswith(".wav") else ".hda")
                os.close(temp_fd)
                threading.Thread(target=self._download_for_playback_thread, args=(file_detail,), daemon=True).start()
            except Exception as e:
                logger.error("GUI", "play_selected_audio_gui", f"Temp file error: {e}")
                messagebox.showerror("Playback Error", f"Temp file error: {e}", parent=self) # MODIFIED
                self._set_long_operation_active_state(False, "Playback Preparation")
                self._update_file_status_in_treeview(file_detail['name'], "Error (Playback Prep)", ('size_mismatch',))

    def _download_for_playback_thread(self, file_info):
        try:
            with open(self.current_playing_temp_file, "wb") as outfile:
                def data_cb(chunk): outfile.write(chunk)
                def progress_cb(rcvd, total):
                    self.after(0, self.update_file_progress, rcvd, total, f"(Playback) {file_info['name']}") # MODIFIED
                    self.after(0, self._update_file_status_in_treeview, file_info['name'], "Downloading (Play)", ('downloading',)) # MODIFIED
                status = self.dock.stream_file(file_info['name'], file_info['length'], data_cb, progress_cb, timeout_s=self.file_stream_timeout_s_var.get(), cancel_event=self.cancel_operation_event)
            
            if status == "OK": self.after(0, self._start_playback_local_file, self.current_playing_temp_file, file_info) # MODIFIED
            elif status == "cancelled": self.after(0, self._update_file_status_in_treeview, file_info['name'], "Cancelled", ('cancelled',)); self._cleanup_temp_playback_file() # MODIFIED
            elif status == "fail_disconnected": self.after(0, self.handle_auto_disconnect_ui); self._cleanup_temp_playback_file() # MODIFIED
            else: 
                self.after(0, lambda: messagebox.showerror("Playback Error", f"Download failed: {status}", parent=self)) # MODIFIED
                self.after(0, self._update_file_status_in_treeview, file_info['name'], "Error (Download)", ('size_mismatch',)); self._cleanup_temp_playback_file() # MODIFIED
        except Exception as e:
            if not self.dock.is_connected(): self.after(0, self.handle_auto_disconnect_ui) # MODIFIED
            logger.error("GUI", "_download_for_playback_thread", f"Error: {e}\n{traceback.format_exc()}")
            self.after(0, lambda: messagebox.showerror("Playback Error", f"Error: {e}", parent=self)); self._cleanup_temp_playback_file() # MODIFIED
            self.after(0, self._update_file_status_in_treeview, file_info['name'], "Error (Playback Prep)", ('size_mismatch',)) # MODIFIED
        finally:
            self.after(0, self._set_long_operation_active_state, False, "Playback Preparation") # MODIFIED
            self.after(0, self.start_auto_file_refresh_periodic_check) # MODIFIED


    def _start_playback_local_file(self, filepath, original_file_info):
        try:
            if not pygame or not pygame.mixer.get_init(): messagebox.showerror("Playback Error", "Pygame not initialized.", parent=self); return # MODIFIED
            pygame.mixer.music.load(filepath)
            sound = pygame.mixer.Sound(filepath); self.playback_total_duration = sound.get_length(); del sound
            self.is_audio_playing = True
            if not hasattr(self, 'playback_controls_frame') or not self.playback_controls_frame or not self.playback_controls_frame.winfo_exists(): # MODIFIED Check self.playback_controls_frame directly
                self._create_playback_controls_frame()
            
            self.total_duration_label.configure(text=time.strftime('%M:%S', time.gmtime(self.playback_total_duration)))
            self.playback_slider.configure(to=self.playback_total_duration); self.playback_slider.set(0)
            pygame.mixer.music.play(loops=(-1 if self.loop_playback_var.get() else 0))
            
            # Pack playback_controls_frame above status_bar_frame
            # Need to ensure status_bar_frame is already packed.
            if self.playback_controls_frame.winfo_ismapped(): self.playback_controls_frame.pack_forget() # Ensure it's not already packed elsewhere
            self.playback_controls_frame.pack(fill="x", side="bottom", pady=5, before=self.status_bar_frame)

            self._update_playback_progress()
            self.update_status_bar(progress_text=f"Playing: {os.path.basename(filepath)}")
            self.current_playing_filename_for_replay = original_file_info['name']
            self._update_file_status_in_treeview(original_file_info['name'], "Playing", ('playing',))
            self._update_menu_states()
        except Exception as e:
            logger.error("GUI", "_start_playback_local_file", f"Error: {e}\n{traceback.format_exc()}")
            messagebox.showerror("Playback Error", f"Could not play: {e}", parent=self); self._cleanup_temp_playback_file(); self.is_audio_playing = False # MODIFIED
            self._update_menu_states()

    def _create_playback_controls_frame(self):
        if hasattr(self, 'playback_controls_frame') and self.playback_controls_frame is not None and self.playback_controls_frame.winfo_exists():
            self.playback_controls_frame.destroy()

        self.playback_controls_frame = ctk.CTkFrame(self, height=40) # MODIFIED
        
        self.current_time_label = ctk.CTkLabel(self.playback_controls_frame, text="00:00", width=45); self.current_time_label.pack(side="left", padx=5, pady=5)
        self.playback_slider = ctk.CTkSlider(self.playback_controls_frame, from_=0, to=100, command=self._on_slider_value_changed_by_command) # MODIFIED
        self.playback_slider.pack(side="left", fill="x", expand=True, padx=5, pady=5)
        self.playback_slider.bind("<ButtonPress-1>", self._on_slider_press); self.playback_slider.bind("<ButtonRelease-1>", self._on_slider_release)
        self.total_duration_label = ctk.CTkLabel(self.playback_controls_frame, text="00:00", width=45); self.total_duration_label.pack(side="left", padx=5, pady=5)
        
        ctk.CTkLabel(self.playback_controls_frame, text="Vol:").pack(side="left", padx=(10,0), pady=5)
        self.volume_slider_widget = ctk.CTkSlider(self.playback_controls_frame, from_=0, to=1, variable=self.volume_var, command=self._on_volume_change, width=100) # MODIFIED
        self.volume_slider_widget.pack(side="left", padx=(0,5), pady=5)
        if pygame and pygame.mixer.get_init(): pygame.mixer.music.set_volume(self.volume_var.get())
        
        self.loop_checkbox = ctk.CTkCheckBox(self.playback_controls_frame, text="Loop", variable=self.loop_playback_var, command=self._on_loop_toggle) # MODIFIED
        self.loop_checkbox.pack(side="left", padx=5, pady=5)


    def _update_playback_progress(self):
        if self.is_audio_playing and pygame and pygame.mixer.get_init() and pygame.mixer.music.get_busy():
            current_pos_sec = min(pygame.mixer.music.get_pos() / 1000.0, self.playback_total_duration)
            if not self._user_is_dragging_slider and hasattr(self, 'playback_slider') and self.playback_slider.winfo_exists() and abs(self.playback_slider.get() - current_pos_sec) > 0.5: 
                self.playback_slider.set(current_pos_sec)
            if hasattr(self, 'current_time_label') and self.current_time_label.winfo_exists():
                self.current_time_label.configure(text=time.strftime('%M:%S', time.gmtime(current_pos_sec)))
            self.playback_update_timer_id = self.after(250, self._update_playback_progress) # MODIFIED
        elif self.is_audio_playing: self._stop_audio_playback(mode="natural_end")


    def _on_slider_press(self, event): self._user_is_dragging_slider = True; self.after_cancel(self.playback_update_timer_id) if self.playback_update_timer_id else None # MODIFIED
    def _on_slider_release(self, event):
        seek_pos_sec = self.playback_slider.get(); self._user_is_dragging_slider = False
        if self.is_audio_playing and pygame and pygame.mixer.get_init():
            try:
                pygame.mixer.music.stop(); pygame.mixer.music.play(loops=(-1 if self.loop_playback_var.get() else 0), start=seek_pos_sec)
                if hasattr(self, 'current_time_label') and self.current_time_label.winfo_exists():
                    self.current_time_label.configure(text=time.strftime('%M:%S', time.gmtime(seek_pos_sec)))
                if pygame.mixer.music.get_busy(): self._update_playback_progress()
            except Exception as e: logger.error("GUI", "_on_slider_release_seek", f"Error seeking: {e}")
    
    def _on_slider_value_changed_by_command(self, value_str): # CTkSlider passes float
        if hasattr(self, 'current_time_label') and self.current_time_label.winfo_exists():
            self.current_time_label.configure(text=time.strftime('%M:%S', time.gmtime(float(value_str))))

    def _on_volume_change(self, value_str): # CTkSlider passes float
        if pygame and pygame.mixer.get_init(): 
            try: pygame.mixer.music.set_volume(float(value_str))
            except Exception as e: logger.error("GUI", "_on_volume_change", f"Error setting volume: {e}")
    
    def _on_loop_toggle(self):
        if self.is_audio_playing and pygame and pygame.mixer.get_init() and pygame.mixer.music.get_busy():
            pygame.mixer.music.play(loops=(-1 if self.loop_playback_var.get() else 0), start=pygame.mixer.music.get_pos()/1000.0)

    def on_file_selection_change(self, event=None):
        try:
            self.update_all_status_info() 
            self._update_menu_states()
        except Exception as e: logger.error("GUI", "on_file_selection_change", f"Unhandled: {e}\n{traceback.format_exc()}")

    def _on_delete_key_press(self, event):
        if self.dock.is_connected() and self.file_tree.selection() and self.actions_menu.entrycget("Delete Selected", "state") == "normal": # MODIFIED tk.NORMAL
            self.delete_selected_files_gui()
        return "break"
    def _on_enter_key_press(self, event):
        if not self.dock.is_connected() or len(self.file_tree.selection()) != 1: return "break"
        try:
            # Create a dummy event object that mimics tkinter event enough for identify_row
            class DummyEvent: y = 0
            dummy_event = DummyEvent()
            bbox = self.file_tree.bbox(self.file_tree.selection()[0]) # Get bounding box of selected item
            if bbox: 
                dummy_event.y = bbox[1] + bbox[3]//2 # Center y in the item
                self._on_file_double_click(dummy_event)
        except Exception as e: logger.warning("GUI", "_on_enter_key_press", f"Could not simulate double click: {e}")
        return "break"
    def _on_f5_key_press(self, event=None):
        if self.dock.is_connected() and self.view_menu.entrycget("Refresh File List", "state") == "normal": # MODIFIED tk.NORMAL
            self.refresh_file_list_gui()

    def _stop_audio_playback(self, mode="user_stop"):
        was_playing_filename = self.current_playing_filename_for_replay
        if pygame and pygame.mixer.get_init():
            pygame.mixer.music.stop(); 
            try: pygame.mixer.music.unload()
            except Exception as e: logger.warning("GUI", "_stop_audio_playback", f"Unload error: {e}")
        self.is_audio_playing = False
        if self.playback_update_timer_id: self.after_cancel(self.playback_update_timer_id); self.playback_update_timer_id = None # MODIFIED
        if hasattr(self, 'playback_controls_frame') and self.playback_controls_frame and self.playback_controls_frame.winfo_exists(): self.playback_controls_frame.pack_forget() # MODIFIED
        self._cleanup_temp_playback_file()
        self.on_file_selection_change(None) 
        if was_playing_filename:
            file_detail = next((f for f in self.displayed_files_details if f['name'] == was_playing_filename), None)
            if file_detail:
                new_status, new_tags = "On Device", ()
                local_path = self._get_local_filepath(was_playing_filename)
                if os.path.exists(local_path):
                    try: new_status, new_tags = ("Mismatch",('size_mismatch',)) if os.path.getsize(local_path) != file_detail.get('length') else ("Downloaded",('downloaded_ok',))
                    except OSError: new_status, new_tags = "Error Checking Size", ('size_mismatch',)
                self._update_file_status_in_treeview(was_playing_filename, new_status, new_tags)
        if mode != "natural_end": self.update_status_bar(progress_text="Playback stopped.")
        self._update_menu_states()


    def _cleanup_temp_playback_file(self):
        if self.current_playing_temp_file and os.path.exists(self.current_playing_temp_file):
            try: os.remove(self.current_playing_temp_file); logger.info("GUI", "_cleanup_temp", f"Deleted temp: {self.current_playing_temp_file}")
            except Exception as e: logger.error("GUI", "_cleanup_temp", f"Error deleting temp: {e}")
        self.current_playing_temp_file = None; self.current_playing_filename_for_replay = None

    def download_selected_files_gui(self):
        selected_iids = self.file_tree.selection()
        if not selected_iids: messagebox.showinfo("No Selection", "Please select files to download.", parent=self); return # MODIFIED
        if not self.download_directory or not os.path.isdir(self.download_directory): messagebox.showerror("Error", "Invalid download directory.", parent=self); return # MODIFIED
        if self.is_long_operation_active: messagebox.showwarning("Busy", "Another operation in progress.", parent=self); return # MODIFIED
        files_to_download_info = [f for iid in selected_iids if (f := next((fd for fd in self.displayed_files_details if fd['name'] == iid), None))]
        self._set_long_operation_active_state(True, "Download Queue")
        threading.Thread(target=self._process_download_queue_thread, args=(files_to_download_info,), daemon=True).start()

    def _process_download_queue_thread(self, files_to_download_info):
        total_files = len(files_to_download_info)
        self.after(0, lambda: self.update_status_bar(progress_text=f"Batch Download: Initializing {total_files} file(s)...")) # MODIFIED
        for i, file_info in enumerate(files_to_download_info): self.after(0, self._update_file_status_in_treeview, file_info['name'], f"Queued ({i+1}/{total_files})", ('queued',)) # MODIFIED
        
        batch_start_time, completed_count, operation_aborted = time.time(), 0, False
        for i, file_info in enumerate(files_to_download_info):
            if not self.dock.is_connected(): logger.error("GUI", "_process_dl_q", "Disconnected."); self.after(0, self.handle_auto_disconnect_ui); operation_aborted=True; break # MODIFIED
            if self.cancel_operation_event and self.cancel_operation_event.is_set(): logger.info("GUI", "_process_dl_q", "Cancelled."); operation_aborted=True; break
            if self._execute_single_download(file_info, i + 1, total_files): completed_count += 1
            if not self.dock.is_connected() or (self.cancel_operation_event and self.cancel_operation_event.is_set()): operation_aborted=True; break
        
        duration = time.time() - batch_start_time
        final_msg = f"Batch: {completed_count}/{total_files} completed in {duration:.2f}s." if not operation_aborted else f"Download queue {'cancelled' if self.cancel_operation_event and self.cancel_operation_event.is_set() else 'aborted'} after {duration:.2f}s."
        self.after(0, lambda: self.update_status_bar(progress_text=final_msg)) # MODIFIED
        self.after(0, self._set_long_operation_active_state, False, "Download Queue") # MODIFIED
        self.after(0, self.start_auto_file_refresh_periodic_check) # MODIFIED
        # Reset progress bar to 0 after batch completion
        self.after(0, lambda: self.update_file_progress(0, 1, final_msg) if hasattr(self, 'status_file_progress_bar') and self.status_file_progress_bar.winfo_exists() else None)

    def delete_selected_files_gui(self):
        selected_iids = self.file_tree.selection()
        if not selected_iids: messagebox.showinfo("No Selection", "Please select files to delete.", parent=self); return # MODIFIED
        if not messagebox.askyesno("Confirm Delete", f"Permanently delete {len(selected_iids)} selected file(s)? This cannot be undone.", parent=self): return # MODIFIED
        self._set_long_operation_active_state(True, "Deletion")
        threading.Thread(target=self._delete_files_thread, args=([iid for iid in selected_iids],), daemon=True).start()

    def _delete_files_thread(self, filenames):
        success, fail = 0,0
        for i, filename in enumerate(filenames):
            if not self.dock.is_connected(): logger.error("GUI", "_delete_thread", "Disconnected."); self.after(0, self.handle_auto_disconnect_ui); break # MODIFIED
            self.after(0, lambda fn=filename, cur=i+1, tot=len(filenames): self.update_status_bar(progress_text=f"Deleting {fn} ({cur}/{tot})...")) # MODIFIED
            status = self.dock.delete_file(filename, timeout_s=self.default_command_timeout_ms_var.get() / 1000)
            if status and status.get("result") == "success": success += 1
            else: fail += 1; logger.error("GUI", "_delete_thread", f"Failed to delete {filename}: {status.get('error', status.get('result'))}")
        
        self.after(0, lambda s=success, f=fail: self.update_status_bar(progress_text=f"Deletion complete. Succeeded: {s}, Failed: {f}")) # MODIFIED
        self.after(0, self.refresh_file_list_gui) # MODIFIED
        self.after(0, self._set_long_operation_active_state, False, "Deletion") # MODIFIED

    def select_all_files_action(self):
        if hasattr(self,'file_tree') and self.file_tree.winfo_exists(): self.file_tree.selection_set(self.file_tree.get_children())
    def clear_selection_action(self):
        if hasattr(self,'file_tree') and self.file_tree.winfo_exists(): self.file_tree.selection_set([])

    def format_sd_card_gui(self):
        if not self.dock.is_connected(): messagebox.showerror("Error", "Not connected.", parent=self); return # MODIFIED
        if not messagebox.askyesno("Confirm Format", "WARNING: This will erase ALL data. Continue?", parent=self) or \
           not messagebox.askyesno("Final Confirmation", "FINAL WARNING: Formatting will erase everything. Continue?", parent=self): return # MODIFIED
        
        dialog = ctk.CTkInputDialog(text="Type 'FORMAT' to confirm formatting.", title="Type Confirmation") # MODIFIED
        confirm_text = dialog.get_input()

        if confirm_text is None or confirm_text.upper() != "FORMAT": messagebox.showwarning("Format Cancelled", "Confirmation text mismatch.", parent=self); return # MODIFIED
        self._set_long_operation_active_state(True, "Formatting Storage")
        threading.Thread(target=self._format_sd_card_thread, daemon=True).start()

    def _format_sd_card_thread(self):
        self.after(0, lambda: self.update_status_bar(progress_text="Formatting Storage... Please wait.")) # MODIFIED
        status = self.dock.format_card(timeout_s=max(60, self.default_command_timeout_ms_var.get() / 1000))
        if status and status.get("result") == "success": 
            self.after(0, lambda: messagebox.showinfo("Format Success", "Storage formatted successfully.", parent=self)) # MODIFIED
        else: 
            self.after(0, lambda s=status: messagebox.showerror("Format Failed", f"Failed to format storage: {s.get('error', s.get('result', 'Unknown'))}", parent=self)) # MODIFIED
        self.after(0, lambda: self.update_status_bar(progress_text="Format operation finished.")) # MODIFIED
        self.after(0, self.refresh_file_list_gui) # MODIFIED
        self.after(0, self._set_long_operation_active_state, False, "Formatting Storage") # MODIFIED

    def sync_device_time_gui(self):
        if not self.dock.is_connected(): messagebox.showerror("Error", "Not connected.", parent=self); return # MODIFIED
        if not messagebox.askyesno("Confirm Sync Time", "Set device time to computer's current time?", parent=self): return # MODIFIED
        self._set_long_operation_active_state(True, "Time Sync")
        threading.Thread(target=self._sync_device_time_thread, daemon=True).start()

    def _sync_device_time_thread(self):
        self.after(0, lambda: self.update_status_bar(progress_text="Syncing device time...")) # MODIFIED
        result = self.dock.set_device_time(datetime.now())
        if result and result.get("result") == "success": 
            self.after(0, lambda: messagebox.showinfo("Time Sync", "Device time synchronized.", parent=self)) # MODIFIED
        else:
            err = result.get('error','Unknown') if result else "Comm error"
            if result and 'device_code' in result: err += f" (Dev code: {result['device_code']})"
            self.after(0, lambda e=err: messagebox.showerror("Time Sync Error", f"Failed to sync time: {e}", parent=self)) # MODIFIED
        self.after(0, self._set_long_operation_active_state, False, "Time Sync") # MODIFIED
        self.after(0, lambda: self.update_status_bar(progress_text="Time sync finished.")) # MODIFIED


    def _execute_single_download(self, file_info, file_index, total_files_to_download):
        self.after(0, self._update_file_status_in_treeview, file_info['name'], "Downloading", ('downloading',)) # MODIFIED
        self.after(0, lambda: self.update_status_bar(progress_text=f"Batch ({file_index}/{total_files_to_download}): Downloading {file_info['name']}...")) # MODIFIED
        self.after(0, lambda fi=file_info: self.update_file_progress(0, 1, f"Starting {fi['name']}...") if hasattr(self, 'status_file_progress_bar') and self.status_file_progress_bar.winfo_exists() else None)
        
        start_time, operation_succeeded = time.time(), False
        safe_name = file_info['name'].replace(':','-').replace(' ','_').replace('\\','_').replace('/','_')
        temp_path = os.path.join(self.download_directory, f"_temp_{safe_name}")
        final_path = os.path.join(self.download_directory, safe_name)

        try:
            with open(temp_path, "wb") as outfile:
                def data_cb(chunk): outfile.write(chunk)
                def progress_cb(rcvd, total):
                    elapsed = time.time() - start_time
                    speed_bps = rcvd / elapsed if elapsed > 0 else 0
                    etr_s = (total - rcvd) / speed_bps if speed_bps > 0 else float('inf')
                    etr_str = f"ETR: {time.strftime('%M:%S',time.gmtime(etr_s))}" if etr_s != float('inf') else "ETR: ..."
                    speed_str = f"{speed_bps/1024:.1f}KB/s" if speed_bps < 1024*1024 else f"{speed_bps/(1024*1024):.1f}MB/s"
                    
                    # Update Treeview status column with percentage
                    percentage_val = (rcvd / total) * 100 if total > 0 else 0
                    tree_status_text = f"Downloading ({percentage_val:.0f}%)"
                    self.after(0, self._update_file_status_in_treeview, file_info['name'], tree_status_text, ('downloading',))
                    # MODIFIED: Changed file_info['name'] to Batch X/Y
                    self.after(0, self.update_file_progress, rcvd, total, f"Batch {file_index}/{total_files_to_download} | {speed_str} | {etr_str}")
                
                stream_status = self.dock.stream_file(file_info['name'], file_info['length'], data_cb, progress_cb, timeout_s=self.file_stream_timeout_s_var.get(), cancel_event=self.cancel_operation_event)

            if stream_status == "OK":
                if os.path.exists(final_path): os.remove(final_path)
                os.rename(temp_path, final_path)
                self.after(0, self.update_file_progress, file_info['length'], file_info['length'], file_info['name']) # MODIFIED
                self.after(0, self._update_file_status_in_treeview, file_info['name'], "Downloaded", ('downloaded_ok',)) # MODIFIED
                operation_succeeded = True
            else:
                msg = f"Download failed for {file_info['name']}. Status: {stream_status}."
                if stream_status not in ["cancelled", "fail_disconnected"]: # keep temp for other errors
                    msg += f" Temp file kept: {os.path.basename(temp_path)}"
                else: # remove temp for cancelled or disconnected
                    if os.path.exists(temp_path): os.remove(temp_path)

                logger.error("GUI", "_execute_single_download", msg)
                self.after(0, lambda m=msg: self.update_status_bar(progress_text=m)) # MODIFIED
                final_status_text, final_tags = ("Error (Disconnect)", ('size_mismatch',)) if stream_status == "fail_disconnected" else \
                                                ("Cancelled", ('cancelled',)) if stream_status == "cancelled" else \
                                                ("Download Failed", ('size_mismatch',))
                self.after(0, self._update_file_status_in_treeview, file_info['name'], final_status_text, final_tags) # MODIFIED
                if stream_status == "fail_disconnected": self.after(0, self.handle_auto_disconnect_ui) # MODIFIED
                if stream_status == "cancelled" and self.cancel_operation_event: self.cancel_operation_event.set()
        except Exception as e:
            logger.error("GUI", "_execute_single_download", f"Error DL {file_info['name']}: {e}\n{traceback.format_exc()}")
            self.after(0, lambda: self.update_status_bar(progress_text=f"Error with {file_info['name']}. Temp file kept.")) # MODIFIED
            self.after(0, self._update_file_status_in_treeview, file_info['name'], "Error (Download)", ('size_mismatch',)) # MODIFIED
            if not self.dock.is_connected(): self.after(0, self.handle_auto_disconnect_ui) # MODIFIED
        return operation_succeeded

    def update_file_progress(self, received, total, status_text_prefix=""):
        if hasattr(self, 'status_file_progress_bar') and self.status_file_progress_bar.winfo_exists():
            percentage = (received / total) if total > 0 else 0 # Value between 0 and 1 for CTkProgressBar
            self.status_file_progress_bar.set(float(percentage)) # Ensure it's a float

            if self.default_progressbar_fg_color and self.default_progressbar_progress_color:
                # Treat 0% and 100% (with small tolerance for float issues)
                # Use a small epsilon for floating point comparisons
                epsilon = 0.001 
                if percentage <= epsilon or percentage >= (1.0 - epsilon): 
                    self.status_file_progress_bar.configure(progress_color=self.default_progressbar_fg_color)
                else:
                    self.status_file_progress_bar.configure(progress_color=self.default_progressbar_progress_color)
            # else: theme colors not yet initialized, CTk will use its defaults.

        self.update_status_bar(progress_text=f"{status_text_prefix} ({received/ (1024*1024):.2f}/{total/ (1024*1024):.2f} MB)")
        if self.winfo_exists(): # Check if main window exists
            self.update_idletasks()

    def _update_default_progressbar_colors(self):
        if hasattr(self, 'status_file_progress_bar') and self.status_file_progress_bar.winfo_exists():
            # fg_color is the trough, progress_color is the bar
            # These cget calls return (light_color, dark_color) tuples from CTk
            fg_color_tuple = self.status_file_progress_bar.cget("fg_color")
            progress_color_tuple = self.status_file_progress_bar.cget("progress_color")

            self.default_progressbar_fg_color = self._apply_appearance_mode_theme_color(fg_color_tuple)
            self.default_progressbar_progress_color = self._apply_appearance_mode_theme_color(progress_color_tuple)
            
            # If the progress bar is currently at 0 (or effectively 0),
            # ensure its progress_color is set to the fg_color (trough color)
            # to make the bar "invisible", matching the behavior at 0% during updates.
            current_progress_value = self.status_file_progress_bar.get()
            epsilon = 0.001
            if current_progress_value <= epsilon and self.default_progressbar_fg_color:
                self.status_file_progress_bar.configure(progress_color=self.default_progressbar_fg_color)
                logger.debug("GUI", "_update_default_progressbar_colors",
                             f"Progress bar at {current_progress_value}%. Set progress_color to default fg_color: {self.default_progressbar_fg_color} to hide initial sliver.")
            # If it's not at 0%, update_file_progress will handle setting the correct
            # progress_color during actual download/playback progress updates.
        else:
            logger.warning("GUI", "_update_default_progressbar_colors", "Could not update progressbar colors as widget not ready.")

    def on_closing(self):
        if self._recording_check_timer_id: self.after_cancel(self._recording_check_timer_id) # MODIFIED
        if self._auto_file_refresh_timer_id: self.after_cancel(self._auto_file_refresh_timer_id) # MODIFIED
        if self.is_audio_playing: self._stop_audio_playback()
        if pygame and pygame.mixer.get_init(): pygame.mixer.quit()
        
        operational_keys = [
            "autoconnect", "log_level", "selected_vid", "selected_pid", "target_interface", 
            "recording_check_interval_s", "default_command_timeout_ms", "file_stream_timeout_s",
            "auto_refresh_files", "auto_refresh_interval_s", "suppress_gui_log_output", # ADDED new key
            "quit_without_prompt_if_connected",
            "appearance_mode", "color_theme", "suppress_console_output" # MODIFIED
        ]
        for config_key_on_close in operational_keys:
            var_to_get_from_on_close = None
            if config_key_on_close == "appearance_mode":
                var_to_get_from_on_close = self.appearance_mode_var
            elif config_key_on_close == "color_theme":
                var_to_get_from_on_close = self.color_theme_var
            elif config_key_on_close == "quit_without_prompt_if_connected":
                var_to_get_from_on_close = self.quit_without_prompt_var
            elif config_key_on_close == "log_level": # Config key
                var_to_get_from_on_close = self.logger_processing_level_var # Actual variable name
            elif config_key_on_close == "recording_check_interval_s": # Config key
                var_to_get_from_on_close = self.recording_check_interval_var # Actual variable name
            elif hasattr(self, f"{config_key_on_close}_var"): # General case like autoconnect -> autoconnect_var
                var_to_get_from_on_close = getattr(self, f"{config_key_on_close}_var")

            if var_to_get_from_on_close is not None and isinstance(var_to_get_from_on_close, ctk.Variable):
                self.config[config_key_on_close] = var_to_get_from_on_close.get()
            else:
                logger.warning("GUI", "on_closing", f"Could not find ctk.Variable for config key '{config_key_on_close}' during on_closing.")
        
        self.config["download_directory"] = self.download_directory
        
        # Save log colors
        if "log_colors" not in self.config: self.config["log_colors"] = {}
        for level_key_save_exit in Logger.LEVELS.keys():
            level_l_save_exit = level_key_save_exit.lower()
            self.config["log_colors"][level_key_save_exit] = [getattr(self, f"log_color_{level_l_save_exit}_light_var").get(), getattr(self, f"log_color_{level_l_save_exit}_dark_var").get()]

        if hasattr(self, 'file_tree') and self.file_tree.winfo_exists():
            try:
                current_display_order = list(self.file_tree["displaycolumns"])
                default_initial_order_str = self.config.get("treeview_columns_display_order", "name,size,duration,date,time,status")

                if current_display_order and current_display_order[0] != "#all": # #all means default order
                    self.config["treeview_columns_display_order"] = ",".join(current_display_order)
                elif current_display_order and current_display_order[0] == "#all" and "treeview_columns_display_order" in self.config:
                    # If current is #all (meaning it's default based on `columns` tuple)
                    # and a different order was previously saved, remove the saved one.
                    if self.config["treeview_columns_display_order"] != ",".join(list(self.file_tree["columns"])):
                        del self.config["treeview_columns_display_order"]
                elif "treeview_columns_display_order" in self.config and current_display_order and current_display_order[0] == "#all":
                    del self.config["treeview_columns_display_order"]

            except Exception: # MODIFIED: Generic TclError
                logger.warning("GUI", "on_closing", "Could not retrieve treeview displaycolumns.")
        
        if hasattr(self, 'winfo_exists') and self.winfo_exists(): # MODIFIED
            try:
                self.config["window_geometry"] = self.geometry() # MODIFIED
            except Exception: # MODIFIED
                logger.warning("GUI", "on_closing", "Could not retrieve window geometry.")

        if hasattr(self, 'logs_visible_var'):
            self.config["logs_pane_visible"] = self.logs_visible_var.get()
        
        if hasattr(self, 'gui_log_filter_level_var'):
            self.config["gui_log_filter_level"] = self.gui_log_filter_level_var.get()

        if hasattr(self, 'loop_playback_var'):
            self.config["loop_playback"] = self.loop_playback_var.get()
        if hasattr(self, 'volume_var'):
            self.config["playback_volume"] = self.volume_var.get()

        if hasattr(self, 'treeview_sort_column') and self.treeview_sort_column:
            self.config["treeview_sort_col_id"] = self.treeview_sort_column
            self.config["treeview_sort_descending"] = self.treeview_sort_reverse
        elif "treeview_sort_col_id" in self.config: 
            del self.config["treeview_sort_col_id"]
            if "treeview_sort_descending" in self.config:
                del self.config["treeview_sort_descending"]

        save_config(self.config)

        if self.dock and self.dock.is_connected():
            if self.quit_without_prompt_var.get() or messagebox.askokcancel("Quit", "Disconnect HiDock and quit?", parent=self): # MODIFIED
                self.dock.disconnect()
                self.destroy() # MODIFIED
            else: logger.info("GUI", "on_closing", "Quit cancelled by user.")
        else:
            self.destroy() # MODIFIED

    def _set_minimum_window_size(self):
        """Calculates and sets the minimum window size."""
        self.update_idletasks() # Ensure widget dimensions are calculated

        # --- Minimum Width Calculation ---
        # Based on the toolbar's content.
        # Sum of reqwidth of all buttons in toolbar + their horizontal paddings.
        min_toolbar_content_width = 0
        toolbar_buttons = [
            self.toolbar_connect_button, self.toolbar_refresh_button,
            self.toolbar_download_button, self.toolbar_play_button,
            self.toolbar_delete_button, self.toolbar_settings_button
        ]
        for btn in toolbar_buttons:
            if btn.winfo_exists():
                min_toolbar_content_width += btn.winfo_reqwidth()
        
        # Add approximate horizontal padding between buttons and at ends of toolbar
        # (5 for connect_left + 2*4 for in-between left buttons + 2 for delete_right + 2 for settings_left + 2 for settings_right)
        # Simplified: (num_buttons + 1) * average_padding_around_button
        min_toolbar_content_width += (len(toolbar_buttons) + 1) * 4 # Approx 4px padding around each item
        min_toolbar_content_width += 20 # For window chrome (borders, title bar)
        
        # --- Minimum Height Calculation ---
        menubar_height_estimate = 30 # For tkinter.Menu
        toolbar_h = self.toolbar_frame.winfo_reqheight() if hasattr(self, 'toolbar_frame') and self.toolbar_frame.winfo_exists() else 0
        statusbar_h = self.status_bar_frame.winfo_reqheight() if hasattr(self, 'status_bar_frame') and self.status_bar_frame.winfo_exists() else 0
        
        files_label_h = self.files_label.winfo_reqheight() if hasattr(self, 'files_label') and self.files_label.winfo_exists() else 20
        
        treeview_row_h = 25  # As set in _update_treeview_style
        treeview_header_estimate = 30 
        min_tree_rows = 4
        min_treeview_plus_header_h = treeview_header_estimate + (min_tree_rows * treeview_row_h)

        # Paddings within files_frame (label pady + tree_frame pady)
        files_frame_internal_vertical_padding = 5 + 5 + 5 + 5 # label_pady_top+bottom + tree_frame_pady_top+bottom
        min_files_frame_content_h = files_label_h + min_treeview_plus_header_h + files_frame_internal_vertical_padding

        inter_section_padding = 2 + 5 + 5 # toolbar_pady_bottom + main_content_pady_top + main_content_pady_bottom
        min_total_height = menubar_height_estimate + toolbar_h + min_files_frame_content_h + statusbar_h + inter_section_padding
        min_total_height += 10 # A little extra buffer

        logger.info("GUI", "_set_minimum_window_size", f"Calculated min_width: {int(min_toolbar_content_width)}, min_height: {int(min_total_height)}")
        self.minsize(int(min_toolbar_content_width), int(min_total_height))

# --- Main Execution ---
if __name__ == "__main__":
    # customtkinter.set_ grüner_theme() # Example for a custom theme file
    app = None 
    try:
        app = HiDockToolGUI() # MODIFIED: No root passed to CTk class __init__
        app.mainloop()
    except Exception as e:
        print(f"CRITICAL ERROR DURING GUI INITIALIZATION OR RUNTIME:\n{traceback.format_exc()}")
        # Try to show a Tkinter error if CTk fails catastrophically early
        temp_root_for_error = None
        try:
            if app and app.winfo_exists(): app.withdraw() # Hide broken window
            
            # Fallback to basic tkinter for error message if customtkinter itself is the problem
            import tkinter as tk_err
            temp_root_for_error = tk_err.Tk()
            temp_root_for_error.withdraw() # Hide the empty root window
            tk_err.messagebox.showerror("Fatal Error", f"Critical error:\n\n{e}\n\nApp will close. Check console.", parent=temp_root_for_error)
        except Exception as e_diag: 
            print(f"Could not display Tkinter error dialog: {e_diag}")
        finally:
            if temp_root_for_error and temp_root_for_error.winfo_exists():
                temp_root_for_error.destroy()
        sys.exit(1)