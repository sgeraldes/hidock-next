# USB Protocol Findings — Storage Controller

**Last updated:** 2026-03-30
**Device:** HiDock H1E (VID 0x10D6, PID 0xB00D, Firmware 6.2.5)

## Status: WORKING

All commands verified working via node-usb on Windows:
- `GET_DEVICE_INFO` (cmd=1) — device info + firmware version
- `GET_FILE_COUNT` (cmd=6) — total file count
- `GET_CARD_INFO` (cmd=16) — storage capacity
- `GET_FILE_LIST` (cmd=4) — full file listing (1399 files)
- `TRANSFER_FILE` (cmd=5) — file download
- Clean disconnect + reconnect without device restart

---

## Jensen Message Format

```
Offset  Size  Description
0       2     Sync markers: 0x12 0x34
2       2     Command ID (big-endian)
4       4     Sequence ID (big-endian)
8       1     Checksum length (upper byte of length field)
9       3     Body length (lower 3 bytes, big-endian — 24-bit, NOT 32-bit)
12      N     Body (N = body length)
12+N    C     Checksum (C = checksum length, usually 0)
```

**Critical:** The length field at offset 8-11 is NOT a simple 32-bit body length. The upper byte is the checksum length, and the lower 3 bytes are the body length. Python implementation:
```python
raw_len = struct.unpack(">I", header[8:12])[0]
checksum_len = (raw_len >> 24) & 0xFF
body_len = raw_len & 0x00FFFFFF
total_message_len = 12 + body_len + checksum_len
```

---

## Commands

### GET_DEVICE_INFO (cmd=1)
- Send: 12-byte header, empty body
- Response: 17-byte body
  - `[0]`: unknown
  - `[1-3]`: firmware version (major.minor.patch)
  - `[4-19]`: serial number (16 bytes hex)

### GET_FILE_COUNT (cmd=6)
- Send: 12-byte header, empty body
- Response: 4-byte body — big-endian uint32 file count

### GET_CARD_INFO (cmd=16)
- Send: 12-byte header, empty body
- Response: 12+ byte body
  - `[0-3]`: free space (MiB, big-endian uint32)
  - `[4-7]`: total capacity (MiB, big-endian uint32)
  - `[8-11]`: status (raw uint32)

### GET_FILE_LIST (cmd=4)
- Send: 12-byte header, empty body
- Response: **multiple Jensen messages** (streaming)
  - Each response has cmd=4 in the header
  - First body starts with `0xFF 0xFF` + 4-byte big-endian total file count
  - Remaining body bytes are concatenated file entries
  - Final message has bodyLength=0 (end-of-transmission)
  - Device takes ~90 seconds to prepare and send all data for 1400 files

**File Entry Format** (concatenated, no separators):
```
Offset  Size  Description
0       1     File version (0-5)
1       3     Filename length (big-endian, padded with leading 0x00)
4       N     Filename (ASCII, may contain null bytes — strip them)
4+N     4     File size in bytes (big-endian uint32)
8+N     6     Padding (zeros)
14+N    16    Signature (MD5-like hash, 16 bytes)
```

Each entry is ~57 bytes (27-byte filename + 30 bytes overhead).

### TRANSFER_FILE (cmd=5)
- Send: 12-byte header + filename as ASCII body
- Response: **multiple Jensen messages** (streaming)
  - Each response has cmd=5 in the header
  - Body contains raw file data
  - Final message has bodyLength=0 (end-of-transmission)
  - Accumulate all bodies to get complete file

**Audio Format:** Files are `.hda` on device but are **standard WAV**. Rename to `.wav` — no conversion needed.

### Duration Calculation (version-dependent)
```
v1:    fileLength / 8000
v2:    (fileLength - 44) / (48000 * 2 / 4)
v3:    (fileLength - 44) / (24000 * 2 / 4)
v5:    fileLength / (12000 / 4)
other: fileLength / (16000 * 2 / 4)
```

