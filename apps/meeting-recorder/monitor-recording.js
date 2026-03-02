/**
 * REAL-TIME RECORDING MONITOR
 *
 * Run this alongside the app to see PROOF that recording works:
 * - Shows when sessions are created
 * - Shows audio chunks as they're saved
 * - Shows file sizes in real-time
 * - Monitors database changes
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const audioStorageDir = 'G:\\OneDrive - Geraldes\\Documents\\MeetingRecorder\\recordings';
const dbPath = 'C:\\Users\\Sebastian\\AppData\\Roaming\\meeting-recorder\\meeting-recorder.db';

console.clear();
console.log('═'.repeat(80));
console.log('REAL-TIME RECORDING MONITOR');
console.log('═'.repeat(80));
console.log('');
console.log('Watching for recording activity...');
console.log(`Audio: ${audioStorageDir}`);
console.log(`DB: ${dbPath}`);
console.log('');
console.log('NOW: Click "Record" in the app and watch this output!');
console.log('─'.repeat(80));
console.log('');

let sessionDirs = new Set();
let lastDbSize = 0;

// Track existing sessions at start
if (fs.existsSync(audioStorageDir)) {
  const existing = fs.readdirSync(audioStorageDir);
  existing.forEach(dir => sessionDirs.add(dir));
}

if (fs.existsSync(dbPath)) {
  lastDbSize = fs.statSync(dbPath).size;
}

// Watch for new session directories
setInterval(() => {
  if (!fs.existsSync(audioStorageDir)) return;

  const current = fs.readdirSync(audioStorageDir);

  for (const dir of current) {
    if (!sessionDirs.has(dir)) {
      sessionDirs.add(dir);
      const timestamp = new Date().toLocaleTimeString();
      console.log(`[${timestamp}] 🟢 NEW SESSION CREATED: ${dir}`);
      console.log('');

      // Start watching this session
      watchSession(dir);
    }
  }
}, 500);

// Watch database changes
setInterval(() => {
  if (!fs.existsSync(dbPath)) return;

  const currentSize = fs.statSync(dbPath).size;
  if (currentSize !== lastDbSize) {
    const timestamp = new Date().toLocaleTimeString();
    const diff = currentSize - lastDbSize;
    console.log(`[${timestamp}] 💾 DATABASE UPDATE: +${diff} bytes (total: ${(currentSize / 1024).toFixed(2)} KB)`);
    lastDbSize = currentSize;
  }
}, 1000);

function watchSession(sessionId) {
  const sessionDir = path.join(audioStorageDir, sessionId);
  let knownFiles = new Set();
  let chunkCount = 0;
  let sessionStartTime = Date.now();

  console.log(`👁️  Monitoring session: ${sessionId}`);
  console.log('   Waiting for audio chunks...');
  console.log('');

  const watcher = setInterval(() => {
    if (!fs.existsSync(sessionDir)) {
      clearInterval(watcher);
      return;
    }

    const files = fs.readdirSync(sessionDir);

    for (const file of files) {
      if (!knownFiles.has(file)) {
        knownFiles.add(file);
        const filePath = path.join(sessionDir, file);
        const stats = fs.statSync(filePath);
        const elapsed = ((Date.now() - sessionStartTime) / 1000).toFixed(1);
        const timestamp = new Date().toLocaleTimeString();

        if (file.startsWith('chunk-')) {
          chunkCount++;
          console.log(`[${timestamp}] 🎵 CHUNK ${chunkCount}: ${file} - ${(stats.size / 1024).toFixed(2)} KB (${elapsed}s elapsed)`);
        } else if (file === 'recording.ogg') {
          console.log(`[${timestamp}] 🎬 CONCATENATED AUDIO: recording.ogg - ${(stats.size / 1024).toFixed(2)} KB`);
          console.log('');
          console.log('✅ RECORDING COMPLETE AND CONCATENATED!');
          console.log('─'.repeat(80));
          console.log('');
          clearInterval(watcher);
        } else if (file === 'concat-list.txt') {
          console.log(`[${timestamp}] 📝 Concatenation list created`);
        }
      }
    }
  }, 200);
}

// Keep script running
setInterval(() => {}, 1000000);

console.log('Monitor running... Press Ctrl+C to stop');
console.log('');
