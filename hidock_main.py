import usb.core
import usb.util
import time
import struct
from datetime import datetime

# --- Constants ---
VENDOR_ID = 0x1395
PRODUCT_ID = 0x005C # From your driver info

# Target endpoints based on jensen.js (endpoint numbers within an interface)
# PyUSB uses the full bEndpointAddress, so 0x01 for OUT, 0x80 | 0x02 = 0x82 for IN
EP_OUT_ADDR_REQUEST = 0x01
EP_IN_ADDR_REQUEST = 0x82 # Physical endpoint 0x02, IN direction

# Command IDs from jensen.js analysis
CMD_GET_DEVICE_INFO = 1
CMD_GET_DEVICE_TIME = 2
CMD_SET_DEVICE_TIME = 3
CMD_GET_FILE_LIST = 4
CMD_TRANSFER_FILE = 5  # Streaming
CMD_GET_FILE_COUNT = 6
CMD_DELETE_FILE = 7
CMD_GET_FILE_BLOCK = 13
# ... add other command IDs as needed


# --- Logger ---
class Logger:
    def _log(self, level_str, module, procedure, message):
        print(f"[{level_str.upper()}] {module}::{procedure} - {message}")

    def info(self, module, procedure, message):
        self._log("info", module, procedure, message)

    def debug(self, module, procedure, message):
        self._log("debug", module, procedure, message)

    def error(self, module, procedure, message):
        self._log("error", module, procedure, message)

    def warning(self, module, procedure, message):
        self._log("warning", module, procedure, message)

