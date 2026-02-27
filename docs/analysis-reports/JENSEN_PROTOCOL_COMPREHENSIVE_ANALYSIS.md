# Jensen Protocol - Comprehensive Analysis

**Date:** 2026-01-15
**Source:** HAR analysis of hinotes.hidock.com + jensen.8754fe1c.js + codebase comparison

## Table of Contents

1. [Product IDs: 0xB00x vs 0xAF0x](#product-ids)
2. [Dual Vendor IDs](#dual-vendor-ids)
3. [P1 Mini Status](#p1-mini)
4. [File Listing Protocol](#file-listing)
5. [File Download Protocol](#file-download)
6. [Streaming Protocol](#streaming)
7. [The "Continue" Messages Mystery](#continue-messages)
8. [Why Downloads Stop at Chunk 62](#chunk-62-issue)
9. [Implementation Comparison Table](#implementation-comparison)

---

## <a name="product-ids"></a>1. Product IDs: 0xB00x vs 0xAF0x - What's the Impact?

### The Discovery

The official jensen.js uses **0xB00x series as PRIMARY** product IDs:

```javascript
M.model = (a = b.productId) == 45068 ? "hidock-h1"      // 0xB00C
        : a == 45069 ? "hidock-h1e"                      // 0xB00D
        : a == 45070 ? "hidock-p1"                       // 0xB00E
        : a == 45071 ? "hidock-p1:mini"                  // 0xB00F
        : a == 256 ? "hidock-h1"                         // 0x0100
        : a == 257 ? "hidock-h1e"                        // 0x0101
        // ... etc
```

### Complete Product ID Table

| Decimal | Hex    | Model          | Classification |
|---------|--------|----------------|----------------|
| **45068** | **0xB00C** | hidock-h1 | **PRIMARY** |
| **45069** | **0xB00D** | hidock-h1e | **PRIMARY** |
| **45070** | **0xB00E** | hidock-p1 | **PRIMARY** |
| **45071** | **0xB00F** | hidock-p1:mini | **PRIMARY** |
| 256 | 0x0100 | hidock-h1 | Alternate |
| 257 | 0x0101 | hidock-h1e | Alternate |
| 258 | 0x0102 | hidock-h1 | Alternate (variant 2) |
| 259 | 0x0103 | hidock-h1e | Alternate (variant 2) |
| 8256 | 0x2040 | hidock-p1 | Alternate |
| 8257 | 0x2041 | hidock-p1:mini | Alternate |
| 44812 | 0xAF0C | H1 | **LEGACY** (firmware < v6.x) |
| 44813 | 0xAF0D | H1E | **LEGACY** (firmware < v6.x) |
| 44814 | 0xAF0E | P1 | **LEGACY** (firmware < v1.2.x) |
| 44815 | 0xAF0F | P1 Mini | **LEGACY** (firmware < v1.2.x) |

### Impact

1. **Device Recognition Failures**: Our apps may not recognize devices with 0xB00x PIDs
2. **Model Misidentification**: Could cause wrong protocol selection
3. **Backwards Compatibility**: 0xAF0x still works for older firmware
4. **Recommendation**: Support ALL PIDs but prefer 0xB00x for detection

---

## <a name="dual-vendor-ids"></a>2. Dual Vendor IDs - What's This About?

### The Discovery

Official jensen.js uses TWO vendor IDs:

```javascript
filters: [{vendorId: 4310}, {vendorId: 14471}]
```

### Vendor ID Table

| Decimal | Hex    | Manufacturer | Usage |
|---------|--------|--------------|-------|
| 4310 | 0x10D6 | Actions Semiconductor | **Original** - H1, H1E, early P1 |
| 14471 | 0x3887 | HiDock Inc | **New** - P1, P1 Mini, future devices |

### Impact

1. **Why Two Vendors?** HiDock likely got their own USB Vendor ID (0x3887) for newer products
2. **Actions Semiconductor** (0x10D6) is the chip manufacturer used in earlier designs
3. **Must Support Both**: Users may have devices with either VID
4. **Our Status**: We already support both in web app via HIDOCK_VENDOR_IDS array

---

## <a name="p1-mini"></a>3. P1 Mini - Does It Exist?

### Yes, P1 Mini Exists!

From official jensen.js:
```javascript
a == 45071 ? "hidock-p1:mini"  // 0xB00F
a == 8257 ? "hidock-p1:mini"   // 0x2041
```

### P1 Mini Details

| Property | Value |
|----------|-------|
| Model Name | `hidock-p1:mini` (with colon!) |
| Primary PID | 0xB00F (45071) |
| Alternate PID | 0x2041 (8257) |
| Device Family | "eason" (same as P1) |
| Protocol | Identical to P1 |
| File Transfer | TRANSFER_FILE_PARTIAL (cmd 21) |

### Our Issue

Our apps use `hidock-p1-mini` (with dash) but official is `hidock-p1:mini` (with colon).
This could cause model detection issues.

---

## <a name="file-listing"></a>4. File Listing Protocol - The Full Picture

### Official Protocol

**Command:** `QUERY_FILE_LIST` (cmd 4)

**Mechanism:**
1. Send QUERY_FILE_LIST command (no body needed)
2. Device responds with MULTIPLE packets containing file list data
3. First packet may contain header: `0xFF 0xFF [4-byte file count]`
4. Each packet contains serialized file entries
5. Empty body packet signals end of transmission

### Official jensen.js Implementation

```javascript
Jensen.prototype.listFiles = async function() {
    let l = "filelist-" + this.serialNumber;
    // ...version check for H1/H1E...

    this[l] = [];
    this.registerHandler(QUERY_FILE_LIST, (b, d) => {
        if (b.body.length == 0) return d[l] = null, [];

        d[l].push(b.body);  // Accumulate ALL packets

        // Parse accumulated buffer
        let r = [], g = [], h = -1, u = 0;
        for (let i = 0; i < d[l].length; i++)
            for (let f = 0; f < d[l][i].length; f++)
                r.push(d[l][i][f]);

        // Check for header with total count
        if (255 & ~r[0] || 255 & ~r[1]) {
            h = (255 & r[2]) << 24 | (255 & r[3]) << 16 | (255 & r[4]) << 8 | 255 & r[5];
            u += 6;
        }

        // Parse files...

        // Return when complete
        if (p && g.length >= p.count || h > -1 && g.length >= h)
            return d[l] = null, g.filter(i => !!i.time);
    });

    this.send(new Command(QUERY_FILE_LIST));
}
```

### Key Insight: No "Continue" Messages for File List!

The official protocol does NOT send "continue" messages for file listing. The device streams ALL file list packets automatically after the initial command.

### Our Implementations Compared

| App | Command | Streaming | Status |
|-----|---------|-----------|--------|
| **Web** | GET_FILE_LIST (4) | ✅ Yes (receiveAndParseStreamingFileList) | ✅ Correct |
| **Electron** | GET_FILE_LIST (4) | ✅ Yes (listFiles loop) | ✅ Correct |
| **Desktop** | GET_FILE_LIST (4) | ❌ No (waits for complete response) | ⚠️ Slow |

### Why Electron is Slow

The Electron app works correctly but appears slow because:
1. It reads in a loop calling `transferIn()` repeatedly
2. Each `transferIn()` has a short timeout
3. Device may not send data continuously - has internal processing delays
4. The "nothing happens until all data arrives" is due to UI not showing progress until complete

The Web app shows streaming progress because it emits `onNewFiles` callbacks as files are parsed.

---

## <a name="file-download"></a>5. File Download Protocol - The Critical Finding

### Official Protocol (from jensen.js)

**For H1/H1E (jensen family):**
- Method: `getFile()` or `streaming()`
- Command: `TRANSFER_FILE` (cmd 5)
- Body: `[filename bytes]`

**For P1/P1 Mini (eason family):**
- Method: `readFile()`
- Command: `TRANSFER_FILE_PARTIAL` (cmd 21)
- Body: `[4-byte offset] + [4-byte length] + [filename bytes]`

### Official jensen.js Implementation

```javascript
// H1/H1E: TRANSFER_FILE (cmd 5)
Jensen.prototype.getFile = async function(filename, length, onData, onProgress) {
    let body = [];
    for (let i = 0; i < filename.length; i++)
        body.push(filename.charCodeAt(i));

    let received = 0;
    this.registerHandler(TRANSFER_FILE, chunk => {
        if (chunk == null) return "fail";
        received += chunk.body.length;
        onData(chunk.body);
        if (received >= length) return "done";
    });

    this.send(new Command(TRANSFER_FILE).body(body));
}

// P1: TRANSFER_FILE_PARTIAL (cmd 21)
Jensen.prototype.readFile = async function(filename, offset, length, callback) {
    let body = [];
    body.push(offset >> 24 & 255);
    body.push(offset >> 16 & 255);
    body.push(offset >> 8 & 255);
    body.push(255 & offset);
    body.push(length >> 24 & 255);
    body.push(length >> 16 & 255);
    body.push(length >> 8 & 255);
    body.push(255 & length);
    for (let i = 0; i < filename.length; i++)
        body.push(filename.charCodeAt(i));

    this.send(new Command(TRANSFER_FILE_PARTIAL).body(body), callback);
}
```

### Key Insight: NO "Continue" Messages for Downloads Either!

The device streams file data automatically after receiving the download command. There's no ACK/continue protocol visible in jensen.js.

### Current Implementation Status

| App | Command Used | Body Format | H1E | P1 |
|-----|--------------|-------------|-----|-----|
| **Web** | GET_FILE_BLOCK (13) | length + filename | ❌ WRONG | ❌ WRONG |
| **Electron** | TRANSFER_FILE (5) | filename | ✅ OK | ❌ WRONG |
| **Desktop** | TRANSFER_FILE (5) | filename | ✅ OK | ❌ WRONG |

---

## <a name="streaming"></a>6. Streaming Protocol

### Official Streaming Method

```javascript
Jensen.prototype.streaming = async function(filename, length, onData, onReceive) {
    let body = [];
    for (let i = 0; i < filename.length; i++)
        body.push(filename.charCodeAt(i));

    let received = 0;
    this.onreceive = onReceive;

    this.registerHandler(TRANSFER_FILE, chunk => {
        if (chunk != null) {
            received += chunk.body.length;
            onData(chunk.body);
            if (received >= length) return "done";
        }
    });

    this.send(new Command(TRANSFER_FILE).body(body));
}
```

### Streaming vs getFile

Both use the same protocol! The difference:
- `getFile()` - Returns complete file buffer when done
- `streaming()` - Calls `onData` callback with each chunk as it arrives

### Partial Downloads: GET_FILE_BLOCK

GET_FILE_BLOCK (cmd 13) is for **partial reads only**, not full downloads:

```javascript
Jensen.prototype.getFilePart = async function(filename, length, onSuccess, onFail) {
    let body = [];
    body.push(length >> 24 & 255);  // 4-byte length prefix
    body.push(length >> 16 & 255);
    body.push(length >> 8 & 255);
    body.push(255 & length);
    for (let i = 0; i < filename.length; i++)
        body.push(filename.charCodeAt(i));

    this.registerHandler(GET_FILE_BLOCK, chunk => {
        onSuccess(chunk.body);
    });

    this.send(new Command(GET_FILE_BLOCK).body(body));
}
```

**Use Cases for GET_FILE_BLOCK:**
- Preview first N bytes of a file
- Read specific range of audio for waveform preview
- NOT for downloading complete files

---

## <a name="continue-messages"></a>7. The "Continue" Messages Mystery

### What We Thought

We believed there was an ACK/continue protocol where we had to send acknowledgment messages to keep the device streaming data.

### What the Official Code Shows

**There are NO continue messages in jensen.js!**

The device protocol is simpler:
1. Send command
2. Device streams ALL data
3. Empty packet signals end

### Possible Sources of Confusion

1. **USB Transfer Flow Control**: USB bulk transfers have their own flow control at the hardware level
2. **Packet Acknowledgments**: USB handles ACK at the hardware layer, not application layer
3. **Multiple Packets**: We may have confused multi-packet responses with needing to ACK each one
4. **The "ACK" in jensen.js**: There are 3 references to "ACK" in the code, but they're for different purposes (like initial command acknowledgment from device)

### What the Device Actually Does

```
[Host]                    [Device]
   |                         |
   |---> TRANSFER_FILE ----> |
   |                         |
   | <--- data chunk 1 ------|
   | <--- data chunk 2 ------|
   | <--- data chunk 3 ------|
   |        ...              |
   | <--- data chunk N ------|
   | <--- empty packet ------|  (signals end)
   |                         |
```

No continue messages. The device just streams.

---

## <a name="chunk-62-issue"></a>8. Why Downloads Stop at Chunk 62

### Likely Causes

Based on the analysis, the web app stops at chunk 62 because:

**1. Wrong Command (Most Likely)**
- Web uses `GET_FILE_BLOCK` (cmd 13) instead of `TRANSFER_FILE` (cmd 5)
- GET_FILE_BLOCK might have a max response size limit
- Device may interpret it as "read first N bytes only"

**2. Body Format Mismatch**
- GET_FILE_BLOCK expects: `[4-byte length] + [filename]`
- But we're using it for full file download
- Device may be honoring the length limit

**3. 62 Chunks Math**
- 62 chunks × ~4KB = ~256KB
- This could be a device buffer limit for GET_FILE_BLOCK response
- TRANSFER_FILE (cmd 5) likely has no such limit

### The Fix

Change web app from:
```typescript
// WRONG
await this.sendCommand(HIDOCK_COMMANDS.GET_FILE_BLOCK, body);
```

To:
```typescript
// CORRECT for H1E
await this.sendCommand(HIDOCK_COMMANDS.TRANSFER_FILE, filenameBody);

// CORRECT for P1
await this.sendCommand(HIDOCK_COMMANDS.TRANSFER_FILE_PARTIAL, offsetLengthFilenameBody);
```

---

## <a name="implementation-comparison"></a>9. Implementation Comparison

### File Listing

| Aspect | Official | Web | Electron | Desktop |
|--------|----------|-----|----------|---------|
| Command | QUERY_FILE_LIST (4) | GET_FILE_LIST (4) ✅ | GET_FILE_LIST (4) ✅ | GET_FILE_LIST (4) ✅ |
| Streaming | Yes | Yes ✅ | Yes ✅ | No ⚠️ |
| Progress UI | Incremental | Incremental ✅ | After complete | After complete |
| Continue Msgs | None | None ✅ | None ✅ | None ✅ |

### File Download (H1E)

| Aspect | Official | Web | Electron | Desktop |
|--------|----------|-----|----------|---------|
| Command | TRANSFER_FILE (5) | GET_FILE_BLOCK (13) ❌ | TRANSFER_FILE (5) ✅ | TRANSFER_FILE (5) ✅ |
| Body | filename | length + filename ❌ | filename ✅ | filename ✅ |
| Streaming | Yes | Yes | Yes | Yes |
| Continue Msgs | None | None | None | None |

### File Download (P1)

| Aspect | Official | Web | Electron | Desktop |
|--------|----------|-----|----------|---------|
| Command | TRANSFER_FILE_PARTIAL (21) | GET_FILE_BLOCK (13) ❌ | TRANSFER_FILE (5) ❌ | TRANSFER_FILE (5) ❌ |
| Body | offset + length + filename | length + filename ❌ | filename ❌ | filename ❌ |

---

## Recommendations

### Immediate Fixes

1. **Web App**: Change file download from GET_FILE_BLOCK to TRANSFER_FILE (H1E) / TRANSFER_FILE_PARTIAL (P1)

2. **All Apps**: Add model-based command routing:
   ```typescript
   const command = model.includes('hidock-p1')
       ? HIDOCK_COMMANDS.TRANSFER_FILE_PARTIAL
       : HIDOCK_COMMANDS.TRANSFER_FILE;
   ```

3. **All Apps**: Update P1 body format:
   ```typescript
   // P1: offset (4 bytes) + length (4 bytes) + filename
   const body = new Uint8Array(8 + filename.length);
   view.setUint32(0, 0, false);      // offset = 0
   view.setUint32(4, fileSize, false); // length
   // ... filename bytes
   ```

### Model Name Fix

Update P1 Mini detection:
- Current: `hidock-p1-mini` (dash)
- Official: `hidock-p1:mini` (colon)

### Product ID Support

Ensure all apps handle:
- Primary: 0xB00C, 0xB00D, 0xB00E, 0xB00F
- Alternate: 0x0100-0x0103, 0x2040-0x2041
- Legacy: 0xAF0C-0xAF0F
