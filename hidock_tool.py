import usb.core
import usb.util
import usb.backend.libusb1 # Explicitly import the backend
import os
import time
import struct
from datetime import datetime
import tkinter as tk
import json
from tkinter import ttk, filedialog, messagebox, simpledialog
import threading
import traceback # For detailed error logging
import tempfile # For temporary audio files
import subprocess # For opening directories
import sys # For platform detection

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
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        # Logger might not be fully initialized yet, so use print for this specific case
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
            "quit_without_prompt_if_connected": False, # Default to prompt
            "theme": "default",
            "suppress_console_output": False
        }
    except json.JSONDecodeError:
        print(f"[ERROR] Config::load_config - Error decoding {CONFIG_FILE}. Using defaults.")
        return { # Return defaults on decode error as well
            "autoconnect": False, "download_directory": os.getcwd(), "log_level": "INFO",
            "selected_vid": DEFAULT_VENDOR_ID, "selected_pid": DEFAULT_PRODUCT_ID,
            "target_interface": 0, "recording_check_interval_s": 3,
            "default_command_timeout_ms": 5000, "file_stream_timeout_s": 180,
            "auto_refresh_files": False, "auto_refresh_interval_s": 30,
            "quit_without_prompt_if_connected": False, "theme": "default",
            "suppress_console_output": False
        }

class Logger:
    LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
    def __init__(self, initial_config=None): # Accept initial config
        self.gui_log_callback = None
        self.config = initial_config if initial_config else {} # Store config
        self.set_level(self.config.get("log_level", "INFO"))

    def set_gui_log_callback(self, callback):
        self.gui_log_callback = callback

    def set_level(self, level_name):
        self.level = self.LEVELS.get(level_name.upper(), self.LEVELS["INFO"])
        print(f"[INFO] Logger::set_level - Log level set to {level_name.upper()}")

    def update_config(self, new_config_dict):
        self.config.update(new_config_dict)

    def _log(self, level_str, module, procedure, message):
        msg_level_val = self.LEVELS.get(level_str.upper())
        if msg_level_val is None or msg_level_val < self.level:
            return

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        log_message = f"[{timestamp}][{level_str.upper()}] {str(module)}::{str(procedure)} - {message}"

        if not self.config.get("suppress_console_output", False):
            print(log_message)
        if self.gui_log_callback:
            self.gui_log_callback(log_message + "\n", level_str.upper())

    def info(self, module, procedure, message): self._log("info", module, procedure, message)
    def debug(self, module, procedure, message): self._log("debug", module, procedure, message)
    def error(self, module, procedure, message): self._log("error", module, procedure, message)
    def warning(self, module, procedure, message): self._log("warning", module, procedure, message)

logger = Logger(initial_config=load_config())

def save_config(config_data): # Ensure save_config uses the logger if available
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config_data, f, indent=4)
        logger.info("Config", "save_config", f"Configuration saved to {CONFIG_FILE}")
    except IOError:
        logger.error("Config", "save_config", f"Error writing to {CONFIG_FILE}.")
    except Exception as e:
        logger.error("Config", "save_config", f"Unexpected error saving config: {e}")

# --- HiDock Communication Class ---
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
                    # This indicates a persistent misalignment or corrupted data.
                    # Clearing buffer might be too aggressive, but consider if this state is recoverable.
                    # For now, break to allow more data or timeout.
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
            except ConnectionError as e: # Catch ConnectionError from _send_command or _receive_response
                logger.error("Jensen", "_send_and_receive", f"ConnectionError CMD {command_id}: {e}")
                # self.disconnect() would have been called internally if it was due to missing device/ep
                raise # Re-raise for higher level handling if needed

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
                return None # Or an error structure

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
                if status_to_return != "OK" and self.device and self.ep_in: # Flush stale data
                    logger.debug("Jensen", "stream_file", "Attempting to flush stale IN data.")
                    for _ in range(20): # Max attempts
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