---

## USB Read Architecture: startPoll (CRITICAL)

### The Problem
Using `endpoint.transfer()` in a manual read loop on Windows causes data loss. The npm `usb` package runs a USB event thread that calls `libusb_handle_events()` in a loop. When a transfer completes, the completion callback uses `BlockingCall` (via `Napi::ThreadSafeFunction`) to notify the Node.js main thread. This **blocks the USB event thread** until Node.js processes the callback.

During this blocked period:
1. No new `transferIn` is pending in the kernel
2. The device sends the next data packet
3. WinUSB has no pending transfer to deliver data to
4. Data is lost or buffered incorrectly

### The Fix: `endpoint.startPoll(N, bufferSize)`
Use `startPoll` instead of manual `transfer()` calls:

```typescript
// WRONG — data loss on Windows
const readNext = () => {
  epIn.transfer(51200, (err, data) => {
    readNext()       // Gap between callback and next submit
    process(data)
  })
}

// CORRECT — no data loss
epIn.startPoll(3, 32768)  // 3 transfers always pending
epIn.on('data', (data) => process(data))
epIn.on('error', (err) => { /* handle */ })
```

`startPoll` keeps N transfers pending in the kernel simultaneously. When one completes, it immediately resubmits — all within the USB event thread, without waiting for a `BlockingCall` round-trip to Node.js.

### Clean Disconnect
```typescript
epIn.stopPoll()                    // Cancel all pending transfers
epIn.once('end', () => {           // Wait for cancellation
  iface.release(true, () => {      // Release interface (true = close endpoints)
    dev.close()                    // Close device
  })
})
```

---

## Device State Behavior

### USB Reconnect Does NOT Reset Firmware
The HiDock H1E has an internal battery. Unplugging/replugging the USB cable does NOT power-cycle the MCU. Evidence: the Jensen sequence counter persists across USB reconnects (e.g., `seq=9` after replug).

### Device Locking
The device enters `LIBUSB_ERROR_ACCESS` state when a process exits with pending USB transfers. This is an OS-level issue (USB interface marked "in use"), not device corruption.

**Recovery — Drain:**
```javascript
dev.open()
iface.claim()
epIn.timeout = 1000
const drain = () => epIn.transfer(51200, (err) => {
  if (err) { iface.release(true, () => dev.close()); return }
  drain()
})
drain()
```

**Prevention:** Always use `stopPoll()` + wait for `'end'` event before `release()`/`close()`.

---

## Comparison: node-usb transfer() vs startPoll vs PyUSB

| Aspect | `transfer()` loop | `startPoll(3)` | PyUSB `device.read()` |
|--------|-------------------|----------------|----------------------|
| **Pending transfers** | 0-1 (gap between callback) | 3 (always) | 1 (synchronous) |
| **Thread model** | USB thread → BlockingCall → Node | USB thread → resubmit → emit | Same thread |
| **File list result** | 1 partial packet, stale data | All 1399 files | All 1397 files |
| **Response time** | 90+ seconds | ~90 seconds (correct) | ~5 seconds |
| **Works on Windows** | NO | YES | YES |

---

## Implementation Notes

### PyUSB Bridge (fallback)
`pyusb-bridge.py` provides a Python subprocess bridge for USB operations via PyUSB. Available as fallback but **no longer needed** since the `startPoll` fix.

### Endpoint Details
- Vendor IDs: `0x10D6` (Actions Semiconductor), `0x3887` (HiDock)
- Product IDs: `0xAF0C` (H1), `0xAF0D/0xB00D` (H1E), `0xAF0E/0xB00E` (P1), `0xAF0F/0x2041` (P1 Mini)
- OUT endpoint: `0x01`
- IN endpoint: `0x82`
- Max packet size: 512 bytes (USB 2.0 bulk)
- Recommended poll buffer: `32768` bytes (wMaxPacketSize × 64)
