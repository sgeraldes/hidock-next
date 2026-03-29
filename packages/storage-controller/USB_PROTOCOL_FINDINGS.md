# USB Protocol Findings — Storage Controller

**Date:** 2026-03-29
**Device:** HiDock H1E (VID 0x10D6, PID 0xB00D, Firmware 6.2.5)

## What Works

### Simple Commands (single request → single response)
- `GET_DEVICE_INFO` (cmd=1) → 17 bytes: firmware version + serial number
- `GET_FILE_COUNT` (cmd=6) → 4 bytes: big-endian uint32 file count
- `GET_CARD_INFO` (cmd=16) → 28 bytes: free/capacity/status in MiB
- All return valid Jensen messages (sync 0x12 0x34 + header + body)
- Work reliably across multiple calls without device restart

### Connection & Cleanup
- `usb.findByIds(0x10d6, 0xb00d)` → `dev.open()` → `iface.claim()` → works
- Endpoint OUT=0x01, IN=0x82 (direction-masked to 0x02 for transferIn)
- Clean disconnect with `iface.release(true)` → `dev.close()` allows re-connection
- **Critical:** read loop timeout of 5s on IN endpoint is required for clean disconnect. Without it, pending `transferIn` blocks release and locks the device.

### File List (cmd=4) — Partially Working
- First execution after device restart: receives all data correctly
- Response starts with Jensen header (cmd=4), body contains file entries
- First body starts with `0xFF 0xFF` + 4-byte big-endian total count (e.g., `0x0575` = 1397)
- File entries follow the standard format: version(1) + nameLen(3) + name(N) + fileLen(4) + padding(6) + sig(16)

## What Doesn't Work (Yet)

### File List Multi-Packet Reception
After the first successful execution, subsequent `GET_FILE_LIST` calls receive incomplete data:

**Observed behavior:**
1. First packet: valid Jensen message, cmd=4, bodyLen=8180, contains `0xFF 0xFF` header + entries
2. Second packet: **28555 bytes of raw data WITHOUT Jensen header** (no `0x12 0x34`)
3. No more data arrives — device stops sending

**Expected behavior (based on Python desktop app):**
- Multiple Jensen-wrapped packets, each with cmd=4
- Final packet with cmd=4 and bodyLen=0 = end-of-transmission marker

**Hypothesis:**
The device sends the file list as a combination of Jensen-wrapped and raw USB bulk data. After the first Jensen packet, subsequent data arrives as raw bytes without Jensen framing. The Python desktop app (PyUSB) may handle this differently — possibly accumulating all USB transfers as raw bytes and finding Jensen headers within them, rather than expecting each USB transfer to start with a Jensen header.

### State Persistence Between Sessions
The device appears to maintain state from previous `GET_FILE_LIST` calls:
- After a successful list, subsequent lists receive data that looks like a continuation (mid-stream file entry data)
- Drain (short-timeout reads until empty) clears the queue but doesn't fix the multi-packet issue
- Only a device restart (physical power cycle) fully resets the file list state

## Device Locking Behavior

### Cause
The USB device enters a "locked" state (`LIBUSB_ERROR_ACCESS` on `open()`) when:
1. A process exits with a pending `transferIn` (the kernel holds the handle)
2. Multiple rapid `open()`/`close()` cycles corrupt the USB descriptor state

### This is NOT corruption
The device firmware is fine. The USB interface is simply marked as "in use" by the OS kernel. The device continues to work with other USB stacks (Chromium WebUSB) because they use different driver paths.

### Recovery
1. **Drain:** `open()` → `claim()` → `epIn.timeout=1000` → `transferIn` loop until error → `release(true)` → `close()`
2. **Physical restart:** Disconnect and reconnect USB cable (or power cycle device)
3. Drain works when the handle can be opened. If `open()` itself fails, physical restart is needed.

### Prevention
- Always set `epIn.timeout = 5000` (not 0) so pending transfers can time out
- Always `release(true)` before `close()` — the `true` flag closes endpoints
- Always stop the read loop (`readLoopRunning = false`) and wait 6s before release (allows pending transfer to timeout)

## Architecture: Perpetual Read Loop

The Jensen protocol requires a **perpetual read loop** — a `transferIn` must always be pending for the device to send data. This matches the pattern in the Electron app (`jensen.ts`) and the official HiNotes web app.

```
connect → open → claim → startReadLoop()
                              ↓
                    transferIn(51200) callback:
                      1. POST NEXT transferIn immediately
                      2. Process received data
                      3. Dispatch to registered handlers
```

### Why This Matters
Without a pending `transferIn`, the device has nowhere to send data. Simple request-response (`send cmd` → `await read`) loses data because:
- The device sends multiple packets in rapid succession
- Between reads, there's a gap where no `transferIn` is pending
- The device drops or buffers data that has no pending transfer to deliver to

## Key Protocol Details

### Jensen Message Format
```
[0x12, 0x34]                    Sync markers (2 bytes)
[cmd_hi, cmd_lo]                Command ID (2 bytes, big-endian)
[seq_0, seq_1, seq_2, seq_3]    Sequence ID (4 bytes, big-endian)
[len_0, len_1, len_2, len_3]    Body length (4 bytes, big-endian)
[body...]                        Variable-length body
```

### File List Body Format
First packet starts with optional header:
```
[0xFF, 0xFF]                    Marker (2 bytes)
[total_count]                   Total file count (4 bytes, big-endian)
```

Then file entries:
```
[version]                       1 byte (0-5)
[nameLen_hi, mid, lo]           3 bytes, big-endian
[filename...]                   N bytes, ASCII (may contain null bytes to filter)
[fileLen]                       4 bytes, big-endian
[padding]                       6 bytes (zeros)
[signature]                     16 bytes (hex)
```

### Duration Calculation (version-dependent)
```
v1:    fileLength / 8000
v2:    (fileLength - 44) / ((48000 * 2 * 1) / 4)
v3:    (fileLength - 44) / ((24000 * 2 * 1) / 4)
v5:    fileLength / (12000 / 4)
other: fileLength / ((16000 * 2 * 1) / 4)
```

### Audio Format
Files are stored as `.hda` on the device but are **standard WAV format**. No conversion needed — just rename extension to `.wav` on download.

## Next Steps

1. **Study the Python desktop app's file list handling** — specifically how `hidock_device.py` accumulates multi-packet file list data with `_send_and_receive` + `_receive_response` loop
2. **Determine if raw (non-Jensen) data is expected** — the Python app may concatenate all USB reads as raw bytes and parse Jensen headers afterwards, rather than expecting each USB transfer to be a complete Jensen message
3. **Implement bulk data accumulation** — instead of parsing each USB transfer for Jensen headers individually, accumulate all bytes in a buffer and parse Jensen messages from the accumulated buffer (with carry buffer for split messages)
4. **Test if `GET_FILE_COUNT` before `GET_FILE_LIST` affects behavior** — the Electron app always calls `getFileCount` first, which may prime the firmware
