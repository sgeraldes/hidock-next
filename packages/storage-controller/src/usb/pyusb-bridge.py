"""PyUSB bridge for HiDock Jensen protocol.

node-usb on Windows returns stale/incorrect data from HiDock devices.
PyUSB + libusb-1.0 works correctly. This script bridges the gap:
Node.js spawns this script, which performs USB operations via PyUSB
and returns results as JSON on stdout.

Usage: python pyusb-bridge.py <command> [args...]
Commands:
  info          — device info + storage + file count
  list          — file list as JSON array
  download <filename> — download file, write raw bytes to stdout
"""

import json
import os
import struct
import sys
import time

# Ensure UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# Add desktop app dir for libusb-1.0.dll
_script_dir = os.path.dirname(os.path.abspath(__file__))
for _up in range(6):
    _candidate = os.path.join(_script_dir, *[".."] * _up, "apps", "desktop")
    if os.path.isfile(os.path.join(_candidate, "libusb-1.0.dll")):
        os.environ["PATH"] = _candidate + ";" + os.environ.get("PATH", "")
        try:
            os.add_dll_directory(_candidate)
        except (AttributeError, OSError):
            pass
        break

import usb.core  # noqa: E402
import usb.util  # noqa: E402

# --- Constants ---
USB_VENDOR_IDS = [0x10D6, 0x3887]
PRODUCT_ID_MODEL = {
    0xAF0C: "H1",
    0xAF0D: "H1E",
    0xB00D: "H1E",
    0xAF0E: "P1",
    0xB00E: "P1",
    0xAF0F: "P1Mini",
    0x2041: "P1Mini",
}

CMD_GET_DEVICE_INFO = 1
CMD_GET_FILE_LIST = 4
CMD_TRANSFER_FILE = 5
CMD_GET_FILE_COUNT = 6
CMD_GET_CARD_INFO = 16


