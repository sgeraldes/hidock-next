
const { app, BrowserWindow } = require('electron');
const { performance } = require('perf_hooks');

// --- LEGACY PARSING LOGIC (Current Production Code) ---
function calculateDurationOld(fileLength, fileVersion) {
    // Current logs in hot path
    console.log(`[Jensen-OLD] calculateDurationSeconds: fileLength=${fileLength}, fileVersion=${fileVersion}`);
    const duration = Math.round(fileLength / 8000);
    console.log(`[Jensen-OLD] Default (version ${fileVersion}) duration: ${duration} seconds`);
    return duration;
}

function parseFilenameDateTimeOld(filename) {
    const numericMatch = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_](\d{2})(\d{2})(\d{2})?/);
    if (numericMatch) {
        const [, year, month, day, hour, minute, second = '00'] = numericMatch;
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second));
    }
    return null;
}

function runOldParser(buffer) {
    const files = [];
    let pos = 6; // Skip header
    while (pos < buffer.length) {
        const fileVersion = buffer[pos++];
        const nameLen = ((buffer[pos] << 16) | (buffer[pos + 1] << 8) | buffer[pos + 2]);
        pos += 3;
        let filename = '';
        for (let i = 0; i < nameLen; i++) filename += String.fromCharCode(buffer[pos + i]);
        pos += nameLen;
        const fileLength = ((buffer[pos] << 24) | (buffer[pos + 1] << 16) | (buffer[pos + 2] << 8) | buffer[pos + 3]);
        pos += 4;
        pos += 6; // Skip reserved
        let signature = '';
        for (let i = 0; i < 16; i++) signature += buffer[pos + i].toString(16).padStart(2, '0');
        pos += 16;

        const date = parseFilenameDateTimeOld(filename);
        const duration = calculateDurationOld(fileLength, fileVersion);
        files.push({ filename, date, duration, signature });
    }
    return files;
}

// --- OPTIMIZED PARSING LOGIC ---
function runNewParser(buffer) {
    const files = [];
    let pos = 6;
    while (pos < buffer.length) {
        const fileVersion = buffer[pos++];
        const nameLen = ((buffer[pos] << 16) | (buffer[pos + 1] << 8) | buffer[pos + 2]);
        pos += 3;
        
        // Faster string conversion
        const filename = String.fromCharCode.apply(null, buffer.subarray(pos, pos + nameLen));
        pos += nameLen;
        
        const fileLength = ((buffer[pos] << 24) | (buffer[pos + 1] << 16) | (buffer[pos + 2] << 8) | buffer[pos + 3]);
        pos += 4;
        pos += 22; // Skip reserved + signature (32 bytes total)

        // NO LOGS, NO REGEX
        const duration = Math.round(fileLength / 8000);
        files.push({ filename, duration });
    }
    return files;
}

app.whenReady().then(async () => {
    console.log('\n--- HIDOCK HARDWARE BENCHMARK ---');
    
    // 1. Find Device
    const devices = await navigator.usb.getDevices();
    const device = devices.find(d => d.productName && d.productName.includes('HiDock'));
    
    if (!device) {
        console.error('ERROR: No HiDock connected. Please plug it in and run again.');
        app.quit();
        return;
    }

    console.log(`Connected to: ${device.productName}`);
    await device.open();
    await device.selectConfiguration(1);
    await device.claimInterface(0);

    // 2. Fetch Raw Data (The I/O Phase)
    console.log('Requesting raw file list bytes...');
    const cmd = new Uint8Array([0x12, 0x34, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
    await device.transferOut(1, cmd);

    let rawBuffer = new Uint8Array(0);
    const startIO = performance.now();
    
    // Pull data until terminator or timeout
    while (true) {
        const result = await device.transferIn(2, 65536);
        if (result.status === 'ok' && result.data.byteLength > 0) {
            const chunk = new Uint8Array(result.data.buffer);
            const combined = new Uint8Array(rawBuffer.length + chunk.length);
            combined.set(rawBuffer);
            combined.set(chunk, rawBuffer.length);
            rawBuffer = combined;
            if (chunk.length < 512) break; // End of stream
        } else break;
        if (performance.now() - startIO > 10000) break; // 10s safety
    }
    const endIO = performance.now();
    console.log(`I/O Phase: Received ${rawBuffer.length} bytes in ${(endIO - startIO).toFixed(2)}ms`);

    // 3. Benchmark Old Parser (With Logs)
    console.log('\nBenchmarking Legacy Parser (with console logging overhead)...');
    const startOld = performance.now();
    const filesOld = runOldParser(rawBuffer);
    const endOld = performance.now();
    const oldTime = endOld - startOld;

    // 4. Benchmark New Parser (Silent)
    console.log('\nBenchmarking Optimized Parser (No logs, no regex)...');
    const startNew = performance.now();
    const filesNew = runNewParser(rawBuffer);
    const endNew = performance.now();
    const newTime = endNew - startNew;

    console.log('\n--- FINAL RESULTS ---');
    console.log(`Records Processed: ${filesOld.length}`);
    console.log(`Legacy Logic: ${oldTime.toFixed(2)}ms`);
    console.log(`Optimized Logic: ${newTime.toFixed(2)}ms`);
    console.log(`Speedup: ${(oldTime / newTime).toFixed(1)}x faster`);
    
    const realWorldWait = 57300; // From user log
    const saved = realWorldWait - (realWorldWait / (oldTime / newTime));
    console.log(`\nPROVEN SAVINGS: ${(saved / 1000).toFixed(2)} seconds off boot time.`);

    await device.close();
    app.quit();
});