logger = Logger()


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
        self.claimed_interface = -1

    def _find_device(self):
        logger.debug("Jensen", "_find_device", f"Looking for VID={hex(VENDOR_ID)}, PID={hex(PRODUCT_ID)}")
        device = usb.core.find(idVendor=VENDOR_ID, idProduct=PRODUCT_ID)
        if device is None:
            raise ValueError(f"HiDock device (VID={hex(VENDOR_ID)}, PID={hex(PRODUCT_ID)}) not found. Ensure it's connected and you have permissions.")
        logger.debug("Jensen", "_find_device", f"Device found: {device.product} by {device.manufacturer}")
        return device

    def list_device_details(self):
        temp_device = None
        try:
            temp_device = self._find_device()
            logger.info("Jensen", "list_device_details", f"Device: {temp_device.product} (VID={hex(temp_device.idVendor)}, PID={hex(temp_device.idProduct)})")
            for cfg_idx, cfg in enumerate(temp_device):
                logger.info("Jensen", "list_device_details", f"  Configuration {cfg.bConfigurationValue} (Index {cfg_idx}):")
                for intf_idx, intf in enumerate(cfg):
                    logger.info("Jensen", "list_device_details", f"    Interface {intf.bInterfaceNumber}, Alternate Setting {intf.bAlternateSetting} (Index {intf_idx}):")
                    logger.info("Jensen", "list_device_details", f"      Interface Class: {intf.bInterfaceClass}, SubClass: {intf.bInterfaceSubClass}, Protocol: {intf.bInterfaceProtocol}")
                    for ep_idx, ep in enumerate(intf):
                        ep_dir = "OUT" if usb.util.endpoint_direction(ep.bEndpointAddress) == usb.util.ENDPOINT_OUT else "IN"
                        ep_type_val = usb.util.endpoint_type(ep.bmAttributes)
                        ep_type_str = {
                            usb.util.ENDPOINT_TYPE_CONTROL: "Control",
                            usb.util.ENDPOINT_TYPE_ISO: "Isochronous",
                            usb.util.ENDPOINT_TYPE_BULK: "Bulk",
                            usb.util.ENDPOINT_TYPE_INTERRUPT: "Interrupt"
                        }.get(ep_type_val, f"Unknown ({ep_type_val})")
                        logger.info("Jensen", "list_device_details", f"        Endpoint Address: {hex(ep.bEndpointAddress)} ({ep_dir}), Type: {ep_type_str}, MaxPacketSize: {ep.wMaxPacketSize} (Index {ep_idx})")
        except usb.core.USBError as e:
            logger.error("Jensen", "list_device_details", f"USBError while listing details: {e}")
            if e.errno == 13: # Access denied
                 logger.error("Jensen", "list_device_details", "This might be a permissions issue. Try running as administrator/sudo or check udev rules (Linux).")
        except ValueError as e:
            logger.error("Jensen", "list_device_details", f"ValueError (device not found?): {e}")
        except Exception as e:
            logger.error("Jensen", "list_device_details", f"Unexpected error while listing details: {e}")
        finally:
            if temp_device:
                usb.util.dispose_resources(temp_device)


    def connect(self, target_interface_number=0):
        if self.device:
            logger.info("Jensen", "connect", "Device object already exists. Disconnecting before reconnecting.")
            self.disconnect()

        self.device = self._find_device()

        # Detach kernel driver if active (primarily for Linux/macOS)
        try:
            if self.device.is_kernel_driver_active(target_interface_number):
                self.device.detach_kernel_driver(target_interface_number)
                logger.info("Jensen", "connect", f"Detached kernel driver from Interface {target_interface_number}.")
        except usb.core.USBError as e:
            logger.info("Jensen", "connect", f"Could not detach kernel driver from Interface {target_interface_number}: {e} (This might be ignorable on Windows)")
        except NotImplementedError:
            logger.info("Jensen", "connect", "Kernel driver detach not implemented/needed on this platform (Windows).")

        try:
            self.device.set_configuration()
            logger.info("Jensen", "connect", "Device configuration set.")
        except usb.core.USBError as e:
            if e.errno == 16: # Resource busy (LIBUSB_ERROR_BUSY)
                logger.info("Jensen", "connect", "Configuration already set or interface busy (this is often OK).")
            else:
                logger.error("Jensen", "connect", f"Could not set configuration: {e} (errno: {e.errno})")
                raise # Re-raise if it's not just "busy"

        cfg = self.device.get_active_configuration()
        intf = None
        try:
            # Attempt to get the specific interface number
            intf = usb.util.find_descriptor(cfg, bInterfaceNumber=target_interface_number)
            if intf is None: # Should not happen if find_descriptor doesn't raise error, but check anyway
                 raise usb.core.USBError(f"Interface {target_interface_number} found but is None.")
            logger.info("Jensen", "connect", f"Found Interface {intf.bInterfaceNumber}, Alternate Setting {intf.bAlternateSetting}")
        except usb.core.USBError as e:
            logger.error("Jensen", "connect", f"Could not find Interface {target_interface_number}: {e}")
            raise ValueError(f"Interface {target_interface_number} not found in active configuration.")

        # Try to claim the interface
        try:
            usb.util.claim_interface(self.device, intf.bInterfaceNumber)
            self.claimed_interface = intf.bInterfaceNumber
            logger.info("Jensen", "connect", f"Claimed Interface {self.claimed_interface}")
        except usb.core.USBError as e:
            logger.error("Jensen", "connect", f"Could not claim Interface {intf.bInterfaceNumber}: {e} (errno: {e.errno})")
            if e.errno == 16: # LIBUSB_ERROR_BUSY
                 logger.error("Jensen", "connect", "Interface busy. Another program (e.g. browser WebUSB) or driver might be using it. On Windows, Zadig might be needed for this interface.")
            raise

        # Find endpoints on the *claimed* interface
        self.ep_out = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_OUT and \
                                   (e.bEndpointAddress & 0x0F) == (EP_OUT_ADDR_REQUEST & 0x0F)
        )
        self.ep_in = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_IN and \
                                   (e.bEndpointAddress & 0x0F) == (EP_IN_ADDR_REQUEST & 0x7F) # Mask out direction bit for IN
        )

        if self.ep_out is None or self.ep_in is None:
            logger.warning("Jensen", "connect", f"Specific endpoints {hex(EP_OUT_ADDR_REQUEST)}/{hex(EP_IN_ADDR_REQUEST)} not found on Interface {target_interface_number}. Trying first available bulk endpoints.")
            self.ep_out = usb.util.find_descriptor(
                intf,
                custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_OUT and \
                                           usb.util.endpoint_type(e.bmAttributes) == usb.util.ENDPOINT_TYPE_BULK
            )
            self.ep_in = usb.util.find_descriptor(
                intf,
                custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_IN and \
                                           usb.util.endpoint_type(e.bmAttributes) == usb.util.ENDPOINT_TYPE_BULK
            )

        if self.ep_out is None or self.ep_in is None:
            raise ValueError(f"Could not find suitable IN/OUT bulk endpoints on Interface {target_interface_number}.")

        logger.info("Jensen", "connect", f"Using Interface {target_interface_number}. EP_OUT: {hex(self.ep_out.bEndpointAddress)}, EP_IN: {hex(self.ep_in.bEndpointAddress)}")

        # Model determination
        if self.device.idProduct == 0xAF0C: self.model = "hidock-h1"        # 45068
        elif self.device.idProduct == 0xAF0D: self.model = "hidock-h1e"     # 45069
        elif self.device.idProduct == 0xAF0E: self.model = "hidock-p1"      # 45070
        elif self.device.idProduct == PRODUCT_ID : self.model = "HiDock H1E (PID_005C)"
        else: self.model = f"unknown (PID: {hex(self.device.idProduct)})"
        logger.info("Jensen", "connect", f"Device model determined as: {self.model}")
        return True

    def disconnect(self):
        if self.device:
            if self.claimed_interface != -1:
                try:
                    usb.util.release_interface(self.device, self.claimed_interface)
                    logger.info("Jensen", "disconnect", f"Released interface {self.claimed_interface}.")
                    self.claimed_interface = -1
                except Exception as e:
                    logger.info("Jensen", "disconnect", f"Could not release interface: {e}")
            try:
                # This re-attaches the kernel driver if it was detached
                self.device.attach_kernel_driver(0) # Try for interface 0, might need to be specific if changed
            except Exception as e:
                 logger.info("Jensen", "disconnect", f"Could not re-attach kernel driver: {e} (often ignorable).")

            usb.util.dispose_resources(self.device)
            self.device = None
            self.ep_out = None
            self.ep_in = None
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
            raise ConnectionError("Device not connected or output endpoint not found.")
        packet = self._build_packet(command_id, body_bytes)
        logger.debug("Jensen", "_send_command", f"Sending CMD: {command_id}, Seq: {self.sequence_id}, Len: {len(body_bytes)}, Data: {packet.hex()[:64]}...")
        try:
            bytes_sent = self.ep_out.write(packet, timeout=timeout_ms)
            if bytes_sent != len(packet):
                logger.warning("Jensen", "_send_command", f"Bytes sent ({bytes_sent}) does not match packet length ({len(packet)}) for CMD {command_id}.")
        except usb.core.USBError as e:
            logger.error("Jensen", "_send_command", f"USB write error for CMD {command_id}: {e} (errno: {e.errno})")
            if e.errno == 32: # LIBUSB_ERROR_PIPE / EPIPE (Stall)
                try:
                    self.device.clear_halt(self.ep_out.bEndpointAddress)
                    logger.info("Jensen", "_send_command", "Cleared halt on EP_OUT")
                except Exception as ce:
                    logger.error("Jensen", "_send_command", f"Failed to clear halt: {ce}")
            raise
        return self.sequence_id

    def _receive_response(self, expected_seq_id, timeout_ms=5000):
        if not self.device or not self.ep_in:
            raise ConnectionError("Device not connected or input endpoint not found.")

        start_time = time.time()
        while time.time() - start_time < (timeout_ms / 1000.0):
            try:
                # Max packet size is usually 64 for Full Speed bulk, or 512 for High Speed
                # Reading a larger amount to reduce number of calls
                read_attempt_size = self.ep_in.wMaxPacketSize * 8 # Read up to 8 max packets
                data = self.device.read(self.ep_in.bEndpointAddress, read_attempt_size, timeout=100)
                if data:
                    self.receive_buffer.extend(data)
                    logger.debug("Jensen", "_receive_response", f"Rcvd chunk: {bytes(data).hex()[:64]}... Buf len: {len(self.receive_buffer)}")
            except usb.core.USBTimeoutError:
                pass # No data in this poll, continue
            except usb.core.USBError as e:
                logger.error("Jensen", "_receive_response", f"USB read error: {e} (errno: {e.errno})")
                if e.errno == 32: # Stall
                    try:
                        self.device.clear_halt(self.ep_in.bEndpointAddress)
                        logger.info("Jensen", "_receive_response", "Cleared halt on EP_IN")
                    except Exception as ce:
                        logger.error("Jensen", "_receive_response", f"Failed to clear halt: {ce}")
                # For other errors, may need to decide if it's fatal
                return None # Or raise

            # Try to parse a complete message from the buffer
            while len(self.receive_buffer) >= 12: # Min header size
                if self.receive_buffer[0] != 0x12 or self.receive_buffer[1] != 0x34:
                    logger.error("Jensen", "_receive_response", f"Invalid header: {self.receive_buffer[:2].hex()}. Discarding 1 byte.")
                    self.receive_buffer.pop(0)
                    continue

                # Correct unpacking for H H I I (unsigned short, unsigned short, unsigned int, unsigned int)
                # Command ID (H), Sequence ID (I), Body Length (I)
                header_prefix = self.receive_buffer[:12]
                response_cmd_id = struct.unpack('>H', header_prefix[2:4])[0]
                response_seq_id = struct.unpack('>I', header_prefix[4:8])[0]
                body_len_from_header = struct.unpack('>I', header_prefix[8:12])[0]
                # checksum_len = (body_len_from_header >> 24) & 0xFF # From jensen.js M >> 24 & 255;
                # body_len = body_len_from_header & 0xFFFFFF # From jensen.js M &= 16777215;
                # For now, assuming checksum_len is 0 and body_len is direct
                body_len = body_len_from_header
                checksum_len = 0 # Assuming 0 for now as in most jensen.js handlers

                total_msg_len = 12 + body_len + checksum_len

                if len(self.receive_buffer) >= total_msg_len:
                    msg_bytes_full = self.receive_buffer[:total_msg_len]
                    self.receive_buffer = self.receive_buffer[total_msg_len:]

                    if response_seq_id == expected_seq_id:
                        logger.debug("Jensen", "_receive_response", f"RSP for CMD: {response_cmd_id}, Seq: {response_seq_id}, BodyLen: {body_len}, Body: {msg_bytes_full[12:12+body_len].hex()[:64]}...")
                        return {"id": response_cmd_id, "sequence": response_seq_id, "body": msg_bytes_full[12:12+body_len]}
                    else:
                        logger.warning("Jensen", "_receive_response", f"Seq ID mismatch. Expected: {expected_seq_id}, Got: {response_seq_id}. Discarding.")
                else:
                    break # Not enough data for this message yet
            
            if time.time() - start_time > (timeout_ms / 1000.0):
                break # Overall timeout for the command response

        logger.warning("Jensen", "_receive_response", f"Timeout waiting for response to seq_id {expected_seq_id}. Buffer: {self.receive_buffer.hex()}")
        return None

    def _send_and_receive(self, command_id, body_bytes=b'', timeout_ms=5000):
        seq_id = self._send_command(command_id, body_bytes, timeout_ms)
        return self._receive_response(seq_id, timeout_ms)

    # --- Device Interaction Methods (Ported from jensen.js) ---

    def get_device_info(self, timeout_s=5):
        response = self._send_and_receive(CMD_GET_DEVICE_INFO, timeout_ms=timeout_s * 1000)
        if response and response["id"] == CMD_GET_DEVICE_INFO:
            body = response["body"]
            if len(body) >= 20:
                version_code_bytes = body[:4]
                version_code = ".".join(map(str, version_code_bytes[1:])) # Assuming first byte is major, rest minor etc.
                version_number = struct.unpack('>I', version_code_bytes)[0] # Or parse differently
                
                serial_number_bytes = body[4:20]
                try:
                    serial_number = serial_number_bytes.decode('ascii').rstrip('\x00')
                except UnicodeDecodeError:
                    serial_number = serial_number_bytes.hex()

                self.device_info = {
                    "versionCode": version_code,
                    "versionNumber": version_number,
                    "sn": serial_number
                }
                logger.info("Jensen", "get_device_info", f"Device Info: {self.device_info}")
                return self.device_info
        logger.error("Jensen", "get_device_info", "Failed to get device info or invalid response.")
        return None

    def get_file_count(self, timeout_s=5):
        response = self._send_and_receive(CMD_GET_FILE_COUNT, timeout_ms=timeout_s * 1000)
        if response and response["id"] == CMD_GET_FILE_COUNT:
            body = response["body"]
            if not body: return {"count": 0} # Empty body means 0 count
            if len(body) >= 4:
                count = struct.unpack('>I', body[:4])[0]
                logger.info("Jensen", "get_file_count", f"File count: {count}")
                return {"count": count}
        logger.error("Jensen", "get_file_count", "Failed to get file count or invalid response.")
        return None

    def list_files(self, timeout_s=20): # Increased timeout for potentially large list
        if not self.device_info.get("versionNumber"):
            logger.info("Jensen", "list_files", "Device info not available, fetching...")
            self.get_device_info()
            if not self.device_info.get("versionNumber"):
                 logger.error("Jensen", "list_files", "Still no device info after attempting fetch.")
                 return None

        file_list_aggregate_data = bytearray()
        expected_files_from_count_cmd = -1

        if self.device_info.get("versionNumber", float('inf')) <= 327722:
            count_info = self.get_file_count(timeout_s=5)
            if not count_info or count_info.get("count", -1) == 0:
                logger.info("Jensen", "list_files", "No files based on early count or count failed.")
                return []
            expected_files_from_count_cmd = count_info["count"]

        logger.info("Jensen", "list_files", "Requesting file list...")
        # The promise/handler for file list in jensen.js is complex because it aggregates
        # potentially multiple USB packets that make up the response to a single CMD_GET_FILE_LIST.
        # Here, _send_and_receive will try to read until timeout or expected sequence.
        # If file list is huge, it might need to be broken into multiple CMD_GET_FILE_LIST
        # requests with offsets, or the device sends it in one logical response (multiple USB packets).
        # Assuming one logical response that _receive_response will buffer.
        response = self._send_and_receive(CMD_GET_FILE_LIST, timeout_ms=timeout_s * 1000)

        if not response or response["id"] != CMD_GET_FILE_LIST:
            logger.error("Jensen", "list_files", "Failed to get file list or wrong response ID.")
            return None
        
        file_list_aggregate_data.extend(response["body"])

        # Parsing logic from s.handlers[4]
        files = []
        offset = 0
        data_view = memoryview(file_list_aggregate_data)

        total_files_from_header = -1
        if len(data_view) >= 6 and data_view[offset] == 0xFF and data_view[offset+1] == 0xFF:
            total_files_from_header = struct.unpack('>I', data_view[offset+2:offset+6])[0]
            offset += 6
            logger.debug("Jensen", "list_files_parser", f"Total files from list header: {total_files_from_header}")

        logger.debug("Jensen", "list_files_parser", f"Parsing {len(data_view)} bytes, starting at offset {offset}")

        while offset < len(data_view):
            try:
                if offset + 4 > len(data_view): logger.debug("Parser", "list_files", "Not enough data for version+name_len"); break
                file_version = data_view[offset]
                offset += 1
                name_len_bytes = data_view[offset:offset+3]
                name_len = struct.unpack('>I', b'\x00' + name_len_bytes)[0]
                offset += 3

                if offset + name_len > len(data_view): logger.debug("Parser", "list_files", "Not enough data for name"); break
                filename_bytes = data_view[offset : offset + name_len]
                filename = "".join(chr(b) for b in filename_bytes if b > 0)
                offset += name_len
                
                # file_length, 6 unknown bytes, 16 signature bytes
                min_remaining_for_entry_suffix = 4 + 6 + 16
                if offset + min_remaining_for_entry_suffix > len(data_view):
                    logger.debug("Parser", "list_files", f"Not enough data for rest of entry. Need {min_remaining_for_entry_suffix}, have {len(data_view) - offset}")
                    break

                file_length_bytes = struct.unpack('>I', data_view[offset : offset + 4])[0]
                offset += 4
                offset += 6 # Skip 6 unknown/padding bytes
                
                signature_bytes = data_view[offset : offset + 16]
                signature_hex = signature_bytes.hex()
                offset += 16

                create_date_str, create_time_str, time_obj, duration_sec = "", "", None, 0

                if filename.endswith(".wav") and filename.startswith(tuple(str(y) for y in range(10))) and "REC" in filename:
                    try:
                        ts_str = filename[:14]
                        time_obj = datetime.strptime(ts_str, "%Y%m%d%H%M%S")
                    except ValueError: pass
                # Simplified other date parsing - jensen.js has more complex regex
                elif (filename.endswith(".hda") or filename.endswith(".wav")):
                    # Placeholder - actual date parsing here would be complex
                    pass

                if time_obj:
                    create_date_str = time_obj.strftime("%Y/%m/%d")
                    create_time_str = time_obj.strftime("%H:%M:%S")

                if file_version == 1: duration_sec = (file_length_bytes / 32) * 2
                elif file_version == 2: duration_sec = (file_length_bytes - 44) / 48 / 2 # WAV PCM
                elif file_version == 3: duration_sec = (file_length_bytes - 44) / 48 / 2 / 2 # WAV ADPCM
                elif file_version == 5: duration_sec = file_length_bytes / 12 # .hda
                else: duration_sec = file_length_bytes / 32 # Default from jensen.js for .wav

                files.append({
                    "name": filename, "createDate": create_date_str, "createTime": create_time_str,
                    "time": time_obj, "duration": duration_sec, "version": file_version,
                    "length": file_length_bytes, "signature": signature_hex
                })
                
                # Check against either count
                if total_files_from_header != -1 and len(files) >= total_files_from_header: break
                if expected_files_from_count_cmd != -1 and len(files) >= expected_files_from_count_cmd: break

            except struct.error as e:
                logger.error("Jensen", "list_files_parser", f"Struct error: {e}. Offset: {offset}, Buf len: {len(data_view)}")
                break
            except IndexError as e:
                logger.error("Jensen", "list_files_parser", f"Index error: {e}. Offset: {offset}, Buf len: {len(data_view)}")
                break
        
        logger.info("Jensen", "list_files", f"Parsed {len(files)} files from list.")
        return [f for f in files if f.get("time")] # Filter as in jensen.js

    def stream_file(self, filename, file_length, data_callback, progress_callback=None, timeout_s=120):
        logger.info("Jensen", "stream_file", f"Streaming {filename}, length {file_length}")
        filename_bytes = filename.encode('ascii') # Or appropriate encoding

        # Send initial command to start streaming
        seq_id = self._send_command(CMD_TRANSFER_FILE, filename_bytes, timeout_ms=5000) # Short timeout for initial command

        bytes_received = 0
        start_time = time.time()
        
        # Loop to receive data packets
        while bytes_received < file_length and time.time() - start_time < timeout_s:
            # _receive_response now handles its own internal timeout for each read attempt
            # and accumulates into self.receive_buffer, then parses.
            # The seq_id here is for the *initial* command. The device might send data packets
            # without new sequence numbers if they are considered part of the response to CMD_TRANSFER_FILE
            # Or it might send them as new messages with CMD_TRANSFER_FILE ID and matching seq_id.
            # jensen.js s.handlers[5] implies it's part of the response flow for the original seq_id.
            response = self._receive_response(seq_id, timeout_ms=10000) # Longer timeout for data chunks

            if response and response["id"] == CMD_TRANSFER_FILE:
                chunk = response["body"]
                if not chunk: # Empty body might signify end or an issue.
                    logger.warning("Jensen", "stream_file", "Received empty chunk.")
                    if bytes_received >= file_length: # If we got everything, it's fine
                        break
                    # Otherwise, this might be an error or premature end from device.
                    # jensen.js handler for cmd 5 returns "OK" if h >= t, implying empty chunks don't fail if done.
                    # If not done, it implies more data should come or it's a fail.
                    # Let the outer timeout or length check handle it.
                    continue


                bytes_received += len(chunk)
                data_callback(chunk)
                if progress_callback:
                    progress_callback(bytes_received, file_length)
                
                if bytes_received >= file_length:
                    logger.info("Jensen", "stream_file", f"File {filename} streamed successfully.")
                    return "OK"
            elif response is None: # Timeout or error from _receive_response
                logger.error("Jensen", "stream_file", f"Failed to receive next chunk for {filename} (seq_id {seq_id}).")
                return "fail"
            else: # Wrong command ID or sequence
                logger.warning("Jensen", "stream_file", f"Unexpected response ID {response['id']} or sequence {response['sequence']} during stream.")
                # This could be problematic; how does jensen.js handle this? It filters by command ID.

        if bytes_received < file_length:
            logger.error("Jensen", "stream_file", f"Streaming incomplete for {filename}. Received {bytes_received}/{file_length}")
            return "fail"
        return "OK"

