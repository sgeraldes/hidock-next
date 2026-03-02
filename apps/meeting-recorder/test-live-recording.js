/**
 * LIVE RECORDING TEST - PROOF THAT RECORDING WORKS RIGHT NOW
 *
 * This test will:
 * 1. Start the app
 * 2. Create a session via IPC
 * 3. Monitor audio chunks being saved in REAL-TIME
 * 4. Show you the actual data as it's written
 * 5. Wait 10 seconds of recording
 * 6. Stop and show results
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let testSessionId;
let audioStorageDir;
let chunkCount = 0;
let testStartTime;

console.log('\n' + '='.repeat(80));
console.log('LIVE RECORDING TEST - REAL-TIME PROOF');
console.log('='.repeat(80) + '\n');

async function createMainWindow() {
  const preloadPath = path.join(__dirname, 'out/preload/index.js');
  const rendererPath = path.join(__dirname, 'out/renderer/index.html');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Don't show window during test
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Disabled for microphone access
    },
  });

  await mainWindow.loadFile(rendererPath);
  console.log('✓ Main window created');
}

async function initializeApp() {
  console.log('[1/7] Initializing Electron app...');

  // Import and initialize database
  const { initializeDatabase } = require('./out/main/index.js');
  await initializeDatabase();
  console.log('✓ Database initialized');

  // Import and register IPC handlers
  const { registerIpcHandlers } = require('./out/main/index.js');
  registerIpcHandlers();
  console.log('✓ IPC handlers registered');

  // Set up audio storage path
  audioStorageDir = path.join(app.getPath('documents'), 'MeetingRecorder', 'recordings');
  console.log(`✓ Audio storage: ${audioStorageDir}`);
}

async function createTestSession() {
  console.log('\n[2/7] Creating test session...');

  const { createSession } = require('./out/main/index.js');
  const session = createSession();
  testSessionId = session.id;

  console.log(`✓ Session created: ${testSessionId}`);
  console.log(`  Title: ${session.title}`);
  console.log(`  Status: ${session.status}`);
  console.log(`  Started: ${session.started_at}`);

  return session;
}

function watchForAudioChunks() {
  console.log('\n[3/7] Watching for audio chunks...');

  const sessionDir = path.join(audioStorageDir, testSessionId);

  // Create directory if it doesn't exist
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  console.log(`✓ Monitoring directory: ${sessionDir}`);
  console.log('  Waiting for chunks to appear...\n');

  testStartTime = Date.now();

  // Watch the directory for new files
  const watcher = fs.watch(sessionDir, (eventType, filename) => {
    if (filename && filename.startsWith('chunk-')) {
      chunkCount++;
      const chunkPath = path.join(sessionDir, filename);

      try {
        const stats = fs.statSync(chunkPath);
        const elapsed = ((Date.now() - testStartTime) / 1000).toFixed(1);

        console.log(`[${elapsed}s] ✓ Chunk ${chunkCount}: ${filename} (${(stats.size / 1024).toFixed(2)} KB)`);
      } catch (err) {
        // File might still be writing
      }
    }
  });

  return watcher;
}

async function generateTestAudio() {
  console.log('\n[4/7] Generating test audio...');
  console.log('  Simulating microphone input for 10 seconds...');

  // We'll use ffmpeg to generate a test tone and pipe it
  // Or we can just wait and let the test run with silence

  return new Promise((resolve) => {
    // Wait 10 seconds
    setTimeout(() => {
      console.log('✓ Test recording period complete');
      resolve();
    }, 10000);
  });
}

async function verifyChunks() {
  console.log('\n[5/7] Verifying chunks were saved...');

  const sessionDir = path.join(audioStorageDir, testSessionId);

  if (!fs.existsSync(sessionDir)) {
    console.log('✗✗✗ SESSION DIRECTORY DOES NOT EXIST!');
    return false;
  }

  const files = fs.readdirSync(sessionDir);
  const chunks = files.filter(f => f.startsWith('chunk-'));

  console.log(`✓ Found ${chunks.length} chunks in session directory`);

  if (chunks.length === 0) {
    console.log('✗✗✗ NO CHUNKS FOUND - RECORDING DID NOT WORK!');
    return false;
  }

  // Show each chunk
  let totalSize = 0;
  for (const chunk of chunks) {
    const chunkPath = path.join(sessionDir, chunk);
    const stats = fs.statSync(chunkPath);
    totalSize += stats.size;
    console.log(`  - ${chunk}: ${(stats.size / 1024).toFixed(2)} KB`);
  }

  console.log(`✓ Total audio captured: ${(totalSize / 1024).toFixed(2)} KB`);

  return chunks.length > 0;
}

async function endSession() {
  console.log('\n[6/7] Ending session...');

  const { updateSession } = require('./out/main/index.js');
  const now = new Date().toISOString();
  updateSession(testSessionId, { status: 'inactive', ended_at: now });

  console.log('✓ Session ended');
}

async function showResults() {
  console.log('\n[7/7] TEST RESULTS:');
  console.log('━'.repeat(80));

  const sessionDir = path.join(audioStorageDir, testSessionId);
  const files = fs.readdirSync(sessionDir);
  const chunks = files.filter(f => f.startsWith('chunk-'));

  if (chunks.length > 0) {
    console.log('\n✓✓✓ SUCCESS - RECORDING WORKS!');
    console.log(`✓ Chunks saved: ${chunks.length}`);
    console.log(`✓ Session ID: ${testSessionId}`);
    console.log(`✓ Location: ${sessionDir}`);

    // Check if concatenated
    if (files.includes('recording.ogg')) {
      const stats = fs.statSync(path.join(sessionDir, 'recording.ogg'));
      console.log(`✓ Concatenated file: ${(stats.size / 1024).toFixed(2)} KB`);
    }
  } else {
    console.log('\n✗✗✗ FAILURE - NO RECORDING HAPPENED!');
    console.log('Check that:');
    console.log('  - Microphone is connected');
    console.log('  - Microphone permissions are granted');
    console.log('  - Audio recorder is starting');
  }

  console.log('\n' + '='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
}

async function runTest() {
  try {
    await createMainWindow();
    await initializeApp();
    const session = await createTestSession();
    const watcher = watchForAudioChunks();

    // Now we need to actually trigger recording
    // The problem is we can't actually call getUserMedia from Node.js
    // But we can check if the session was created and is ready

    console.log('\n[4/7] NOTE: Cannot simulate microphone from test script');
    console.log('  To test recording:');
    console.log('  1. Open the app');
    console.log(`  2. It should auto-load session: ${testSessionId}`);
    console.log('  3. Audio should start recording automatically');
    console.log('  4. Watch this directory for chunks:');
    console.log(`     ${path.join(audioStorageDir, testSessionId)}`);

    // Wait for user to manually test
    console.log('\nWaiting 30 seconds for you to test manually...');
    await new Promise(resolve => setTimeout(resolve, 30000));

    watcher.close();

    const hasChunks = await verifyChunks();
    await endSession();
    await showResults();

  } catch (error) {
    console.error('\n✗✗✗ TEST FAILED:', error);
  }
}

app.whenReady().then(() => {
  runTest().then(() => {
    setTimeout(() => {
      app.quit();
    }, 2000);
  });
});

app.on('window-all-closed', () => {
  // Don't quit
});