class JensenBridge:
    def __init__(self):
        self.dev = None
        self.ep_out = None
        self.ep_in = None
        self.model = "unknown"
        self.seq = 0

    def connect(self):
        for vid in USB_VENDOR_IDS:
            for pid, model in PRODUCT_ID_MODEL.items():
                dev = usb.core.find(idVendor=vid, idProduct=pid)
                if dev:
                    self.dev = dev
                    self.model = model
                    break
            if self.dev:
                break

        if not self.dev:
            return False

        self.dev.set_configuration()
        cfg = self.dev.get_active_configuration()
        intf = cfg[(0, 0)]

        self.ep_out = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress)
            == usb.util.ENDPOINT_OUT,
        )
        self.ep_in = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress)
            == usb.util.ENDPOINT_IN,
        )
        return self.ep_out is not None and self.ep_in is not None

    def disconnect(self):
        if self.dev:
            usb.util.dispose_resources(self.dev)
            self.dev = None

    def _build_packet(self, cmd, body=b""):
        self.seq += 1
        return struct.pack(">BBHII", 0x12, 0x34, cmd, self.seq, len(body)) + body

    def _send(self, cmd, body=b"", timeout=5000):
        pkt = self._build_packet(cmd, body)
        self.ep_out.write(pkt, timeout=timeout)

    def _recv_one(self, timeout=5000):
        """Receive one Jensen message. Returns (cmd, seq, body) or None."""
        buf = bytearray()
        read_size = self.ep_in.wMaxPacketSize * 64
        deadline = time.time() + timeout / 1000.0

        while time.time() < deadline:
            try:
                data = self.dev.read(self.ep_in.bEndpointAddress, read_size, timeout=200)
                if data:
                    buf.extend(data)
            except usb.core.USBTimeoutError:
                pass

            # Try to parse a Jensen message from buffer
            if len(buf) >= 12:
                pos = 0
                while pos < len(buf) - 1:
                    if buf[pos] == 0x12 and buf[pos + 1] == 0x34:
                        break
                    pos += 1
                if pos > 0:
                    buf = buf[pos:]

                if len(buf) >= 12 and buf[0] == 0x12 and buf[1] == 0x34:
                    cmd_id = struct.unpack(">H", buf[2:4])[0]
                    seq_id = struct.unpack(">I", buf[4:8])[0]
                    raw_len = struct.unpack(">I", buf[8:12])[0]
                    body_len = raw_len & 0x00FFFFFF
                    chk_len = (raw_len >> 24) & 0xFF
                    total = 12 + body_len + chk_len

                    if len(buf) >= total:
                        body = bytes(buf[12 : 12 + body_len])
                        return (cmd_id, seq_id, body)

        return None

    def get_device_info(self):
        self._send(CMD_GET_DEVICE_INFO)
        result = self._recv_one()
        if not result or len(result[2]) < 4:
            return None
        b = result[2]
        version = f"{b[1]}.{b[2]}.{b[3]}"
        serial = ""
        if len(b) >= 20:
            serial = bytes(b[4:20]).hex()
        return {"version": version, "serial": serial, "model": self.model}

    def get_file_count(self):
        self._send(CMD_GET_FILE_COUNT)
        result = self._recv_one()
        if not result or len(result[2]) < 4:
            return 0
        return struct.unpack(">I", result[2][:4])[0]

    def get_card_info(self):
        self._send(CMD_GET_CARD_INFO)
        result = self._recv_one()
        if not result or len(result[2]) < 12:
            return None
        b = result[2]
        free = struct.unpack(">I", b[0:4])[0]
        capacity = struct.unpack(">I", b[4:8])[0]
        return {"totalMiB": capacity, "usedMiB": capacity - free, "freeMiB": free}

    def list_files(self, timeout_s=300):
        self._send(CMD_GET_FILE_LIST)

        chunks = []
        cons_timeouts = 0
        read_size = self.ep_in.wMaxPacketSize * 64
        t0 = time.time()
        recv_buf = bytearray()

        while time.time() - t0 < timeout_s:
            try:
                data = self.dev.read(self.ep_in.bEndpointAddress, read_size, timeout=3000)
                if data:
                    recv_buf.extend(data)
                    cons_timeouts = 0
            except usb.core.USBTimeoutError:
                cons_timeouts += 1
                if cons_timeouts >= 10 and recv_buf:
                    break
                continue

            # Parse Jensen messages from buffer
            while len(recv_buf) >= 12:
                # Find sync
                pos = 0
                while pos < len(recv_buf) - 1:
                    if recv_buf[pos] == 0x12 and recv_buf[pos + 1] == 0x34:
                        break
                    pos += 1
                if pos > 0:
                    recv_buf = recv_buf[pos:]

                if len(recv_buf) < 12:
                    break
                if recv_buf[0] != 0x12 or recv_buf[1] != 0x34:
                    break

                raw_len = struct.unpack(">I", recv_buf[8:12])[0]
                body_len = raw_len & 0x00FFFFFF
                chk_len = (raw_len >> 24) & 0xFF
                total = 12 + body_len + chk_len

                if len(recv_buf) < total:
                    break  # Wait for more data

                body = bytes(recv_buf[12 : 12 + body_len])
                recv_buf = recv_buf[total:]

                if body_len == 0:
                    # End of file list
                    return self._parse_entries(chunks)

                chunks.append(body)

        return self._parse_entries(chunks)

    def _parse_entries(self, chunks):
        if not chunks:
            return []

        buf = b"".join(chunks)
        pos = 0

        # Skip 0xFF 0xFF header
        if len(buf) >= 6 and buf[0] == 0xFF and buf[1] == 0xFF:
            pos = 6

        entries = []
        while pos < len(buf):
            if pos + 4 > len(buf):
                break

            version = buf[pos]
            pos += 1

            if pos + 3 > len(buf):
                break
            name_len = struct.unpack(">I", b"\x00" + buf[pos : pos + 3])[0]
            pos += 3

            if name_len <= 0 or name_len > 200 or pos + name_len > len(buf):
                break
            filename = buf[pos : pos + name_len].rstrip(b"\x00").decode("ascii", errors="ignore")
            pos += name_len

            if pos + 4 > len(buf):
                break
            file_length = struct.unpack(">I", buf[pos : pos + 4])[0]
            pos += 4

            if pos + 6 > len(buf):
                break
            pos += 6  # padding

            if pos + 16 > len(buf):
                break
            signature = buf[pos : pos + 16].hex()
            pos += 16

            duration = self._calc_duration(file_length, version)

            entries.append(
                {
                    "filename": filename,
                    "size": file_length,
                    "version": version,
                    "signature": signature,
                    "duration": duration,
                }
            )

        return entries

    def _calc_duration(self, file_length, version):
        if version == 1:
            return file_length / 8000
        elif version == 2:
            return (file_length - 44) / ((48000 * 2 * 1) / 4)
        elif version == 3:
            return (file_length - 44) / ((24000 * 2 * 1) / 4)
        elif version == 5:
            return file_length / (12000 / 4)
        else:
            return file_length / ((16000 * 2 * 1) / 4)

    def download_file(self, filename, file_size, timeout_s=300):
        body = filename.encode("ascii")
        self._send(CMD_TRANSFER_FILE, body)

        chunks = []
        received = 0
        cons_timeouts = 0
        read_size = self.ep_in.wMaxPacketSize * 64
        t0 = time.time()
        recv_buf = bytearray()

        while time.time() - t0 < timeout_s:
            try:
                data = self.dev.read(self.ep_in.bEndpointAddress, read_size, timeout=3000)
                if data:
                    recv_buf.extend(data)
                    cons_timeouts = 0
            except usb.core.USBTimeoutError:
                cons_timeouts += 1
                if cons_timeouts >= 10 and received > 0:
                    break
                continue

            # Parse Jensen messages
            while len(recv_buf) >= 12:
                pos = 0
                while pos < len(recv_buf) - 1:
                    if recv_buf[pos] == 0x12 and recv_buf[pos + 1] == 0x34:
                        break
                    pos += 1
                if pos > 0:
                    recv_buf = recv_buf[pos:]

                if len(recv_buf) < 12 or recv_buf[0] != 0x12 or recv_buf[1] != 0x34:
                    break

                raw_len = struct.unpack(">I", recv_buf[8:12])[0]
                body_len = raw_len & 0x00FFFFFF
                chk_len = (raw_len >> 24) & 0xFF
                total = 12 + body_len + chk_len

                if len(recv_buf) < total:
                    break

                body = bytes(recv_buf[12 : 12 + body_len])
                recv_buf = recv_buf[total:]

                if body_len == 0:
                    return b"".join(chunks)

                chunks.append(body)
                received += body_len

                if received >= file_size:
                    return b"".join(chunks)

        return b"".join(chunks) if chunks else None


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: pyusb-bridge.py <command> [args...]"}))
        sys.exit(1)

    command = sys.argv[1]
    bridge = JensenBridge()

    if not bridge.connect():
        print(json.dumps({"error": "Device not found"}))
        sys.exit(1)

    try:
        if command == "info":
            info = bridge.get_device_info()
            card = bridge.get_card_info()
            count = bridge.get_file_count()
            result = {**(info or {}), **(card or {}), "fileCount": count, "deviceConnected": True}
            print(json.dumps(result))

        elif command == "list":
            entries = bridge.list_files()
            print(json.dumps(entries))

        elif command == "download":
            if len(sys.argv) < 3:
                print(json.dumps({"error": "Usage: download <filename>"}))
                sys.exit(1)
            filename = sys.argv[2]
            # Get file size from list first
            entries = bridge.list_files()
            entry = next((e for e in entries if e["filename"] == filename), None)
            if not entry:
                print(json.dumps({"error": f"File not found: {filename}"}))
                sys.exit(1)
            data = bridge.download_file(filename, entry["size"])
            if data:
                sys.stdout.buffer.write(data)
            else:
                print(json.dumps({"error": "Download failed"}), file=sys.stderr)
                sys.exit(1)

        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
            sys.exit(1)

    finally:
        bridge.disconnect()


if __name__ == "__main__":
    main()