# --- Main Execution ---
if __name__ == "__main__":
    # IMPORTANT: Change this to the interface number that has EP 0x01 (OUT) and 0x02 (IN, becomes 0x82)
    # You find this by running the script once, looking at `list_device_details` output,
    # then setting this value, and then potentially using Zadig if it still fails.
    # Interface 0 is what jensen.js claims.
    TARGET_INTERFACE_FOR_JENSEN_PROTOCOL = 0

    dock = HiDockJensen()
    try:
        logger.info("__main__", "main", "Listing all device details first...")
        dock.list_device_details() # This just prints info, doesn't fully connect/claim
        print("-" * 40)

        logger.info("__main__", "main", f"Attempting to connect to HiDock on Interface {TARGET_INTERFACE_FOR_JENSEN_PROTOCOL}...")
        if dock.connect(target_interface_number=TARGET_INTERFACE_FOR_JENSEN_PROTOCOL):
            logger.info("__main__", "main", f"Successfully connected to HiDock Interface {TARGET_INTERFACE_FOR_JENSEN_PROTOCOL}.")
            logger.info("__main__", "main", f"Device: {dock.device.product}, Model: {dock.model}")

            device_info = dock.get_device_info()
            if device_info:
                logger.info("__main__", "main", f"Device Info: {device_info}")
            else:
                logger.error("__main__", "main", "Failed to get device info. Exiting.")
                exit()

            file_count_info = dock.get_file_count()
            if file_count_info:
                logger.info("__main__", "main", f"File Count: {file_count_info['count']}")
            else:
                logger.error("__main__", "main", "Failed to get file count.")
            
            if file_count_info and file_count_info.get('count', 0) > 0:
                files = dock.list_files()
                if files:
                    logger.info("__main__", "main", f"Found {len(files)} files:")
                    for idx, f_info in enumerate(files):
                        logger.info("__main__", "main", f"  [{idx+1}] Name: {f_info['name']}, Length: {f_info['length']}, Duration: {f_info['duration']:.2f}s, Time: {f_info['time']}")
                    
                    if files:
                        first_file = files[0]
                        logger.info("__main__", "main", f"Attempting to stream file: {first_file['name']} ({first_file['length']} bytes)")
                        
                        output_filename = f"downloaded_{first_file['name'].replace(':','-').replace(' ','_')}" # Sanitize filename
                        try:
                            with open(output_filename, "wb") as outfile:
                                def data_cb(chunk):
                                    outfile.write(chunk)

                                def progress_cb(received, total):
                                    percent = (received / total) * 100 if total > 0 else 0
                                    print(f"\rDownloading {first_file['name']}: {received}/{total} bytes ({percent:.2f}%)", end="")

                                status = dock.stream_file(
                                    first_file['name'],
                                    first_file['length'],
                                    data_cb,
                                    progress_cb,
                                    timeout_s=180 # Increased timeout for larger files
                                )
                                print() 
                                if status == "OK":
                                    logger.info("__main__", "main", f"File {output_filename} download appears successful.")
                                else:
                                    logger.error("__main__", "main", f"Failed to download {first_file['name']}. Status: {status}")
                        except Exception as e_file:
                             logger.error("__main__", "main", f"Error during file operation for {output_filename}: {e_file}")
                else:
                    logger.info("__main__", "main", "Failed to list files or no parsable files found.")
            elif file_count_info:
                logger.info("__main__", "main", "No files on device according to count.")

    except ValueError as e:
        logger.error("__main__", "main", f"ValueError: {e}")
    except usb.core.USBError as e:
        if e.errno == 13: # LIBUSB_ERROR_ACCESS
            logger.error("__main__", "main", f"USBError: Access denied (permission issue). errno: {e.errno}. Try running as administrator/sudo or check udev rules (Linux) / Zadig for WinUSB (Windows) on the correct interface.")
        elif e.errno == 16: # LIBUSB_ERROR_BUSY
             logger.error("__main__", "main", f"USBError: Device or resource busy. errno: {e.errno}. Is another program (like the browser tab) using it? Or does the interface need a generic driver via Zadig?")
        elif e.errno == 5: # LIBUSB_ERROR_NOT_FOUND or EIO
            logger.error("__main__", "main", f"USBError: Input/Output Error or Not Found (errno 5). This can happen if the driver isn't suitable for PyUSB. On Windows, Zadig (WinUSB) for the target interface is usually required.")
        else:
            logger.error("__main__", "main", f"USBError: {e}. errno: {e.errno}")
    except Exception as e:
        import traceback
        logger.error("__main__", "main", f"An unexpected error occurred: {e}\n{traceback.format_exc()}")
    finally:
        dock.disconnect()
        logger.info("__main__", "main", "Program finished.")