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

## Key Finding: Python Protocol Implementation

The Python desktop app (`hidock_device.py`) handles file listing with these critical differences:

### Python receives multi-packet file list via sequential reads:
1. Clears `receive_buffer` before sending `GET_FILE_LIST`
2. Calls `_receive_response` in a loop with `streaming_cmd_id=CMD_GET_FILE_LIST`
3. Each `_receive_response` call does **short USB reads** (200ms timeout, `wMaxPacketSize * 64` bytes)
4. Appends each USB read to a persistent `receive_buffer`
5. Parses Jensen headers from the accumulated buffer (NOT per-USB-transfer)
6. Accepts ANY cmd=4 response regardless of sequence ID (streaming mode)
7. Completion: empty body (bodyLen=0) OR 10 consecutive timeouts

### Both Python and Electron REQUIRE Jensen headers on every response:
- Python: `if not (self.receive_buffer[0] == 0x12 and self.receive_buffer[1] == 0x34)` → protocol error
- Electron: `parsePacket` throws "invalid header" if sync bytes missing
- Raw data without Jensen headers is NOT expected by either implementation

### Critical difference from our CLI:
The Python app does NOT use a perpetual read loop. It does **sequential reads** with short timeouts (200ms) in a while loop. Each read appends to a buffer. The buffer is parsed for Jensen messages. This is fundamentally different from our callback-based perpetual read loop.

## Unsolved: Mid-Stream Data on Subsequent Calls

After the first successful file list, subsequent calls to `listFiles` receive a Jensen message (cmd=4) whose body starts with `68 64 61` ("hda") — clearly mid-stream file entry data (end of a filename), not the start of a file list (`0xFF 0xFF` header).

**Possible explanations:**
1. Device retains file list stream state and resumes from where it was interrupted
2. Our disconnect doesn't fully reset the device's internal file list iterator
3. The Python app avoids this by using `receive_buffer.clear()` before each command

## Next Steps

1. **Match the Python pattern exactly** — use sequential reads with short timeouts and a persistent buffer, not a perpetual callback-based read loop
2. **Clear the receive buffer before each command** — the Python app explicitly does `self.receive_buffer.clear()` before sending `GET_FILE_LIST`
3. **Use streaming_cmd_id mode** — accept any cmd=4 regardless of sequence ID
4. **Handle completion by consecutive timeouts** — Python uses 10 consecutive 200ms timeouts as completion signal, not just empty body