# --- Tkinter GUI Application ---
class HiDockToolGUI:
    def __init__(self, master):
        self.master = master
        self.config = load_config()

        master.title("HiDock Explorer Tool")
        saved_geometry = self.config.get("window_geometry", "850x750+100+100") # Now self.config is defined
        try:
            master.geometry(saved_geometry)
        except tk.TclError:
            # Logger might not be fully initialized yet if its config depends on self.config,
            # so using print here for safety, or ensure logger is configured after self.config
            print(f"[WARNING] GUI::__init__ - Failed to apply saved geometry '{saved_geometry}'. Using default.") 
            # logger.warning("GUI", "__init__", f"Failed to apply saved geometry '{saved_geometry}'. Using default.") # If logger is safe to use
            master.geometry("850x750+100+100") # Fallback

        self.usb_backend_instance = None
        # ... (other initializations like self.backend_initialized_successfully)
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
        # Initialize tk Variables
        self.autoconnect_var = tk.BooleanVar(value=self.config.get("autoconnect", False))
        self.download_directory = self.config.get("download_directory", os.getcwd())
        self.logger_processing_level_var = tk.StringVar(value=self.config.get("log_level", "INFO"))
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
        self.suppress_console_output_var = tk.BooleanVar(value=self.config.get("suppress_console_output", False))
        self.gui_log_filter_level_var = tk.StringVar(value="DEBUG")
        
        # Device behavior tk.BooleanVars
        self.device_setting_auto_record_var = tk.BooleanVar()
        self.device_setting_auto_play_var = tk.BooleanVar()
        self.device_setting_bluetooth_tone_var = tk.BooleanVar()
        self.device_setting_notification_sound_var = tk.BooleanVar()
        self.device_setting_auto_record_var = tk.BooleanVar()
        self.device_setting_auto_play_var = tk.BooleanVar()
        self.device_setting_bluetooth_tone_var = tk.BooleanVar()
        self.device_setting_notification_sound_var = tk.BooleanVar()

        # --- Load additional persistent UI settings ---
        self.treeview_columns_display_order_str = self.config.get("treeview_columns_display_order", "") # Saved as comma-separated string
        
        self.logs_visible_var = tk.BooleanVar(value=self.config.get("logs_pane_visible", False))
        self.device_tools_visible_var = tk.BooleanVar(value=self.config.get("device_tools_pane_visible", False))
        # Sync internal state if needed, though vars are primary now
        self.logs_visible = self.logs_visible_var.get()
        self.device_tools_visible = self.device_tools_visible_var.get()

        self.gui_log_filter_level_var = tk.StringVar(value=self.config.get("gui_log_filter_level", "DEBUG"))
        
        self.loop_playback_var = tk.BooleanVar(value=self.config.get("loop_playback", False))
        self.volume_var = tk.DoubleVar(value=self.config.get("playback_volume", 0.5))

        # For restoring sort state (loaded here, applied after data load)
        self.saved_treeview_sort_column = self.config.get("treeview_sort_col_id", None)
        self.saved_treeview_sort_reverse = self.config.get("treeview_sort_descending", False)
        # These will be transferred to self.treeview_sort_column and self.treeview_sort_reverse 
        # by _apply_saved_sort_state_to_tree_and_ui before data is displayed with that sort.

        # Other attributes
        self.available_usb_devices = []
        self.displayed_files_details = []
        self.logs_visible = False # Tracks if the log_frame is intended to be visible
        self.device_tools_visible = False # Tracks if device_tools_frame is intended to be visible
        self.logs_visible_var = tk.BooleanVar(value=self.logs_visible) # For menu checkbutton
        self.device_tools_visible_var = tk.BooleanVar(value=self.device_tools_visible) # For menu checkbutton

        self.treeview_sort_column = None
        self.treeview_sort_reverse = False
        self._recording_check_timer_id = None
        self._auto_file_refresh_timer_id = None
        self._is_ui_refresh_in_progress = False
        self._previous_recording_filename = None
        self._fetched_device_settings_for_dialog = {}
        self.is_long_operation_active = False
        self.cancel_operation_event = None
        self.active_operation_name = None # To store the type of active long operation
        
        # Audio playback attributes
        self.is_audio_playing = False
        self.current_playing_temp_file = None
        self.current_playing_filename_for_replay = None
        self.playback_update_timer_id = None
        self.loop_playback_var = tk.BooleanVar(value=False)
        self.volume_var = tk.DoubleVar(value=0.5) 
        self._user_is_dragging_slider = False
        self.playback_total_duration = 0.0
        self.playback_controls_frame = None

        self.original_tree_headings = {"name": "Name", "size": "Size (KB)", "duration": "Duration (s)", "date": "Date", "time": "Time", "status": "Status"}

        global pygame
        if pygame:
            try:
                pygame.mixer.init()
                logger.info("GUI", "__init__", "Pygame mixer initialized.")
            except Exception as e:
                logger.error("GUI", "__init__", f"Pygame mixer init failed: {e}")
                pygame = None
        
        self.create_widgets() # Create all widgets, including menubar and status bar
        
        logger.set_level(self.logger_processing_level_var.get())
        logger.set_gui_log_callback(self.log_to_gui_widget)

        if not self.backend_initialized_successfully:
            self.update_status_bar(connection_status=f"USB Backend Error! Check logs.")
            if hasattr(self, 'file_menu'):
                 self.file_menu.entryconfig("Connect to HiDock", state=tk.DISABLED)
            # Also disable toolbar connect button if backend failed
            if hasattr(self, 'toolbar_connect_button'):
                self.toolbar_connect_button.config(state=tk.DISABLED)


        self.apply_theme(self.theme_var.get())
        self.update_all_status_info() # Initialize status bar text
        self._update_optional_panes_visibility() # Ensure panes are correctly hidden/shown initially

        self.master.bind("<F5>", self._on_f5_key_press)
        self.master.protocol("WM_DELETE_WINDOW", self.on_closing)

        if self.autoconnect_var.get():
            self.master.after(500, self.attempt_autoconnect_on_startup)

    def _create_menubar(self):
        menubar = tk.Menu(self.master)
        self.master.config(menu=menubar)

        # File Menu
        self.file_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="File", menu=self.file_menu)
        self.file_menu.add_command(label="Connect to HiDock", command=self.connect_device, accelerator="Ctrl+O")
        self.file_menu.add_command(label="Disconnect", command=self.disconnect_device, state=tk.DISABLED, accelerator="Ctrl+D")
        self.file_menu.add_separator()
        self.file_menu.add_command(label="Settings", command=self.open_settings_window, accelerator="Ctrl+,")
        self.file_menu.add_separator()
        self.file_menu.add_command(label="Exit", command=self.on_closing, accelerator="Alt+F4")
        self.master.bind_all("<Control-o>", lambda e: self.connect_device() if self.file_menu.entrycget("Connect to HiDock", "state") == tk.NORMAL else None)
        self.master.bind_all("<Control-d>", lambda e: self.disconnect_device() if self.file_menu.entrycget("Disconnect", "state") == tk.NORMAL else None)
        self.master.bind_all("<Control-comma>", lambda e: self.open_settings_window())


        # View Menu
        self.view_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="View", menu=self.view_menu)
        self.view_menu.add_command(label="Refresh File List", command=self.refresh_file_list_gui, state=tk.DISABLED, accelerator="F5")
        self.view_menu.add_separator()
        self.view_menu.add_checkbutton(label="Show Logs", onvalue=True, offvalue=False, variable=self.logs_visible_var, command=self.toggle_logs) 
        self.view_menu.add_checkbutton(label="Show Device Tools", onvalue=True, offvalue=False, variable=self.device_tools_visible_var, command=self.toggle_device_tools)


        # Actions Menu
        self.actions_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Actions", menu=self.actions_menu)
        self.actions_menu.add_command(label="Download Selected", command=self.download_selected_files_gui, state=tk.DISABLED)
        self.actions_menu.add_command(label="Play Selected", command=self.play_selected_audio_gui, state=tk.DISABLED)
        self.actions_menu.add_command(label="Delete Selected", command=self.delete_selected_files_gui, state=tk.DISABLED)
        self.actions_menu.add_separator()
        self.actions_menu.add_command(label="Select All", command=self.select_all_files_action, state=tk.DISABLED, accelerator="Ctrl+A")
        self.actions_menu.add_command(label="Clear Selection", command=self.clear_selection_action, state=tk.DISABLED)
        
        # Device Menu (for device-specific tools)
        self.device_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Device", menu=self.device_menu)
        self.device_menu.add_command(label="Sync Device Time", command=self.sync_device_time_gui, state=tk.DISABLED)
        self.device_menu.add_command(label="Format Storage", command=self.format_sd_card_gui, state=tk.DISABLED)

    def _create_toolbar(self):
        self.toolbar_frame = ttk.Frame(self.master, padding=(2,2,2,0)) # Add a little padding
        # In a real scenario, you would load icons here e.g. using Pillow's ImageTk.PhotoImage
        # Example: self.connect_icon = ImageTk.PhotoImage(Image.open("connect_icon.png"))
        # Then use image=self.connect_icon in the button. For now, text only.

        # Connect/Disconnect Button (toggles)
        self.toolbar_connect_button = ttk.Button(self.toolbar_frame, text="Connect", command=self.connect_device, width=10)
        self.toolbar_connect_button.pack(side=tk.LEFT, padx=(0, 2))

        # Refresh Button
        self.toolbar_refresh_button = ttk.Button(self.toolbar_frame, text="Refresh", command=self.refresh_file_list_gui)
        self.toolbar_refresh_button.pack(side=tk.LEFT, padx=2)
        
        # Separator
        #ttk.Separator(self.toolbar_frame, orient=tk.VERTICAL).pack(side=tk.LEFT, fill=tk.Y, padx=5, pady=2)

        # Download Button
        self.toolbar_download_button = ttk.Button(self.toolbar_frame, text="Download", command=self.download_selected_files_gui)
        self.toolbar_download_button.pack(side=tk.LEFT, padx=2)

        # Play Button
        # Initial configuration, will be updated by _update_menu_states
        self.toolbar_play_button = ttk.Button(self.toolbar_frame, text="Play", command=self.play_selected_audio_gui)
        self.toolbar_play_button.pack(side=tk.LEFT, padx=2)

        # (If using icons, you would ensure 'stop_icon_img' is loaded and stored here or in __init__)
        # self.toolbar_icons['stop_icon_img'] = self._load_icon("stop", "Stop") 

        # Delete Button
        self.toolbar_delete_button = ttk.Button(self.toolbar_frame, text="Delete", command=self.delete_selected_files_gui)
        self.toolbar_delete_button.pack(side=tk.LEFT, padx=2)
        
        # Separator (optional, if more buttons were to follow on the right)
        #ttk.Separator(self.toolbar_frame, orient=tk.VERTICAL).pack(side=tk.LEFT, fill=tk.Y, padx=5, pady=2)

        # Settings Button (on the right)
        self.toolbar_settings_button = ttk.Button(self.toolbar_frame, text="Settings", command=self.open_settings_window)
        self.toolbar_settings_button.pack(side=tk.RIGHT, padx=2) # Pack to the right

        self.toolbar_frame.pack(side=tk.TOP, fill=tk.X, pady=(0,2))


    def _create_status_bar(self):
        self.status_bar_frame = ttk.Frame(self.master, relief=tk.SUNKEN, padding=2)
        self.status_bar_frame.pack(side=tk.BOTTOM, fill=tk.X)

        self.status_connection_label = ttk.Label(self.status_bar_frame, text="Status: Disconnected", anchor=tk.W)
        self.status_connection_label.pack(side=tk.LEFT, padx=5)

        self.status_storage_label = ttk.Label(self.status_bar_frame, text="Storage: ---", anchor=tk.W)
        self.status_storage_label.pack(side=tk.LEFT, padx=10)
        
        self.status_file_counts_label = ttk.Label(self.status_bar_frame, text="Files: 0 total / 0 selected", anchor=tk.W)
        self.status_file_counts_label.pack(side=tk.LEFT, padx=10)

        # Progress bar and its label will be part of the status bar now
        self.status_progress_text_label = ttk.Label(self.status_bar_frame, text="", anchor=tk.W, width=40) # For text like "Downloading..."
        self.status_progress_text_label.pack(side=tk.LEFT, padx=10, fill=tk.X, expand=True)
        
        self.status_file_progress_bar = ttk.Progressbar(self.status_bar_frame, orient=tk.HORIZONTAL, length=150, mode='determinate')
        self.status_file_progress_bar.pack(side=tk.LEFT, padx=5)
        
        self.status_download_dir_label = ttk.Label(self.status_bar_frame, text=f"Dir: {os.path.basename(self.download_directory)}", anchor=tk.E, relief=tk.FLAT)
        self.status_download_dir_label.pack(side=tk.RIGHT, padx=5)
        self.status_download_dir_label.bind("<Button-1>", self._open_download_dir_in_explorer)

    def _open_download_dir_in_explorer(self, event=None): # Added event=None for direct binding
        if not self.download_directory or not os.path.isdir(self.download_directory):
            messagebox.showwarning("Open Directory", 
                                    f"Download directory is not set or does not exist:\n{self.download_directory}",
                                    parent=self.master)
            logger.warning("GUI", "_open_download_dir_in_explorer",
                            f"Download directory '{self.download_directory}' not valid or not set.")
            return

        try:
            logger.info("GUI", "_open_download_dir_in_explorer", f"Opening download directory: {self.download_directory}")
            if sys.platform == "win32":
                os.startfile(os.path.realpath(self.download_directory)) # os.realpath for robustness
            elif sys.platform == "darwin": # macOS
                subprocess.call(["open", self.download_directory])
            else: # Linux and other UNIX-like systems (e.g., BSD)
                subprocess.call(["xdg-open", self.download_directory])
        except FileNotFoundError: 
            # This might happen if xdg-open is not installed on a Linux system, for example.
            messagebox.showerror("Open Directory", 
                                f"Could not open directory. Associated command not found for your system ('{sys.platform}').",
                                parent=self.master)
            logger.error("GUI", "_open_download_dir_in_explorer", f"File explorer command not found for {sys.platform}.")
        except Exception as e:
            messagebox.showerror("Open Directory",
                                f"Failed to open directory:\n{self.download_directory}\nError: {e}",
                                parent=self.master)
            logger.error("GUI", "_open_download_dir_in_explorer",
                        f"Failed to open directory '{self.download_directory}': {e}")

    def update_status_bar(self, connection_status=None, storage_info=None, file_counts_info=None, progress_text=None, download_dir=None):
        if hasattr(self, 'status_connection_label') and self.status_connection_label.winfo_exists():
            if connection_status is not None: self.status_connection_label.config(text=connection_status)
        if hasattr(self, 'status_storage_label') and self.status_storage_label.winfo_exists():
            if storage_info is not None: self.status_storage_label.config(text=storage_info)
        if hasattr(self, 'status_file_counts_label') and self.status_file_counts_label.winfo_exists():
            if file_counts_info is not None: self.status_file_counts_label.config(text=file_counts_info)
        if hasattr(self, 'status_progress_text_label') and self.status_progress_text_label.winfo_exists():
            if progress_text is not None: self.status_progress_text_label.config(text=progress_text)
        if hasattr(self, 'status_download_dir_label') and self.status_download_dir_label.winfo_exists():
            if download_dir is not None: self.status_download_dir_label.config(text=f"Dir: {os.path.basename(download_dir)}")


    def update_all_status_info(self):
        """Updates all parts of the status bar based on current app state."""
        conn_status_text = "Status: Disconnected"
        if self.dock.is_connected():
            conn_status_text = f"Status: Connected ({self.dock.model or 'HiDock'})"
            if self.dock.device_info and self.dock.device_info.get('sn'):
                 conn_status_text += f" SN: {self.dock.device_info['sn']}"
        elif not self.backend_initialized_successfully:
            conn_status_text = "Status: USB Backend FAILED!"
        
        storage_text = "Storage: ---"
        if self.dock.is_connected():
            card_info = self.dock.device_info.get("_cached_card_info") 
            if card_info: 
                used_mb = card_info['used']
                capacity_mb = card_info['capacity']
                unit = "MB"
                if capacity_mb > 1024:
                    used_mb /= 1024; capacity_mb /= 1024; unit = "GB"
                storage_text = f"Storage: {used_mb:.2f}/{capacity_mb:.2f} {unit} (Status: {hex(card_info['status_raw'])})"
            else:
                storage_text = "Storage: Fetching..." 

        total_items = len(self.file_tree.get_children()) if hasattr(self, 'file_tree') and self.file_tree.winfo_exists() else 0
        selected_items_count = len(self.file_tree.selection()) if hasattr(self, 'file_tree') and self.file_tree.winfo_exists() else 0
        size_selected_bytes = 0
        if selected_items_count > 0 and hasattr(self, 'file_tree') and self.file_tree.winfo_exists():
             for item_iid in self.file_tree.selection():
                file_detail = next((f for f in self.displayed_files_details if f['name'] == item_iid), None)
                if file_detail: size_selected_bytes += file_detail.get('length', 0)
        
        file_counts_text = f"Files: {total_items} total / {selected_items_count} selected ({size_selected_bytes / (1024*1024):.2f} MB)"

        self.update_status_bar(
            connection_status=conn_status_text,
            storage_info=storage_text,
            file_counts_info=file_counts_text,
            download_dir=self.download_directory
        )

    def _update_menu_states(self): # Now also updates toolbar button states
        """Updates the state (enabled/disabled) of menu items and toolbar buttons based on app state."""
        is_connected = self.dock.is_connected()
        has_selection = bool(hasattr(self, 'file_tree') and self.file_tree.winfo_exists() and self.file_tree.selection())
        num_selected = len(self.file_tree.selection()) if has_selection else 0

        # Menu states
        if hasattr(self, 'file_menu'):
            self.file_menu.entryconfig("Connect to HiDock", state=tk.NORMAL if not is_connected and self.backend_initialized_successfully else tk.DISABLED)
            self.file_menu.entryconfig("Disconnect", state=tk.NORMAL if is_connected else tk.DISABLED)

        if hasattr(self, 'view_menu'):
            self.view_menu.entryconfig("Refresh File List", state=tk.NORMAL if is_connected else tk.DISABLED)
            self.view_menu.entryconfig("Show Logs", variable=self.logs_visible_var) 
            self.view_menu.entryconfig("Show Device Tools", variable=self.device_tools_visible_var)

        can_play_selected = is_connected and num_selected == 1
        if can_play_selected: # Further check if the selected file is playable
            file_iid = self.file_tree.selection()[0]
            file_detail = next((f for f in self.displayed_files_details if f['name'] == file_iid), None)
            if not (file_detail and (file_detail['name'].lower().endswith(".wav") or file_detail['name'].lower().endswith(".hda"))):
                can_play_selected = False
        
        if hasattr(self, 'actions_menu'):
            self.actions_menu.entryconfig("Download Selected", state=tk.NORMAL if is_connected and has_selection else tk.DISABLED)
            self.actions_menu.entryconfig("Play Selected", state=tk.NORMAL if can_play_selected else tk.DISABLED)
            self.actions_menu.entryconfig("Delete Selected", state=tk.NORMAL if is_connected and has_selection else tk.DISABLED)
            
            can_select_all = (hasattr(self, 'file_tree') and self.file_tree.winfo_exists() and 
                              len(self.file_tree.get_children()) > 0 and 
                              num_selected < len(self.file_tree.get_children()))
            self.actions_menu.entryconfig("Select All", state=tk.NORMAL if can_select_all else tk.DISABLED)
            self.actions_menu.entryconfig("Clear Selection", state=tk.NORMAL if has_selection else tk.DISABLED)

        if hasattr(self, 'device_menu'):
            self.device_menu.entryconfig("Sync Device Time", state=tk.NORMAL if is_connected else tk.DISABLED)
            self.device_menu.entryconfig("Format Storage", state=tk.NORMAL if is_connected else tk.DISABLED)

        # Toolbar button states
        if hasattr(self, 'toolbar_connect_button'):
            # This button's logic is for connection state, not generic long operations
            if is_connected:
                self.toolbar_connect_button.config(text="Disconnect", command=self.disconnect_device, state=tk.NORMAL)
            else:
                self.toolbar_connect_button.config(text="Connect", command=self.connect_device, 
                                                   state=tk.NORMAL if self.backend_initialized_successfully else tk.DISABLED)
        
        if hasattr(self, 'toolbar_refresh_button'):
            # Refresh button is disabled during its own operation or any other long operation.
            # It does not currently have a 'Cancel' state.
            self.toolbar_refresh_button.config(state=tk.NORMAL if is_connected and not self._is_ui_refresh_in_progress and not self.is_long_operation_active else tk.DISABLED)
        
        if hasattr(self, 'toolbar_download_button'):
            if self.is_long_operation_active and self.active_operation_name == "Download Queue":
                self.toolbar_download_button.config(
                    text="Cancel DL",
                    command=self.request_cancel_operation,
                    state=tk.NORMAL)
            else:
                self.toolbar_download_button.config(
                    text="Download",
                    command=self.download_selected_files_gui,
                    state=tk.NORMAL if is_connected and has_selection and not self.is_long_operation_active and not self.is_audio_playing else tk.DISABLED)

        if hasattr(self, 'toolbar_play_button'):
            if self.is_audio_playing:
                # State 1: Audio is currently playing
                self.toolbar_play_button.config(
                    text="Stop",
                    command=self._stop_audio_playback,
                    state=tk.NORMAL)
            elif self.is_long_operation_active and self.active_operation_name == "Playback Preparation":
                # State 2: Audio not playing, but we are preparing (e.g., downloading for playback)
                self.toolbar_play_button.config(
                    text="Cancel Prep", 
                    command=self.request_cancel_operation,
                    state=tk.NORMAL 
                )
            else:
                # State 3: Default "Play" state (audio not playing, not preparing for playback)
                self.toolbar_play_button.config(
                    text="Play",
                    command=self.play_selected_audio_gui,
                    state=tk.NORMAL if can_play_selected and not self.is_long_operation_active else tk.DISABLED)

        if hasattr(self, 'toolbar_delete_button'):
            if self.is_long_operation_active and self.active_operation_name == "Deletion":
                self.toolbar_delete_button.config(
                    text="Cancel Del.",
                    command=self.request_cancel_operation,
                    state=tk.NORMAL)
            else:
                self.toolbar_delete_button.config(
                    text="Delete",
                    command=self.delete_selected_files_gui,
                    state=tk.NORMAL if is_connected and has_selection and not self.is_long_operation_active and not self.is_audio_playing else tk.DISABLED)
        
        if hasattr(self, 'toolbar_settings_button'):
            self.toolbar_settings_button.config(state=tk.NORMAL) # Settings always available

    def apply_theme(self, theme_name):
        theme_name_from_config_or_selection = theme_name
        try:
            style = ttk.Style(self.master)
            azure_variant_to_set = "light" 

            if theme_name_from_config_or_selection == "azure":
                script_dir = os.path.dirname(os.path.abspath(__file__))
                azure_tcl_path = os.path.join(script_dir, "themes", "azure", "azure.tcl")

                if os.path.exists(azure_tcl_path):
                    try:
                        self.master.tk.call("source", azure_tcl_path)
                        self.master.tk.call("set_theme", azure_variant_to_set)
                        logger.info("GUI", "apply_theme", f"Azure theme ('{azure_variant_to_set}' variant) sourced and applied.")
                        return 
                    except tk.TclError as e:
                        logger.error("GUI", "apply_theme", f"TclError sourcing/using Azure theme from {azure_tcl_path}: {e}")
                else:
                    logger.warning("GUI", "apply_theme", f"Azure theme file not found at {azure_tcl_path}. Falling back.")
            
            available_themes = style.theme_names()
            if theme_name_from_config_or_selection in available_themes:
                style.theme_use(theme_name_from_config_or_selection)
                logger.info("GUI", "apply_theme", f"Theme set to '{theme_name_from_config_or_selection}'.")
            else:
                fallback_theme_to_try = "vista" 
                if fallback_theme_to_try not in available_themes: fallback_theme_to_try = "clam" 
                if fallback_theme_to_try not in available_themes: fallback_theme_to_try = "default"

                if fallback_theme_to_try in available_themes:
                    style.theme_use(fallback_theme_to_try)
                    logger.warning("GUI", "apply_theme", f"Theme '{theme_name_from_config_or_selection}' not available. Fell back to '{fallback_theme_to_try}'.")
                    if self.theme_var.get() == "azure" and theme_name_from_config_or_selection == "azure":
                        self.theme_var.set(fallback_theme_to_try)
                        self.config["theme"] = fallback_theme_to_try 
                else:
                    logger.error("GUI", "apply_theme", f"Critical: Even fallback theme '{fallback_theme_to_try}' not available.")
        except Exception as e: 
            logger.error("GUI", "apply_theme", f"Generic error applying theme '{theme_name_from_config_or_selection}': {e}\n{traceback.format_exc()}")

    def create_widgets(self):
        self._create_menubar() 
        self._create_toolbar() # ADDED: Create toolbar here
        self._create_status_bar() 

        main_content_frame = ttk.Frame(self.master, padding="5")
        main_content_frame.pack(fill=tk.BOTH, expand=True)

        files_frame = ttk.LabelFrame(main_content_frame, text="📄 Available Files", padding="10")
        files_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        tree_frame = ttk.Frame(files_frame)
        tree_frame.pack(fill=tk.BOTH, expand=True)

        columns = ("name", "size", "duration", "date", "time", "status")
        self.file_tree = ttk.Treeview(tree_frame, columns=columns, show="headings", selectmode="extended")

        # Apply saved column display order
        if self.treeview_columns_display_order_str:
            loaded_column_order = self.treeview_columns_display_order_str.split(',')
            # Validate against actual columns to prevent errors if config is stale
            valid_loaded_order = [c for c in loaded_column_order if c in columns]
            if len(valid_loaded_order) == len(columns) and set(valid_loaded_order) == set(columns):
                try:
                    self.file_tree["displaycolumns"] = valid_loaded_order
                    logger.info("GUI", "create_widgets", f"Applied saved column order: {valid_loaded_order}")
                except tk.TclError as e:
                    logger.warning("GUI", "create_widgets", f"Failed to apply saved column order '{valid_loaded_order}': {e}. Using default.")
                    self.file_tree["displaycolumns"] = columns # Fallback to default
            else:
                logger.warning("GUI", "create_widgets", "Saved column order mismatch or invalid. Using default.")
                self.file_tree["displaycolumns"] = columns # Fallback
        else: # No saved order, use default
             self.file_tree["displaycolumns"] = columns
        
        for col, text in self.original_tree_headings.items():
            is_numeric = col in ["size", "duration"]
            self.file_tree.heading(col, text=text, command=lambda c=col, n=is_numeric: self.sort_treeview_column(c, n))
            if col == "name": self.file_tree.column(col, width=250, minwidth=150, stretch=tk.YES)
            elif col in ["size", "duration"]: self.file_tree.column(col, width=80, minwidth=60, anchor=tk.E)
            elif col in ["date", "time"]: self.file_tree.column(col, width=100, minwidth=80, anchor=tk.CENTER)
            else: self.file_tree.column(col, width=100, minwidth=80, anchor=tk.W) # status

        self.file_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar = ttk.Scrollbar(tree_frame, orient=tk.VERTICAL, command=self.file_tree.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        self.file_tree.tag_configure('downloaded', foreground='blue')
        self.file_tree.tag_configure('recording', foreground='red', font=('TkDefaultFont', 9, 'bold'))
        self.file_tree.tag_configure('size_mismatch', foreground='red')
        self.file_tree.tag_configure('downloaded_ok', foreground='green')
        self.file_tree.tag_configure('downloading', foreground='dark orange')
        self.file_tree.tag_configure('queued', foreground='gray50')
        self.file_tree.tag_configure('cancelled', foreground='firebrick3')
        self.file_tree.tag_configure('playing', foreground='purple')

        self.file_tree.config(yscrollcommand=scrollbar.set)
        self.file_tree.bind("<<TreeviewSelect>>", self.on_file_selection_change)
        self.file_tree.bind("<Double-1>", self._on_file_double_click)
        self.file_tree.bind("<Button-3>", self._on_file_right_click)
        self.file_tree.bind("<Control-a>", lambda event: self.select_all_files_action())
        self.file_tree.bind("<Control-A>", lambda event: self.select_all_files_action())
        self.file_tree.bind("<Delete>", self._on_delete_key_press)
        self.file_tree.bind("<Return>", self._on_enter_key_press)
        
        self.optional_sections_pane = ttk.PanedWindow(main_content_frame, orient=tk.VERTICAL)
        # Packed by _update_optional_panes_visibility if needed

        self.log_frame = ttk.LabelFrame(self.optional_sections_pane, text="Logs", padding="10")
        log_controls_sub_frame = ttk.Frame(self.log_frame)
        log_controls_sub_frame.pack(fill=tk.X, pady=(0, 5))
        self.clear_log_button = ttk.Button(log_controls_sub_frame, text="Clear Log", command=self.clear_log_gui)
        self.clear_log_button.pack(side=tk.LEFT, padx=(0, 10))
        ttk.Label(log_controls_sub_frame, text="Log Level:").pack(side=tk.LEFT, padx=(0, 5))
        self.log_section_level_combo = ttk.Combobox(log_controls_sub_frame, textvariable=self.gui_log_filter_level_var, values=list(Logger.LEVELS.keys()), state="readonly", width=10)
        self.log_section_level_combo.pack(side=tk.LEFT)
        self.log_section_level_combo.bind("<<ComboboxSelected>>", self.on_gui_log_filter_change)
        self.download_logs_button = ttk.Button(log_controls_sub_frame, text="Download Logs", command=self.download_gui_logs)
        self.download_logs_button.pack(side=tk.LEFT, padx=(10,0))
        self.log_text_area = tk.Text(self.log_frame, height=8, state='disabled', wrap=tk.WORD) 
        log_scrollbar_y = ttk.Scrollbar(self.log_frame, orient=tk.VERTICAL, command=self.log_text_area.yview)
        self.log_text_area.config(yscrollcommand=log_scrollbar_y.set)
        log_scrollbar_y.pack(side=tk.RIGHT, fill=tk.Y)
        self.log_text_area.pack(fill=tk.BOTH, expand=True)
        for tag, color in [("ERROR", "#FFC0CB"), ("WARNING", "#FFFFE0"), ("INFO", "white"), ("DEBUG", "#E0FFFF"), ("CRITICAL", "#FF6347")]:
            fg = "white" if tag == "CRITICAL" else "black"
            self.log_text_area.tag_configure(tag, background=color, foreground=fg)

        self.device_tools_frame = ttk.LabelFrame(self.optional_sections_pane, text="🛠️ Device Tools", padding="5")
        ttk.Label(self.device_tools_frame, text="Device tools (Format, Sync Time) are now in the 'Device' menu.").pack(padx=5, pady=5)

        self._update_menu_states() # This will now also update toolbar button states
        # If backend init failed earlier, explicitly disable connect button again, as _update_menu_states might re-enable it
        # This is now handled within _update_menu_states and the __init__ for the toolbar button
        if not self.backend_initialized_successfully and hasattr(self, 'toolbar_connect_button'):
            self.toolbar_connect_button.config(state=tk.DISABLED)

    def _update_optional_panes_visibility(self):
        if not hasattr(self, 'optional_sections_pane') or not self.optional_sections_pane.winfo_exists():
            logger.error("GUI", "_update_optional_panes_visibility", "optional_sections_pane does not exist.")
            return

        # Get current managed child widgets of the paned window
        current_managed_children = []
        try:
            for pane_path in self.optional_sections_pane.panes():
                try:
                    current_managed_children.append(self.optional_sections_pane.nametowidget(pane_path))
                except tk.TclError:
                    pass # Widget path might be stale
        except tk.TclError: # Panes might be empty
            pass

        # --- Manage Log Frame ---
        log_frame_should_be_visible = self.logs_visible_var.get()
        log_frame_is_currently_managed = self.log_frame in current_managed_children

        if log_frame_should_be_visible and not log_frame_is_currently_managed:
            try:
                # If device_tools_frame is also going to be visible and is already managed, add log_frame before it.
                if self.device_tools_visible_var.get() and self.device_tools_frame in current_managed_children:
                     self.optional_sections_pane.insert(self.device_tools_frame, self.log_frame, weight=1)
                else: # Add at the end or as the only one
                    self.optional_sections_pane.add(self.log_frame, weight=1)
                current_managed_children.append(self.log_frame) # Reflect change
            except tk.TclError as e:
                logger.warning("GUI", "_update_optional_panes_visibility", f"Error adding log_frame: {e}")
        elif not log_frame_should_be_visible and log_frame_is_currently_managed:
            try:
                self.optional_sections_pane.forget(self.log_frame)
                if self.log_frame in current_managed_children: current_managed_children.remove(self.log_frame) # Reflect
            except tk.TclError as e:
                logger.warning("GUI", "_update_optional_panes_visibility", f"Error forgetting log_frame: {e}")

        # --- Manage Device Tools Frame ---
        # Re-check current_managed_children as it might have changed
        current_managed_children = []
        try:
            for pane_path in self.optional_sections_pane.panes():
                try: current_managed_children.append(self.optional_sections_pane.nametowidget(pane_path))
                except tk.TclError: pass
        except tk.TclError: pass

        device_tools_frame_should_be_visible = self.device_tools_visible_var.get()
        device_tools_frame_is_currently_managed = self.device_tools_frame in current_managed_children

        if device_tools_frame_should_be_visible and not device_tools_frame_is_currently_managed:
            try:
                self.optional_sections_pane.add(self.device_tools_frame, weight=1) # Adds at the end
                current_managed_children.append(self.device_tools_frame) # Reflect
            except tk.TclError as e:
                logger.warning("GUI", "_update_optional_panes_visibility", f"Error adding device_tools_frame: {e}")
        elif not device_tools_frame_should_be_visible and device_tools_frame_is_currently_managed:
            try:
                self.optional_sections_pane.forget(self.device_tools_frame)
                if self.device_tools_frame in current_managed_children: current_managed_children.remove(self.device_tools_frame) # Reflect
            except tk.TclError as e:
                logger.warning("GUI", "_update_optional_panes_visibility", f"Error forgetting device_tools_frame: {e}")

        # --- Manage visibility of the PanedWindow itself ---
        any_pane_content_intended_to_be_visible = self.logs_visible_var.get() or self.device_tools_visible_var.get()

        if any_pane_content_intended_to_be_visible:
            if not self.optional_sections_pane.winfo_ismapped():
                # Pack it into its correct parent, which is main_content_frame
                self.optional_sections_pane.pack(fill=tk.BOTH, expand=True, pady=(5,0)) # before=self.status_bar_frame is wrong here
        else:
            if self.optional_sections_pane.winfo_ismapped():
                self.optional_sections_pane.pack_forget()

    def toggle_logs(self):
        # self.logs_visible is the internal state, self.logs_visible_var is for the menu
        self.logs_visible = self.logs_visible_var.get() # Sync internal state from menu var
        self._update_optional_panes_visibility()


    def toggle_device_tools(self):
        self.device_tools_visible = self.device_tools_visible_var.get() # Sync internal state
        self._update_optional_panes_visibility()


    def open_settings_window(self):
        settings_win = tk.Toplevel(self.master)
        settings_win.title("Application Settings")
        settings_win.transient(self.master) 
        settings_win.grab_set() 

        main_content_frame = ttk.Frame(settings_win, padding="10")
        main_content_frame.pack(fill=tk.BOTH, expand=True)

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
            "theme": self.theme_var.get(),
            "suppress_console_output": self.suppress_console_output_var.get()
        }
        
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
        
        initial_download_directory = self.download_directory 
        settings_changed_tracker = [False] 
        current_dialog_download_dir = [self.download_directory] 

        notebook = ttk.Notebook(main_content_frame)
        buttons_frame = ttk.Frame(main_content_frame) 
        action_buttons_subframe = ttk.Frame(buttons_frame)
        
        ok_button = ttk.Button(action_buttons_subframe, text="OK")
        apply_button = ttk.Button(action_buttons_subframe, text="Apply", state=tk.DISABLED)
        cancel_close_button = ttk.Button(action_buttons_subframe, text="Close")

        def _update_button_states_on_change(*args): 
            if settings_win.winfo_exists():
                if not settings_changed_tracker[0]: 
                    settings_changed_tracker[0] = True
                    if apply_button.winfo_exists(): apply_button.config(state=tk.NORMAL)
                    if cancel_close_button.winfo_exists(): cancel_close_button.config(text="Cancel")
            
        tab_general = ttk.Frame(notebook, padding="10")
        tab_connection = ttk.Frame(notebook, padding="10")
        tab_operation = ttk.Frame(notebook, padding="10")
        tab_device_specific = ttk.Frame(notebook, padding="10")

        notebook.add(tab_general, text=" General ")
        notebook.add(tab_connection, text=" Connection ")
        notebook.add(tab_operation, text=" Operation ")
        notebook.add(tab_device_specific, text=" Device Specific ")
        notebook.pack(expand=True, fill="both", pady=(0, 10))

        # --- Populate Tab 1: General ---
        appearance_settings_frame = ttk.LabelFrame(tab_general, text="Appearance", padding="5")
        appearance_settings_frame.pack(fill=tk.X, pady=5, anchor=tk.N)
        ttk.Label(appearance_settings_frame, text="Application Theme:").pack(anchor=tk.W, pady=(5,0))
        try: system_themes = list(ttk.Style().theme_names())
        except tk.TclError: system_themes = ["default", "clam", "alt", "vista", "xpnative"]
        all_selectable_themes = set(system_themes)
        script_dir = os.path.dirname(os.path.abspath(__file__))
        azure_tcl_path = os.path.join(script_dir, "themes", "azure", "azure.tcl")
        if os.path.exists(azure_tcl_path): all_selectable_themes.add("azure")
        sorted_selectable_themes = sorted(list(all_selectable_themes))
        theme_combo = ttk.Combobox(appearance_settings_frame, textvariable=self.theme_var, values=sorted_selectable_themes, state="readonly")
        theme_combo.pack(fill=tk.X, pady=2)

        log_settings_frame = ttk.LabelFrame(tab_general, text="Logging", padding="5")
        log_settings_frame.pack(fill=tk.X, pady=5, anchor=tk.N)
        ttk.Label(log_settings_frame, text="Logger Processing Level:").pack(anchor=tk.W, pady=(5,0))
        log_level_combo = ttk.Combobox(log_settings_frame, textvariable=self.logger_processing_level_var, values=list(Logger.LEVELS.keys()), state="readonly")
        log_level_combo.pack(fill=tk.X, pady=2)
        suppress_console_check = ttk.Checkbutton(log_settings_frame, text="Suppress console output (logs still go to GUI)", variable=self.suppress_console_output_var)
        suppress_console_check.pack(anchor=tk.W, pady=(5,0))
        
        quit_prompt_frame = ttk.LabelFrame(tab_general, text="Application Exit", padding="5")
        quit_prompt_frame.pack(fill=tk.X, pady=5, anchor=tk.N)
        quit_checkbutton = ttk.Checkbutton(quit_prompt_frame, text="Quit without confirmation if device is connected", variable=self.quit_without_prompt_var)
        quit_checkbutton.pack(anchor=tk.W, pady=(5,0))

        download_settings_frame = ttk.LabelFrame(tab_general, text="Download Settings", padding="5")
        download_settings_frame.pack(fill=tk.X, pady=5, anchor=tk.N)
        dir_buttons_frame = ttk.Frame(download_settings_frame)
        dir_buttons_frame.pack(fill=tk.X, pady=(0,5))
        current_dl_dir_label_settings = ttk.Label(download_settings_frame, text=self.download_directory, relief="sunken", padding=2, wraplength=380)
        current_dl_dir_label_settings.pack(fill=tk.X, pady=2, side=tk.TOP)
        select_dir_button_settings = ttk.Button(dir_buttons_frame, text="Select Download Directory...", command=lambda: self._select_download_dir_for_settings_dialog(current_dl_dir_label_settings, current_dialog_download_dir, settings_changed_tracker, apply_button, cancel_close_button))
        select_dir_button_settings.pack(side=tk.LEFT, pady=(5,0))
        reset_dir_button = ttk.Button(dir_buttons_frame, text="Reset to App Folder", command=lambda: self._reset_download_dir_for_settings(current_dl_dir_label_settings, current_dialog_download_dir, settings_changed_tracker, apply_button, cancel_close_button))
        reset_dir_button.pack(side=tk.LEFT, padx=5, pady=(5,0))

        # --- Populate Tab 2: Connection ---
        device_selection_frame = ttk.LabelFrame(tab_connection, text="USB Device Selection", padding="5")
        device_selection_frame.pack(fill=tk.X, pady=5, anchor=tk.N)
        self.settings_device_combobox = ttk.Combobox(device_selection_frame, state="readonly", width=50)
        self.settings_device_combobox.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0,5))
        scan_button = ttk.Button(device_selection_frame, text="Scan", command=lambda: self.scan_usb_devices_for_settings(settings_win, change_callback=_update_button_states_on_change))
        scan_button.pack(side=tk.LEFT, padx=5)
        self.scan_usb_devices_for_settings(settings_win, initial_load=True, change_callback=_update_button_states_on_change) # Pass callback
        self.settings_device_combobox.bind("<<ComboboxSelected>>", lambda e: on_device_selected(settings_changed_tracker, apply_button, cancel_close_button)) 

        autoconnect_checkbutton = ttk.Checkbutton(tab_connection, text="Autoconnect on startup", variable=self.autoconnect_var)
        autoconnect_checkbutton.pack(pady=10, anchor=tk.W)
        ttk.Label(tab_connection, text="Target USB Interface Number:").pack(anchor=tk.W, pady=(5,0))
        target_interface_spinbox = ttk.Spinbox(tab_connection, from_=0, to=10, textvariable=self.target_interface_var, width=5)
        target_interface_spinbox.pack(anchor=tk.W, pady=2)
        
        # --- Populate Tab 3: Operation ---
        operational_settings_frame = ttk.LabelFrame(tab_operation, text="Timings & Auto-Refresh", padding="5")
        operational_settings_frame.pack(fill=tk.X, pady=5, anchor=tk.N)
        ttk.Label(operational_settings_frame, text="Recording Status Check Interval (seconds):").pack(anchor=tk.W, pady=(5,0))
        recording_interval_spinbox = ttk.Spinbox(operational_settings_frame, from_=0, to=60, textvariable=self.recording_check_interval_var, width=5) 
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

        # --- Populate Tab 4: Device Specific ---
        device_behavior_frame = ttk.LabelFrame(tab_device_specific, text="Device Behavior Settings (Requires Connection)", padding="5")
        device_behavior_frame.pack(fill=tk.X, pady=5, anchor=tk.N)
        self.auto_record_checkbox = ttk.Checkbutton(device_behavior_frame, text="Auto Record on Power On", variable=self.device_setting_auto_record_var, state=tk.DISABLED)
        self.auto_record_checkbox.pack(anchor=tk.W)
        self.auto_play_checkbox = ttk.Checkbutton(device_behavior_frame, text="Auto Play on Insert (if applicable)", variable=self.device_setting_auto_play_var, state=tk.DISABLED)
        self.auto_play_checkbox.pack(anchor=tk.W)
        self.bt_tone_checkbox = ttk.Checkbutton(device_behavior_frame, text="Bluetooth Connection Tones", variable=self.device_setting_bluetooth_tone_var, state=tk.DISABLED)
        self.bt_tone_checkbox.pack(anchor=tk.W)
        self.notification_sound_checkbox = ttk.Checkbutton(device_behavior_frame, text="Notification Sounds", variable=self.device_setting_notification_sound_var, state=tk.DISABLED)
        self.notification_sound_checkbox.pack(anchor=tk.W)

        if self.dock.is_connected():
            def _after_device_settings_loaded_hook_settings():
                if not _check_if_settings_actually_changed_settings(): 
                    settings_changed_tracker[0] = False
                    if apply_button.winfo_exists(): apply_button.config(state=tk.DISABLED)
                    if cancel_close_button.winfo_exists(): cancel_close_button.config(text="Close")
            threading.Thread(target=self._load_device_settings_for_dialog, args=(settings_win, _after_device_settings_loaded_hook_settings), daemon=True).start()
        else:
            settings_changed_tracker[0] = False
            if apply_button.winfo_exists(): apply_button.config(state=tk.DISABLED)
            if cancel_close_button.winfo_exists(): cancel_close_button.config(text="Close")
        
        vars_to_trace = [self.autoconnect_var, self.logger_processing_level_var, self.selected_vid_var, self.selected_pid_var,
                         self.target_interface_var, self.recording_check_interval_var, self.default_command_timeout_ms_var,
                         self.file_stream_timeout_s_var, self.auto_refresh_files_var, self.auto_refresh_interval_s_var,
                         self.quit_without_prompt_var, self.theme_var, self.suppress_console_output_var,
                         self.device_setting_auto_record_var, self.device_setting_auto_play_var,
                         self.device_setting_bluetooth_tone_var, self.device_setting_notification_sound_var]
        for var_to_trace in vars_to_trace:
            var_to_trace.trace_add('write', _update_button_states_on_change)

        def on_device_selected(change_tracker_ref, apply_btn_ref, cancel_btn_ref, event=None):
            if not self.settings_device_combobox or not self.settings_device_combobox.winfo_exists(): return
            selection = self.settings_device_combobox.get()
            if not selection or selection == "--- Devices with Issues ---": return
            selected_device_info = next((dev for dev in self.available_usb_devices if dev[0] == selection), None)
            if selected_device_info:
                _, vid, pid = selected_device_info
                # Only update if different, to avoid unnecessary trace fires if re-selecting same
                if self.selected_vid_var.get() != vid: self.selected_vid_var.set(vid)
                if self.selected_pid_var.get() != pid: self.selected_pid_var.set(pid)
                logger.debug("Settings", "on_device_selected", f"Selected device: VID={hex(vid)}, PID={hex(pid)}")
                # Manually trigger change update if needed, as .set() might not if value is same
                _update_button_states_on_change() 
            else:
                logger.warning("Settings", "on_device_selected", f"Could not find details for: '{selection}'")


        def _check_if_settings_actually_changed_settings(): # Renamed for clarity within this scope
            for key, initial_val in initial_config_vars.items():
                # Handle tk.var attributes directly (like device_setting_auto_record_var)
                if hasattr(self, key) and isinstance(getattr(self, key), tk.Variable):
                    if getattr(self, key).get() != initial_val: return True
                # Handle short config keys (like autoconnect -> autoconnect_var)
                elif hasattr(self, f"{key}_var") and isinstance(getattr(self, f"{key}_var"), tk.Variable):
                     if getattr(self, f"{key}_var").get() != initial_val: return True
            if current_dialog_download_dir[0] != initial_download_directory: return True
            return False

        def _perform_apply_settings_logic(update_dialog_baseline=False):
            nonlocal initial_download_directory 
            for key in initial_config_vars: 
                var_attr_name = key # For full names like "device_setting_auto_record_var"
                if not (hasattr(self, key) and isinstance(getattr(self, key), tk.Variable)):
                    var_attr_name = f"{key}_var" # For short names like "autoconnect"
                
                if hasattr(self, var_attr_name) and isinstance(getattr(self, var_attr_name), tk.Variable):
                    self.config[key] = getattr(self, var_attr_name).get() 
                # Else, it might be a key that doesn't have a direct _var, like download_directory

            self.download_directory = current_dialog_download_dir[0] 
            self.config["download_directory"] = self.download_directory

            if self.dock.is_connected() and self._fetched_device_settings_for_dialog:
                changed_device_settings = {}
                for conceptual_key, snake_case_part in conceptual_device_setting_keys.items():
                    tk_var_attr = getattr(self, f"device_setting_{snake_case_part}_var")
                    fetched_val = self._fetched_device_settings_for_dialog.get(conceptual_key) # Use conceptual key
                    if tk_var_attr.get() != fetched_val:
                        changed_device_settings[conceptual_key] = tk_var_attr.get()
                if changed_device_settings:
                    threading.Thread(target=self._apply_device_settings_thread, args=(changed_device_settings,), daemon=True).start()
            
            save_config(self.config)
            logger.set_level(self.logger_processing_level_var.get())
            logger.update_config({"suppress_console_output": self.suppress_console_output_var.get()})
            self.apply_theme(self.theme_var.get())
            self.update_status_bar(download_dir=self.download_directory) # Update status bar with new dir

            if self.dock.is_connected(): 
                self.start_recording_status_check() 
                self.start_auto_file_refresh_periodic_check() 
            logger.info("GUI", "apply_settings_action", "Settings applied and saved.")

            if update_dialog_baseline:
                for key in initial_config_vars:
                    var_attr_name = key
                    if not (hasattr(self, key) and isinstance(getattr(self, key), tk.Variable)):
                        var_attr_name = f"{key}_var"
                    if hasattr(self, var_attr_name): initial_config_vars[key] = getattr(self, var_attr_name).get()
                initial_download_directory = current_dialog_download_dir[0]
                if self._fetched_device_settings_for_dialog:
                    for conceptual_key, snake_case_part in conceptual_device_setting_keys.items():
                        self._fetched_device_settings_for_dialog[conceptual_key] = getattr(self, f"device_setting_{snake_case_part}_var").get()

        def ok_action():
            if settings_changed_tracker[0]: _perform_apply_settings_logic(update_dialog_baseline=False)
            settings_win.destroy()
        def apply_action_ui_handler():
            if settings_changed_tracker[0]:
                _perform_apply_settings_logic(update_dialog_baseline=True)
                settings_changed_tracker[0] = False 
                if apply_button.winfo_exists(): apply_button.config(state=tk.DISABLED)
                if cancel_close_button.winfo_exists(): cancel_close_button.config(text="Close")
        def cancel_close_action():
            if settings_changed_tracker[0]: 
                for dict_key, initial_val in initial_config_vars.items():
                    tk_var_to_reset = None
                    if hasattr(self, dict_key) and isinstance(getattr(self, dict_key), tk.Variable):
                        tk_var_to_reset = getattr(self, dict_key)
                    elif hasattr(self, f"{dict_key}_var") and isinstance(getattr(self, f"{dict_key}_var"), tk.Variable):
                        tk_var_to_reset = getattr(self, f"{dict_key}_var")
                    if tk_var_to_reset: tk_var_to_reset.set(initial_val)
                current_dialog_download_dir[0] = initial_download_directory
                if current_dl_dir_label_settings.winfo_exists(): current_dl_dir_label_settings.config(text=current_dialog_download_dir[0])
                logger.info("GUI", "cancel_close_action", "Settings changes cancelled.")
            settings_win.destroy()

        ok_button.config(command=ok_action)
        apply_button.config(command=apply_action_ui_handler)
        cancel_close_button.config(command=cancel_close_action)
        ok_button.pack(side=tk.LEFT, padx=(0,5)); apply_button.pack(side=tk.LEFT, padx=5); cancel_close_button.pack(side=tk.LEFT, padx=(5,0))
        action_buttons_subframe.pack(side=tk.RIGHT) 
        buttons_frame.pack(fill=tk.X, side=tk.BOTTOM, pady=(10,0)) 
        ok_button.focus_set()
        settings_win.bind('<Return>', lambda event: ok_button.invoke())
        settings_win.bind('<Escape>', lambda event: cancel_close_button.invoke())
        settings_win.update_idletasks() 
        req_width, req_height = settings_win.winfo_reqwidth(), settings_win.winfo_reqheight()
        final_width, final_height = max(550, req_width + 20), req_height + 20
        settings_win.geometry(f"{final_width}x{final_height}")
        settings_win.minsize(final_width, final_height)
    
    def _apply_saved_sort_state_to_tree_and_ui(self, files_data_list):
        """
        Applies the loaded sort state (if any) to the files_data_list and
        updates the Treeview column headers to show the sort indicator.
        This should be called BEFORE data is inserted into the tree for the first time
        or after a full refresh if restoring saved sort.
        Returns the sorted files_data_list.
        """
        if self.saved_treeview_sort_column and self.saved_treeview_sort_column in self.original_tree_headings:
            logger.info("GUI", "_apply_saved_sort_state", f"Applying saved sort: Col='{self.saved_treeview_sort_column}', Reverse={self.saved_treeview_sort_reverse}")
            # Set the active sort parameters for the GUI state
            self.treeview_sort_column = self.saved_treeview_sort_column
            self.treeview_sort_reverse = self.saved_treeview_sort_reverse
            
            # Sort the data directly
            files_data_list = self._sort_files_data(
                files_data_list, 
                self.treeview_sort_column, 
                self.treeview_sort_reverse
            )
            
            # Update treeview headings in the main thread
            # Ensure this runs after the treeview widget is fully available.
            self.master.after(0, self._update_treeview_sort_indicator_ui_only)
            
            # Clear the saved state after applying it once, so subsequent user clicks behave normally
            self.saved_treeview_sort_column = None 
        return files_data_list

    def _update_treeview_sort_indicator_ui_only(self):
        """Updates only the Treeview column header texts with sort arrows."""
        if not hasattr(self, 'file_tree') or not self.file_tree.winfo_exists():
            return
        if not self.treeview_sort_column: # No active sort column
            # Clear all arrows if needed
            for col_id, original_text in self.original_tree_headings.items():
                self.file_tree.heading(col_id, text=original_text)
            return

        for col_id, original_text in self.original_tree_headings.items():
            arrow = ""
            if col_id == self.treeview_sort_column:
                arrow = " ▼" if self.treeview_sort_reverse else " ▲"
            try:
                if self.file_tree.winfo_exists(): # Check if widget still exists
                    self.file_tree.heading(col_id, text=original_text + arrow)
            except tk.TclError as e:
                logger.warning("GUI", "_update_treeview_sort_indicator", f"Error updating heading for {col_id}: {e}")

    def _select_download_dir_for_settings_dialog(self, label_widget, dialog_dir_tracker, change_tracker, apply_btn, cancel_btn):
        selected_dir = filedialog.askdirectory(initialdir=dialog_dir_tracker[0], title="Select Download Directory")
        if selected_dir and selected_dir != dialog_dir_tracker[0]:
            dialog_dir_tracker[0] = selected_dir
            if label_widget and label_widget.winfo_exists(): label_widget.config(text=dialog_dir_tracker[0])
            if not change_tracker[0]: 
                change_tracker[0] = True
                if apply_btn.winfo_exists(): apply_btn.config(state=tk.NORMAL)
                if cancel_btn.winfo_exists(): cancel_btn.config(text="Cancel")
            logger.debug("GUI", "_select_download_dir_for_settings", f"Download dir selection changed to: {dialog_dir_tracker[0]}")

    def _load_device_settings_for_dialog(self, settings_win_ref, on_complete_hook=None):
        try:
            settings = self.dock.get_device_settings()
            def safe_update(task): 
                if settings_win_ref.winfo_exists(): task()
            if settings:
                self._fetched_device_settings_for_dialog = settings.copy()
                self.master.after(0, lambda: safe_update(lambda: self.device_setting_auto_record_var.set(settings.get("autoRecord", False))))
                self.master.after(0, lambda: safe_update(lambda: self.device_setting_auto_play_var.set(settings.get("autoPlay", False))))
                self.master.after(0, lambda: safe_update(lambda: self.device_setting_bluetooth_tone_var.set(settings.get("bluetoothTone", False))))
                self.master.after(0, lambda: safe_update(lambda: self.device_setting_notification_sound_var.set(settings.get("notificationSound", False))))
                for cb in [self.auto_record_checkbox, self.auto_play_checkbox, self.bt_tone_checkbox, self.notification_sound_checkbox]:
                    self.master.after(0, lambda widget=cb: safe_update(lambda: widget.config(state=tk.NORMAL)))
            else: logger.warning("GUI", "_load_device_settings_for_dialog", "Failed to load device settings.")
        except Exception as e:
            logger.error("GUI", "_load_device_settings_for_dialog", f"Error loading device settings: {e}")
            if settings_win_ref.winfo_exists(): messagebox.showerror("Error", f"Failed to load device settings: {e}", parent=settings_win_ref)
        finally:
            if on_complete_hook: self.master.after(0, lambda: safe_update(on_complete_hook))

    def _apply_device_settings_thread(self, settings_to_apply):
        if not settings_to_apply: logger.info("GUI", "_apply_device_settings_thread", "No device behavior settings changed."); return
        all_successful = True
        for name, value in settings_to_apply.items():
            result = self.dock.set_device_setting(name, value)
            if not result or result.get("result") != "success":
                all_successful = False
                logger.error("GUI", "_apply_device_settings_thread", f"Failed to set '{name}' to {value}.")
                self.master.after(0, messagebox.showwarning, "Settings Error", f"Failed to apply setting: {name}", parent=self.master)
        if all_successful: logger.info("GUI", "_apply_device_settings_thread", "All changed device settings applied.")

    def scan_usb_devices_for_settings(self, parent_window, initial_load=False, change_callback=None):
        try:
            logger.info("GUI", "scan_usb_devices", "Scanning for USB devices...")
            self.available_usb_devices.clear()
            if not self.backend_initialized_successfully:
                messagebox.showerror("USB Error", "Libusb backend not initialized.", parent=parent_window)
                if self.settings_device_combobox and self.settings_device_combobox.winfo_exists():
                    self.settings_device_combobox['values'] = ["USB Backend Error"]; self.settings_device_combobox.current(0)
                return

            found_devices = usb.core.find(find_all=True, backend=self.usb_backend_instance)
            if not found_devices:
                if self.settings_device_combobox and self.settings_device_combobox.winfo_exists():
                    self.settings_device_combobox['values'] = ["No devices found"]; self.settings_device_combobox.current(0)
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

            if self.settings_device_combobox and self.settings_device_combobox.winfo_exists():
                self.settings_device_combobox['values'] = combo_list if combo_list else ["No devices accessible"]
                if current_sel_str and current_sel_str in combo_list: self.settings_device_combobox.set(current_sel_str)
                elif combo_list and combo_list[0] != "--- Devices with Issues ---":
                    if not initial_load:
                        self.settings_device_combobox.set(combo_list[0])
                        sel_info = next((dt for dt in self.available_usb_devices if dt[0] == combo_list[0]), None)
                        if sel_info: self.selected_vid_var.set(sel_info[1]); self.selected_pid_var.set(sel_info[2])
                        if change_callback: change_callback() # Call the passed callback
                elif not combo_list : self.settings_device_combobox.current(0) # For "No devices accessible"
            logger.info("GUI", "scan_usb_devices", f"Found {len(good_devs)} good, {len(problem_devs)} problem devices.")
        except Exception as e:
            logger.error("GUI", "scan_usb_devices_for_settings", f"Unhandled exception: {e}\n{traceback.format_exc()}")
            if parent_window and parent_window.winfo_exists(): messagebox.showerror("Scan Error", f"Error during USB scan: {e}", parent=parent_window)

    def log_to_gui_widget(self, message, level_name="INFO"):
        def _update_log_task(msg, lvl):
            gui_filter_val = Logger.LEVELS.get(self.gui_log_filter_level_var.get().upper(), Logger.LEVELS["DEBUG"])
            msg_level_val = Logger.LEVELS.get(lvl.upper(), 0)
            if msg_level_val < gui_filter_val: return
            if self.log_text_area.winfo_exists():
                self.log_text_area.config(state='normal')
                self.log_text_area.insert(tk.END, msg, lvl)
                self.log_text_area.see(tk.END)
                self.log_text_area.config(state='disabled')
        if self.master.winfo_exists(): self.master.after(0, _update_log_task, message, level_name)

    def _update_optional_panes_visibility(self):
        if not hasattr(self, 'optional_sections_pane') or not self.optional_sections_pane.winfo_exists():
            logger.error("GUI", "_update_optional_panes_visibility", "optional_sections_pane does not exist.")
            return

        current_managed_children_paths = self.optional_sections_pane.panes()
        current_managed_widgets = []
        for pane_path in current_managed_children_paths:
            try:
                current_managed_widgets.append(self.optional_sections_pane.nametowidget(pane_path))
            except tk.TclError: pass

        # Order of operations: forget everything, then add back in desired order
        for widget in [self.log_frame, self.device_tools_frame]:
            if widget in current_managed_widgets:
                try:
                    self.optional_sections_pane.forget(widget)
                except tk.TclError: pass
        
        something_added = False
        if self.logs_visible_var.get():
            try:
                self.optional_sections_pane.add(self.log_frame, weight=1) # Adjust weight as needed
                something_added = True
            except tk.TclError as e:
                logger.warning("GUI", "_update_optional_panes", f"Error re-adding log_frame: {e}")

        if self.device_tools_visible_var.get():
            try:
                self.optional_sections_pane.add(self.device_tools_frame, weight=1) # Adjust weight
                something_added = True
            except tk.TclError as e:
                logger.warning("GUI", "_update_optional_panes", f"Error re-adding device_tools_frame: {e}")

        if something_added:
            if not self.optional_sections_pane.winfo_ismapped():
                # optional_sections_pane is a child of main_content_frame
                self.optional_sections_pane.pack(fill=tk.BOTH, expand=True, pady=(5,0)) # expand=True to take available space
        else:
            if self.optional_sections_pane.winfo_ismapped():
                self.optional_sections_pane.pack_forget()

    def clear_log_gui(self):
        if self.log_text_area.winfo_exists():
            self.log_text_area.config(state='normal'); self.log_text_area.delete(1.0, tk.END); self.log_text_area.config(state='disabled')
            logger.info("GUI", "clear_log_gui", "Log display cleared.")

    def on_gui_log_filter_change(self, event=None):
        logger.info("GUI", "on_gui_log_filter_change", f"GUI log display filter to {self.gui_log_filter_level_var.get()}.")

    def download_gui_logs(self):
        if not self.log_text_area.winfo_exists(): return
        log_content = self.log_text_area.get(1.0, tk.END)
        if not log_content.strip(): messagebox.showinfo("Download Logs", "Log display is empty.", parent=self.master); return
        filepath = filedialog.asksaveasfilename(defaultextension=".log", filetypes=[("Log files", "*.log"), ("Text", "*.txt")], title="Save GUI Logs")
        if filepath:
            try:
                with open(filepath, 'w', encoding='utf-8') as f: f.write(log_content)
                logger.info("GUI", "download_gui_logs", f"GUI logs saved to {filepath}")
                messagebox.showinfo("Download Logs", f"Logs saved to:\n{filepath}", parent=self.master)
            except Exception as e:
                logger.error("GUI", "download_gui_logs", f"Error saving logs: {e}")
                messagebox.showerror("Download Logs Error", f"Failed to save logs: {e}", parent=self.master)

    def _initialize_backend_early(self):
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
            if self.backend_init_error_message: messagebox.showerror("USB Backend Error", self.backend_init_error_message, parent=self.master)
            self._update_menu_states()
            return
        if not self.master.winfo_exists(): logger.warning("GUI", "connect_device", "Master window gone, aborting."); return
        
        self.update_status_bar(connection_status="Status: Connecting...")
        self._update_menu_states() # Disable connect while attempting
        threading.Thread(target=self._connect_device_thread, daemon=True).start()

    def _connect_device_thread(self):
        try:
            vid, pid, interface = self.selected_vid_var.get(), self.selected_pid_var.get(), self.target_interface_var.get()
            if self.dock.connect(target_interface_number=interface, vid=vid, pid=pid):
                device_info = self.dock.get_device_info() # Fetch info
                self.dock.device_info['_cached_card_info'] = self.dock.get_card_info() # Cache card info
                self.master.after(0, self.update_all_status_info) # Update status bar with all new info
                self.master.after(0, self._update_menu_states)
                if device_info:
                     self.master.after(0, self.refresh_file_list_gui)
                     self.start_recording_status_check()
                     if self.auto_refresh_files_var.get(): self.start_auto_file_refresh_periodic_check()
                else:
                    self.master.after(0, lambda: self.update_status_bar(connection_status="Status: Connected, but failed to get device info."))
                    self.stop_recording_status_check(); self.stop_auto_file_refresh_periodic_check()
            else: 
                logger.error("GUI", "_connect_device_thread", "dock.connect returned False.")
                self.master.after(0, lambda: self.handle_auto_disconnect_ui() if self.master.winfo_exists() else None)
        except Exception as e:
            logger.error("GUI", "_connect_device_thread", f"Connection error: {e}\n{traceback.format_exc()}")
            if self.master.winfo_exists():
                self.master.after(0, lambda: self.update_status_bar(connection_status=f"Status: Connection Error ({type(e).__name__})"))
                if not self.dock.is_connected(): self.master.after(0, lambda: self.handle_auto_disconnect_ui() if self.master.winfo_exists() else None)
        finally:
            if self.master.winfo_exists(): self.master.after(0, self._update_menu_states)


    def handle_auto_disconnect_ui(self):
        logger.warning("GUI", "handle_auto_disconnect_ui", "Device auto-disconnected or connection lost.")
        self.update_status_bar(connection_status="Status: Disconnected (Error/Lost)")
        if hasattr(self, 'file_tree') and self.file_tree.winfo_exists():
            for item in self.file_tree.get_children(): self.file_tree.delete(item)
        self.displayed_files_details.clear()
        self.update_all_status_info() # Update all parts of status bar
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
        self.update_all_status_info() # Update status bar
        self._update_menu_states() # Update menu states

    def refresh_file_list_gui(self):
        if not self.backend_initialized_successfully: logger.warning("GUI", "refresh_file_list_gui", "Backend not init."); return
        if not self.dock.is_connected(): messagebox.showerror("Error", "Not connected."); self._update_menu_states(); return
        if self._is_ui_refresh_in_progress: logger.debug("GUI", "refresh_file_list_gui", "Refresh in progress."); return
        if self.is_long_operation_active : logger.debug("GUI", "refresh_file_list_gui", "Long operation active, refresh deferred."); return
            
        self._is_ui_refresh_in_progress = True
        self.update_status_bar(progress_text="Fetching file list...")
        self._update_menu_states() # Disable refresh menu item and toolbar button
        threading.Thread(target=self._refresh_file_list_thread, daemon=True).start()

    def _refresh_file_list_thread(self):
        try:
            list_result = self.dock.list_files(timeout_s=self.default_command_timeout_ms_var.get() / 1000)
            if not self.dock.is_connected(): self.master.after(0, self.handle_auto_disconnect_ui); return

            files = list_result.get("files", [])
            self.dock.device_info['_cached_card_info'] = self.dock.get_card_info() # Cache for status bar
            self.master.after(0, self.update_all_status_info) # Update status bar with new counts/storage

            if hasattr(self, 'file_tree') and self.file_tree.winfo_exists():
                for item in self.file_tree.get_children(): self.master.after(0, lambda i=item: self.file_tree.delete(i) if self.file_tree.exists(i) else None)
            self.master.after(0, self.displayed_files_details.clear)

            all_files_to_display = list(files)
            recording_info = self.dock.get_recording_file()
            if recording_info and recording_info.get("name") and not any(f.get("name") == recording_info['name'] for f in files):
                all_files_to_display.insert(0, {"name": recording_info['name'], "length": 0, "duration": "Recording...", "createDate": "In Progress", "createTime": "", "time": datetime.now(), "is_recording": True})

            if all_files_to_display:
                # Apply saved sort state ONCE after loading/full refresh if available
                if self.saved_treeview_sort_column and self.saved_treeview_sort_column in self.original_tree_headings:
                    all_files_to_display = self._apply_saved_sort_state_to_tree_and_ui(all_files_to_display)
                    # _apply_saved_sort_state_to_tree_and_ui will set self.treeview_sort_column
                    # and self.treeview_sort_reverse, and also clear self.saved_treeview_sort_column
                elif self.treeview_sort_column: # Apply current in-session sort if no saved sort was pending
                    all_files_to_display = self._sort_files_data(all_files_to_display, self.treeview_sort_column, self.treeview_sort_reverse)
                    # Ensure UI indicator is correct for in-session sort too
                    self.master.after(0, self._update_treeview_sort_indicator_ui_only)


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
                    self.master.after(0, lambda fi=f_info, v=vals, t=tags: self.file_tree.insert("",tk.END,values=v,iid=fi['name'],tags=t) if self.file_tree.winfo_exists() else None)
                    self.master.after(0, lambda fi=f_info: self.displayed_files_details.append(fi))
            else:
                self.master.after(0, lambda: self.update_status_bar(progress_text=f"Error: {list_result.get('error','Unknown')}" if list_result.get("error") else "No files found."))
        except ConnectionError as ce: logger.error("GUI","_refresh_thread",f"ConnErr: {ce}"); self.master.after(0,self.handle_auto_disconnect_ui)
        except Exception as e: logger.error("GUI","_refresh_thread",f"Error: {e}\n{traceback.format_exc()}"); self.master.after(0, lambda: self.update_status_bar(progress_text="Error loading files."))
        finally:
            self.master.after(0, lambda: setattr(self, '_is_ui_refresh_in_progress', False))
            self.master.after(0, self._update_menu_states)
            self.master.after(0, lambda: self.update_status_bar(progress_text="Ready." if self.dock.is_connected() else "Disconnected.")) # Clear progress text
            self.master.after(0, self.update_all_status_info) # Final update for counts


    def _on_file_double_click(self, event):
        if not self.dock.is_connected() and not self.is_audio_playing: return
        item_iid = self.file_tree.identify_row(event.y)
        if not item_iid: return
        self.file_tree.selection_set(item_iid)
        file_detail = next((f for f in self.displayed_files_details if f['name'] == item_iid), None)
        if not file_detail: return
        status = file_detail.get('gui_status', "On Device")
        if self.is_audio_playing and self.current_playing_filename_for_replay == item_iid: self._stop_audio_playback(); return
        elif status in ["Downloaded", "Downloaded OK"]: self.play_selected_audio_gui()
        elif status in ["On Device", "Mismatch", "Cancelled"] or "Error" in status:
            if not file_detail.get("is_recording"): self.download_selected_files_gui()

    def _on_file_right_click(self, event):
        clicked_item_iid = self.file_tree.identify_row(event.y)
        current_selection = self.file_tree.selection()
        if clicked_item_iid and clicked_item_iid not in current_selection:
            self.file_tree.selection_set(clicked_item_iid)
            current_selection = (clicked_item_iid,)
        
        menu = tk.Menu(self.master, tearoff=0)
        num_selected = len(current_selection)
        thin_space = "\u2009"

        if num_selected == 1:
            item_iid = current_selection[0]
            file_detail = next((f for f in self.displayed_files_details if f['name'] == item_iid), None)
            if file_detail:
                status = file_detail.get('gui_status', "On Device")
                is_playable = file_detail['name'].lower().endswith((".wav", ".hda"))

                if self.is_audio_playing and self.current_playing_filename_for_replay == item_iid:
                    menu.add_command(label=f"Stop Playback", command=self._stop_audio_playback)
                elif is_playable and status not in ["Recording", "Downloading", "Queued"]:
                     menu.add_command(label=f"Play", command=self.play_selected_audio_gui)
                
                if status in ["On Device", "Mismatch", "Cancelled"] or "Error" in status:
                     if not file_detail.get("is_recording"): menu.add_command(label=f"Download", command=self.download_selected_files_gui)
                elif status == "Downloaded" or status == "Downloaded OK": menu.add_command(label=f"Re-download", command=self.download_selected_files_gui)
                
                if status in ["Downloading", "Queued"] or "Preparing Playback" in status: menu.add_command(label=f"Cancel Operation", command=self.request_cancel_operation)
                if not file_detail.get("is_recording"): menu.add_command(label=f"Delete", command=self.delete_selected_files_gui)
        elif num_selected > 1:
            menu.add_command(label=f"Download Selected ({num_selected})", command=self.download_selected_files_gui)
            if not any(next((f for f in self.displayed_files_details if f['name'] == iid), {}).get("is_recording") for iid in current_selection):
                menu.add_command(label=f"Delete Selected ({num_selected})", command=self.delete_selected_files_gui)
        
        if menu.index(tk.END) is not None: menu.add_separator()
        menu.add_command(label=f"Refresh List", command=self.refresh_file_list_gui, state=tk.NORMAL if self.dock.is_connected() else tk.DISABLED)
        if menu.index(tk.END) is None: return
        try: menu.tk_popup(event.x_root, event.y_root)
        finally: menu.grab_release()


    def _update_file_status_in_treeview(self, filename_iid, new_status_text, new_tags_tuple=()):
        if not self.master.winfo_exists() or not self.file_tree.winfo_exists() or not self.file_tree.exists(filename_iid): return
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
            return val if val is not None else '' # Fallback
        return sorted(files_data, key=get_sort_key, reverse=reverse_order)

    def sort_treeview_column(self, column_name_map_key, is_numeric_string_unused):
        column_data_key = column_name_map_key
        if self.treeview_sort_column == column_data_key:
            self.treeview_sort_reverse = not self.treeview_sort_reverse
        else:
            self.treeview_sort_column = column_data_key
            self.treeview_sort_reverse = False
        
        # Clear any "saved" sort state as user has now actively clicked a column
        self.saved_treeview_sort_column = None
        self.saved_treeview_sort_reverse = False

        self._update_treeview_sort_indicator_ui_only()
        
        self.displayed_files_details = self._sort_files_data(
            self.displayed_files_details, 
            self.treeview_sort_column, 
            self.treeview_sort_reverse
        )
        
        if hasattr(self, 'file_tree') and self.file_tree.winfo_exists():
            # Store selection before clearing (optional, for better UX)
            # current_selection_iids = self.file_tree.selection()

            for item in self.file_tree.get_children():
                self.file_tree.delete(item)
            for f_info in self.displayed_files_details:
                status, tags = f_info.get('gui_status',"On Device"), f_info.get('gui_tags',())
                vals = (f_info['name'], "-", status, f_info.get('createDate',''), f_info.get('createTime',''), status) if f_info.get("is_recording") \
                    else (f_info['name'], f"{f_info['length']/1024:.2f}", f"{f_info['duration']:.2f}", f_info.get('createDate',''), f_info.get('createTime',''), status)
                self.file_tree.insert("", tk.END, values=vals, iid=f_info['name'], tags=tags)
            
            # Restore selection (optional)
            # if current_selection_iids:
            #     self.file_tree.selection_set(current_selection_iids)
        
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
        if self._recording_check_timer_id: self.master.after_cancel(self._recording_check_timer_id); self._recording_check_timer_id = None

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
            if self._recording_check_timer_id is not None:
                interval_ms = self.recording_check_interval_var.get() * 1000
                if interval_ms <= 0: self.stop_recording_status_check()
                else: self._recording_check_timer_id = self.master.after(interval_ms, self._check_recording_status_periodically)

    def start_auto_file_refresh_periodic_check(self):
        self.stop_auto_file_refresh_periodic_check()
        if self.auto_refresh_files_var.get() and self.dock.is_connected():
            interval_s = self.auto_refresh_interval_s_var.get()
            if interval_s <= 0: logger.info("GUI", "start_auto_refresh", "Interval <=0, disabled."); return
            self._check_auto_file_refresh_periodically()

    def stop_auto_file_refresh_periodic_check(self):
        if self._auto_file_refresh_timer_id: self.master.after_cancel(self._auto_file_refresh_timer_id); self._auto_file_refresh_timer_id = None

    def _check_auto_file_refresh_periodically(self):
        try:
            if not self.dock.is_connected() or not self.auto_refresh_files_var.get(): self.stop_auto_file_refresh_periodic_check(); return
            if self.is_long_operation_active: return # Don't refresh if something like a download is happening
            self.refresh_file_list_gui()
        except Exception as e: logger.error("GUI", "_check_auto_refresh", f"Unhandled: {e}\n{traceback.format_exc()}")
        finally:
            if self._auto_file_refresh_timer_id is not None: # Check if it was cancelled by stop_auto_file_refresh_periodic_check
                interval_ms = self.auto_refresh_interval_s_var.get() * 1000
                if interval_ms <= 0: self.stop_auto_file_refresh_periodic_check()
                else: self._auto_file_refresh_timer_id = self.master.after(interval_ms, self._check_auto_file_refresh_periodically)


    def _reset_download_dir_for_settings(self, label_widget, dialog_dir_tracker, change_tracker, apply_btn, cancel_btn):
        default_dir = os.getcwd()
        if default_dir != dialog_dir_tracker[0]:
            dialog_dir_tracker[0] = default_dir
            if label_widget and label_widget.winfo_exists(): label_widget.config(text=dialog_dir_tracker[0])
            if not change_tracker[0]: 
                change_tracker[0] = True
                if apply_btn.winfo_exists(): apply_btn.config(state=tk.NORMAL)
                if cancel_btn.winfo_exists(): cancel_btn.config(text="Cancel")

    def _set_long_operation_active_state(self, active: bool, operation_name: str = ""):
        self.is_long_operation_active = active
        if active:
            self.update_status_bar(progress_text=f"{operation_name} in progress...")
            self.cancel_operation_event = threading.Event()
            self.active_operation_name = operation_name # Store the current operation type
        else:
            self.update_status_bar(progress_text=f"{operation_name} finished." if operation_name else "Ready.")
            self.cancel_operation_event = None
            self.active_operation_name = None # Clear the operation type
        self._update_menu_states() # This will also update toolbar buttons
        self.on_file_selection_change(None) 

    def play_selected_audio_gui(self):
        if not pygame: messagebox.showerror("Playback Error", "Pygame not installed."); return
        selected_iids = self.file_tree.selection()
        if not selected_iids or len(selected_iids) > 1: return
        file_iid = selected_iids[0]
        file_detail = next((f for f in self.displayed_files_details if f['name'] == file_iid), None)
        if not file_detail or not (file_detail['name'].lower().endswith((".wav", ".hda"))): return

        if self.is_long_operation_active and not self.is_audio_playing: messagebox.showwarning("Busy", "Another operation in progress."); return
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
                messagebox.showerror("Playback Error", f"Temp file error: {e}")
                self._set_long_operation_active_state(False, "Playback Preparation")
                self._update_file_status_in_treeview(file_detail['name'], "Error (Playback Prep)", ('size_mismatch',))

    def _download_for_playback_thread(self, file_info):
        try:
            with open(self.current_playing_temp_file, "wb") as outfile:
                def data_cb(chunk): outfile.write(chunk)
                def progress_cb(rcvd, total):
                    self.master.after(0, self.update_file_progress, rcvd, total, f"(Playback) {file_info['name']}")
                    self.master.after(0, self._update_file_status_in_treeview, file_info['name'], "Downloading (Play)", ('downloading',))
                status = self.dock.stream_file(file_info['name'], file_info['length'], data_cb, progress_cb, timeout_s=self.file_stream_timeout_s_var.get(), cancel_event=self.cancel_operation_event)
            
            if status == "OK": self.master.after(0, self._start_playback_local_file, self.current_playing_temp_file, file_info)
            elif status == "cancelled": self.master.after(0, self._update_file_status_in_treeview, file_info['name'], "Cancelled", ('cancelled',)); self._cleanup_temp_playback_file()
            elif status == "fail_disconnected": self.master.after(0, self.handle_auto_disconnect_ui); self._cleanup_temp_playback_file()
            else: messagebox.showerror("Playback Error", f"Download failed: {status}"); self.master.after(0, self._update_file_status_in_treeview, file_info['name'], "Error (Download)", ('size_mismatch',)); self._cleanup_temp_playback_file()
        except Exception as e:
            if not self.dock.is_connected(): self.master.after(0, self.handle_auto_disconnect_ui)
            logger.error("GUI", "_download_for_playback_thread", f"Error: {e}\n{traceback.format_exc()}")
            messagebox.showerror("Playback Error", f"Error: {e}"); self._cleanup_temp_playback_file()
            self.master.after(0, self._update_file_status_in_treeview, file_info['name'], "Error (Playback Prep)", ('size_mismatch',))
        finally:
            self.master.after(0, self._set_long_operation_active_state, False, "Playback Preparation")
            self.master.after(0, self.start_auto_file_refresh_periodic_check) # Resume auto-refresh if it was paused

    def _start_playback_local_file(self, filepath, original_file_info):
        try:
            if not pygame: messagebox.showerror("Playback Error", "Pygame not initialized.", parent=self.master); return
            pygame.mixer.music.load(filepath)
            sound = pygame.mixer.Sound(filepath); self.playback_total_duration = sound.get_length(); del sound
            self.is_audio_playing = True
            if not hasattr(self, 'playback_controls_frame') or not self.playback_controls_frame.winfo_exists(): self._create_playback_controls_frame()
            
            self.total_duration_label.config(text=time.strftime('%M:%S', time.gmtime(self.playback_total_duration)))
            self.playback_slider.config(to=self.playback_total_duration); self.playback_slider.set(0)
            pygame.mixer.music.play(loops=(-1 if self.loop_playback_var.get() else 0))
            self.playback_controls_frame.pack(fill=tk.X, side=tk.BOTTOM, pady=5, before=self.status_bar_frame) # Pack above status bar
            self._update_playback_progress()
            self.update_status_bar(progress_text=f"Playing: {os.path.basename(filepath)}")
            self.current_playing_filename_for_replay = original_file_info['name']
            self._update_file_status_in_treeview(original_file_info['name'], "Playing", ('playing',))
            self._update_menu_states() # Update play/stop in menu
        except Exception as e:
            logger.error("GUI", "_start_playback_local_file", f"Error: {e}\n{traceback.format_exc()}")
            messagebox.showerror("Playback Error", f"Could not play: {e}"); self._cleanup_temp_playback_file(); self.is_audio_playing = False
            self._update_menu_states()

    def _create_playback_controls_frame(self):
        # Check if the attribute exists and is a valid widget that might exist
        if hasattr(self, 'playback_controls_frame') and \
           self.playback_controls_frame is not None and \
           self.playback_controls_frame.winfo_exists():
            self.playback_controls_frame.destroy()
        # Now, create the new frame
        self.playback_controls_frame = ttk.Frame(self.master, padding="5")
        self.current_time_label = ttk.Label(self.playback_controls_frame, text="00:00"); self.current_time_label.pack(side=tk.LEFT, padx=5)
        self.playback_slider = ttk.Scale(self.playback_controls_frame, from_=0, to=100, orient=tk.HORIZONTAL, length=300, command=self._on_slider_value_changed_by_command)
        self.playback_slider.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)
        self.playback_slider.bind("<ButtonPress-1>", self._on_slider_press); self.playback_slider.bind("<ButtonRelease-1>", self._on_slider_release)
        self.total_duration_label = ttk.Label(self.playback_controls_frame, text="00:00"); self.total_duration_label.pack(side=tk.LEFT, padx=5)
        ttk.Label(self.playback_controls_frame, text="Vol:").pack(side=tk.LEFT, padx=(10,0))
        self.volume_slider_widget = ttk.Scale(self.playback_controls_frame, from_=0, to=1, variable=self.volume_var, command=self._on_volume_change, orient=tk.HORIZONTAL, length=80)
        self.volume_slider_widget.pack(side=tk.LEFT, padx=(0,5)); pygame.mixer.music.set_volume(self.volume_var.get())
        self.loop_checkbox = ttk.Checkbutton(self.playback_controls_frame, text="Loop", variable=self.loop_playback_var, command=self._on_loop_toggle)
        self.loop_checkbox.pack(side=tk.LEFT, padx=5)

    def _update_playback_progress(self):
        if self.is_audio_playing and pygame and pygame.mixer.get_init() and pygame.mixer.music.get_busy():
            current_pos_sec = min(pygame.mixer.music.get_pos() / 1000.0, self.playback_total_duration)
            if not self._user_is_dragging_slider and abs(self.playback_slider.get() - current_pos_sec) > 0.5: self.playback_slider.set(current_pos_sec)
            self.current_time_label.config(text=time.strftime('%M:%S', time.gmtime(current_pos_sec)))
            self.playback_update_timer_id = self.master.after(250, self._update_playback_progress)
        elif self.is_audio_playing: self._stop_audio_playback(mode="natural_end")

    def _on_slider_press(self, event): self._user_is_dragging_slider = True; self.master.after_cancel(self.playback_update_timer_id) if self.playback_update_timer_id else None
    def _on_slider_release(self, event):
        seek_pos_sec = self.playback_slider.get(); self._user_is_dragging_slider = False
        if self.is_audio_playing and pygame and pygame.mixer.get_init():
            try:
                pygame.mixer.music.stop(); pygame.mixer.music.play(loops=(-1 if self.loop_playback_var.get() else 0), start=seek_pos_sec)
                self.current_time_label.config(text=time.strftime('%M:%S', time.gmtime(seek_pos_sec)))
                if pygame.mixer.music.get_busy(): self._update_playback_progress()
            except Exception as e: logger.error("GUI", "_on_slider_release_seek", f"Error seeking: {e}")
    def _on_slider_value_changed_by_command(self, value_str): self.current_time_label.config(text=time.strftime('%M:%S', time.gmtime(float(value_str))))
    def _on_volume_change(self, value_str): 
        if pygame and pygame.mixer.get_init(): 
            try: pygame.mixer.music.set_volume(float(value_str))
            except Exception as e: logger.error("GUI", "_on_volume_change", f"Error setting volume: {e}")
    def _on_loop_toggle(self):
        if self.is_audio_playing and pygame and pygame.mixer.get_init() and pygame.mixer.music.get_busy():
            pygame.mixer.music.play(loops=(-1 if self.loop_playback_var.get() else 0), start=pygame.mixer.music.get_pos()/1000.0)

    def on_file_selection_change(self, event=None):
        try:
            self.update_all_status_info() # Update file counts in status bar
            self._update_menu_states()   # Update menu item states and toolbar based on selection
        except Exception as e: logger.error("GUI", "on_file_selection_change", f"Unhandled: {e}\n{traceback.format_exc()}")

    def _on_delete_key_press(self, event):
        if self.dock.is_connected() and self.file_tree.selection() and self.actions_menu.entrycget("Delete Selected", "state") == tk.NORMAL:
            self.delete_selected_files_gui()
        return "break"
    def _on_enter_key_press(self, event):
        if not self.dock.is_connected() or len(self.file_tree.selection()) != 1: return "break"
        try:
            bbox = self.file_tree.bbox(self.file_tree.selection()[0])
            if bbox: dummy_event = tk.Event(); dummy_event.y = bbox[1] + bbox[3]//2; self._on_file_double_click(dummy_event)
        except Exception as e: logger.warning("GUI", "_on_enter_key_press", f"Could not simulate double click: {e}")
        return "break"
    def _on_f5_key_press(self, event=None): # Allow calling without event
        if self.dock.is_connected() and self.view_menu.entrycget("Refresh File List", "state") == tk.NORMAL:
            self.refresh_file_list_gui()
        # self.update_select_all_clear_buttons_state() # This is now part of _update_menu_states

    def _stop_audio_playback(self, mode="user_stop"):
        was_playing_filename = self.current_playing_filename_for_replay
        if pygame and pygame.mixer.get_init():
            pygame.mixer.music.stop(); 
            try: pygame.mixer.music.unload()
            except Exception as e: logger.warning("GUI", "_stop_audio_playback", f"Unload error: {e}")
        self.is_audio_playing = False
        if self.playback_update_timer_id: self.master.after_cancel(self.playback_update_timer_id); self.playback_update_timer_id = None
        if hasattr(self, 'playback_controls_frame') and self.playback_controls_frame.winfo_exists(): self.playback_controls_frame.pack_forget()
        self._cleanup_temp_playback_file()
        self.on_file_selection_change(None) # Updates menu states and status bar
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
        if not selected_iids: messagebox.showinfo("No Selection", "Please select files to download."); return
        if not self.download_directory or not os.path.isdir(self.download_directory): messagebox.showerror("Error", "Invalid download directory."); return
        if self.is_long_operation_active: messagebox.showwarning("Busy", "Another operation in progress."); return
        files_to_download_info = [f for iid in selected_iids if (f := next((fd for fd in self.displayed_files_details if fd['name'] == iid), None))]
        self._set_long_operation_active_state(True, "Download Queue")
        threading.Thread(target=self._process_download_queue_thread, args=(files_to_download_info,), daemon=True).start()

    def _process_download_queue_thread(self, files_to_download_info):
        total_files = len(files_to_download_info)
        self.master.after(0, lambda: self.update_status_bar(progress_text=f"Batch Download: Initializing {total_files} file(s)..."))
        for i, file_info in enumerate(files_to_download_info): self.master.after(0, self._update_file_status_in_treeview, file_info['name'], f"Queued ({i+1}/{total_files})", ('queued',))
        
        batch_start_time, completed_count, operation_aborted = time.time(), 0, False
        for i, file_info in enumerate(files_to_download_info):
            if not self.dock.is_connected(): logger.error("GUI", "_process_dl_q", "Disconnected."); self.master.after(0, self.handle_auto_disconnect_ui); operation_aborted=True; break
            if self.cancel_operation_event and self.cancel_operation_event.is_set(): logger.info("GUI", "_process_dl_q", "Cancelled."); operation_aborted=True; break
            if self._execute_single_download(file_info, i + 1, total_files): completed_count += 1
            if not self.dock.is_connected() or (self.cancel_operation_event and self.cancel_operation_event.is_set()): operation_aborted=True; break
        
        duration = time.time() - batch_start_time
        final_msg = f"Batch: {completed_count}/{total_files} completed in {duration:.2f}s." if not operation_aborted else f"Download queue {'cancelled' if self.cancel_operation_event and self.cancel_operation_event.is_set() else 'aborted'} after {duration:.2f}s."
        self.master.after(0, lambda: self.update_status_bar(progress_text=final_msg))
        self.master.after(0, self._set_long_operation_active_state, False, "Download Queue")
        self.master.after(0, self.start_auto_file_refresh_periodic_check) # Resume auto-refresh
        self.master.after(0, lambda: self.status_file_progress_bar.config(value=0) if hasattr(self, 'status_file_progress_bar') and self.status_file_progress_bar.winfo_exists() else None)


    def delete_selected_files_gui(self):
        selected_iids = self.file_tree.selection()
        if not selected_iids: messagebox.showinfo("No Selection", "Please select files to delete."); return
        if not messagebox.askyesno("Confirm Delete", f"Permanently delete {len(selected_iids)} selected file(s)? This cannot be undone."): return
        self._set_long_operation_active_state(True, "Deletion") # Use a generic name
        threading.Thread(target=self._delete_files_thread, args=([iid for iid in selected_iids],), daemon=True).start()

    def _delete_files_thread(self, filenames):
        success, fail = 0,0
        for i, filename in enumerate(filenames):
            if not self.dock.is_connected(): logger.error("GUI", "_delete_thread", "Disconnected."); self.master.after(0, self.handle_auto_disconnect_ui); break
            self.master.after(0, lambda fn=filename, cur=i+1, tot=len(filenames): self.update_status_bar(progress_text=f"Deleting {fn} ({cur}/{tot})..."))
            status = self.dock.delete_file(filename, timeout_s=self.default_command_timeout_ms_var.get() / 1000)
            if status and status.get("result") == "success": success += 1
            else: fail += 1; logger.error("GUI", "_delete_thread", f"Failed to delete {filename}: {status.get('error', status.get('result'))}")
        
        self.master.after(0, lambda s=success, f=fail: self.update_status_bar(progress_text=f"Deletion complete. Succeeded: {s}, Failed: {f}"))
        self.master.after(0, self.refresh_file_list_gui)
        self.master.after(0, self._set_long_operation_active_state, False, "Deletion")


    def select_all_files_action(self):
        if self.file_tree.winfo_exists(): self.file_tree.selection_set(self.file_tree.get_children())
    def clear_selection_action(self):
        if self.file_tree.winfo_exists(): self.file_tree.selection_set([])
    # def update_select_all_clear_buttons_state(self): # Now handled by _update_menu_states
    #     pass


    def format_sd_card_gui(self):
        if not self.dock.is_connected(): messagebox.showerror("Error", "Not connected."); return
        if not messagebox.askyesno("Confirm Format", "WARNING: This will erase ALL data. Continue?") or \
           not messagebox.askyesno("Final Confirmation", "FINAL WARNING: Formatting will erase everything. Continue?"): return
        confirm_text = simpledialog.askstring("Type Confirmation", "Type 'FORMAT' to confirm formatting.", parent=self.master)
        if confirm_text is None or confirm_text.upper() != "FORMAT": messagebox.showwarning("Format Cancelled", "Confirmation text mismatch.", parent=self.master); return
        self._set_long_operation_active_state(True, "Formatting Storage")
        threading.Thread(target=self._format_sd_card_thread, daemon=True).start()

    def _format_sd_card_thread(self):
        self.master.after(0, lambda: self.update_status_bar(progress_text="Formatting Storage... Please wait."))
        status = self.dock.format_card(timeout_s=max(60, self.default_command_timeout_ms_var.get() / 1000))
        if status and status.get("result") == "success": messagebox.showinfo("Format Success", "Storage formatted successfully.", parent=self.master)
        else: messagebox.showerror("Format Failed", f"Failed to format storage: {status.get('error', status.get('result', 'Unknown'))}", parent=self.master)
        self.master.after(0, lambda: self.update_status_bar(progress_text="Format operation finished."))
        self.master.after(0, self.refresh_file_list_gui)
        self.master.after(0, self._set_long_operation_active_state, False, "Formatting Storage")


    def sync_device_time_gui(self):
        if not self.dock.is_connected(): messagebox.showerror("Error", "Not connected."); return
        if not messagebox.askyesno("Confirm Sync Time", "Set device time to computer's current time?"): return
        self._set_long_operation_active_state(True, "Time Sync")
        threading.Thread(target=self._sync_device_time_thread, daemon=True).start()

    def _sync_device_time_thread(self):
        self.master.after(0, lambda: self.update_status_bar(progress_text="Syncing device time..."))
        result = self.dock.set_device_time(datetime.now())
        if result and result.get("result") == "success": messagebox.showinfo("Time Sync", "Device time synchronized.", parent=self.master)
        else:
            err = result.get('error','Unknown') if result else "Comm error"
            if result and 'device_code' in result: err += f" (Dev code: {result['device_code']})"
            messagebox.showerror("Time Sync Error", f"Failed to sync time: {err}", parent=self.master)
        self.master.after(0, self._set_long_operation_active_state, False, "Time Sync")
        self.master.after(0, lambda: self.update_status_bar(progress_text="Time sync finished."))

    def _execute_single_download(self, file_info, file_index, total_files_to_download):
        self.master.after(0, self._update_file_status_in_treeview, file_info['name'], "Downloading", ('downloading',))
        self.master.after(0, lambda: self.update_status_bar(progress_text=f"Batch ({file_index}/{total_files_to_download}): Downloading {file_info['name']}..."))
        self.master.after(0, lambda: self.status_file_progress_bar.config(value=0) if hasattr(self, 'status_file_progress_bar') else None)
        
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
                    self.master.after(0, self.update_file_progress, rcvd, total, f"{file_info['name']} | {speed_str} | {etr_str}")
                
                stream_status = self.dock.stream_file(file_info['name'], file_info['length'], data_cb, progress_cb, timeout_s=self.file_stream_timeout_s_var.get(), cancel_event=self.cancel_operation_event)

            if stream_status == "OK":
                if os.path.exists(final_path): os.remove(final_path)
                os.rename(temp_path, final_path)
                self.master.after(0, self.update_file_progress, file_info['length'], file_info['length'], file_info['name'])
                self.master.after(0, self._update_file_status_in_treeview, file_info['name'], "Downloaded", ('downloaded_ok',))
                operation_succeeded = True
            else:
                msg = f"Download failed for {file_info['name']}. Status: {stream_status}. Temp file kept: {os.path.basename(temp_path)}"
                logger.error("GUI", "_execute_single_download", msg)
                self.master.after(0, lambda m=msg: self.update_status_bar(progress_text=m))
                final_status_text, final_tags = ("Error (Disconnect)", ('size_mismatch',)) if stream_status == "fail_disconnected" else \
                                                ("Cancelled", ('cancelled',)) if stream_status == "cancelled" else \
                                                ("Download Failed", ('size_mismatch',))
                self.master.after(0, self._update_file_status_in_treeview, file_info['name'], final_status_text, final_tags)
                if stream_status == "fail_disconnected": self.master.after(0, self.handle_auto_disconnect_ui)
                if stream_status == "cancelled" and self.cancel_operation_event: self.cancel_operation_event.set() # Ensure it's set
        except Exception as e:
            logger.error("GUI", "_execute_single_download", f"Error DL {file_info['name']}: {e}\n{traceback.format_exc()}")
            self.master.after(0, lambda: self.update_status_bar(progress_text=f"Error with {file_info['name']}. Temp file kept."))
            self.master.after(0, self._update_file_status_in_treeview, file_info['name'], "Error (Download)", ('size_mismatch',))
            if not self.dock.is_connected(): self.master.after(0, self.handle_auto_disconnect_ui)
        return operation_succeeded

    def update_file_progress(self, received, total, status_text_prefix=""):
        if hasattr(self, 'status_file_progress_bar') and self.status_file_progress_bar.winfo_exists():
            percentage = (received / total) * 100 if total > 0 else 0
            self.status_file_progress_bar['value'] = percentage
        # Update the text part of the status bar
        self.update_status_bar(progress_text=f"{status_text_prefix} ({received/ (1024*1024):.2f}/{total/ (1024*1024):.2f} MB)")
        self.master.update_idletasks()

    def on_closing(self):
        if self._recording_check_timer_id: self.master.after_cancel(self._recording_check_timer_id)
        if self._auto_file_refresh_timer_id: self.master.after_cancel(self._auto_file_refresh_timer_id)
        if self.is_audio_playing: self._stop_audio_playback()
        if pygame and pygame.mixer.get_init(): pygame.mixer.quit()
        
        # Save config
        # Define a mapping from configuration keys to the names of their Tkinter variable attributes
        config_to_var_map = {
            "autoconnect": "autoconnect_var",
            "log_level": "logger_processing_level_var", # Corrected mapping
            "selected_vid": "selected_vid_var",
            "selected_pid": "selected_pid_var",
            "target_interface": "target_interface_var",
            "recording_check_interval_s": "recording_check_interval_var", # Corrected mapping (variable name differs slightly from key)
            "default_command_timeout_ms": "default_command_timeout_ms_var",
            "file_stream_timeout_s": "file_stream_timeout_s_var",
            "auto_refresh_files": "auto_refresh_files_var",
            "auto_refresh_interval_s": "auto_refresh_interval_s_var",
            "quit_without_prompt_if_connected": "quit_without_prompt_var", # Corrected mapping for the reported bug
            "theme": "theme_var",
            "suppress_console_output": "suppress_console_output_var"
        }

        for config_key, var_attr_name_str in config_to_var_map.items():
            if hasattr(self, var_attr_name_str):
                tk_variable_instance = getattr(self, var_attr_name_str)
                # Ensure it's a Tkinter Variable before calling .get()
                if isinstance(tk_variable_instance, (tk.BooleanVar, tk.StringVar, tk.IntVar, tk.DoubleVar)):
                    self.config[config_key] = tk_variable_instance.get()
                else:
                    logger.warning("ConfigSave", "on_closing", 
                                   f"Attribute '{var_attr_name_str}' for config key '{config_key}' is not a recognized tk.Variable type.")
            else:
                logger.warning("ConfigSave", "on_closing", 
                               f"Attribute '{var_attr_name_str}' for config key '{config_key}' not found on self.")
        
        self.config["download_directory"] = self.download_directory

        # --- Save additional persistent UI settings ---
        if hasattr(self, 'file_tree') and self.file_tree.winfo_exists():
            try:
                current_display_order = list(self.file_tree["displaycolumns"])
                # #all is the default when not explicitly set, meaning it follows columns= order
                # So, only save if it's not #all and differs from the initial default order
                default_initial_order = self.config.get("treeview_columns_display_order", "name,size,duration,date,time,status").split(',')
                if current_display_order and current_display_order[0] != "#all":
                    self.config["treeview_columns_display_order"] = ",".join(current_display_order)
                elif current_display_order[0] == "#all" and "treeview_columns_display_order" in self.config:
                     # If current is #all (meaning it's default order based on `columns` tuple)
                     # and a different order was previously saved, remove the saved one to revert to actual default
                     if self.config["treeview_columns_display_order"] != ",".join(list(self.file_tree["columns"])):
                         del self.config["treeview_columns_display_order"]
                elif "treeview_columns_display_order" in self.config and current_display_order[0] == "#all":
                     # If it became "#all" but was something else, remove to use default next time
                     del self.config["treeview_columns_display_order"]

            except tk.TclError:
                logger.warning("GUI", "on_closing", "Could not retrieve treeview displaycolumns.")
        
        if hasattr(self, 'master') and self.master.winfo_exists():
            try:
                self.config["window_geometry"] = self.master.geometry()
            except tk.TclError:
                logger.warning("GUI", "on_closing", "Could not retrieve window geometry.")

        if hasattr(self, 'logs_visible_var'):
            self.config["logs_pane_visible"] = self.logs_visible_var.get()
        if hasattr(self, 'device_tools_visible_var'): # Assuming this var exists as per your __init__ setup
            self.config["device_tools_pane_visible"] = self.device_tools_visible_var.get()
        
        if hasattr(self, 'gui_log_filter_level_var'):
            self.config["gui_log_filter_level"] = self.gui_log_filter_level_var.get()

        if hasattr(self, 'loop_playback_var'):
            self.config["loop_playback"] = self.loop_playback_var.get()
        if hasattr(self, 'volume_var'):
            self.config["playback_volume"] = self.volume_var.get()

        # Save current sort state (not the "saved_..." ones which are for loading)
        if hasattr(self, 'treeview_sort_column') and self.treeview_sort_column:
            self.config["treeview_sort_col_id"] = self.treeview_sort_column
            self.config["treeview_sort_descending"] = self.treeview_sort_reverse
        elif "treeview_sort_col_id" in self.config: # Clear if no sort active
            del self.config["treeview_sort_col_id"]
            if "treeview_sort_descending" in self.config:
                del self.config["treeview_sort_descending"]

        save_config(self.config)

        if self.dock and self.dock.is_connected():
            if self.quit_without_prompt_var.get() or messagebox.askokcancel("Quit", "Disconnect HiDock and quit?"):
                self.dock.disconnect()
                self.master.destroy()
            else: logger.info("GUI", "on_closing", "Quit cancelled by user.") # Stay open
        else:
            self.master.destroy()

# --- Main Execution ---
if __name__ == "__main__":
    root = tk.Tk()
    app = None 
    try:
        app = HiDockToolGUI(root)
        root.mainloop()
    except Exception as e:
        print(f"CRITICAL ERROR DURING GUI INITIALIZATION:\n{traceback.format_exc()}")
        try:
            if root and root.winfo_exists(): root.withdraw()
            temp_root = tk.Tk() if not (root and root.winfo_exists()) else None
            if temp_root: temp_root.withdraw()
            messagebox.showerror("Fatal Initialization Error", f"Critical error during startup:\n\n{e}\n\nApp will close. Check console.", parent=temp_root if temp_root else root if root and root.winfo_exists() else None)
            if temp_root and temp_root.winfo_exists(): temp_root.destroy()
        except Exception as e_diag: print(f"Could not display Tkinter error dialog: {e_diag}")
        import sys
        sys.exit(1)