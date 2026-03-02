#!/usr/bin/env node
/**
 * Test audio transcription with Gemini API.
 *
 * Usage:
 *   node test-gemini-audio.js <API_KEY> [session-directory]
 *
 * If no session directory is given, uses the latest session.
 *
 * Approach 1: Send the full recording.webm (or reconstruct it)
 * Approach 2: Send individual 3-second chunks as WAV (like the realtime reference)
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const API_KEY = process.argv[2];
if (!API_KEY) {
  console.error("Usage: node test-gemini-audio.js <GOOGLE_API_KEY> [session-directory]");
  process.exit(1);
}

const RECORDINGS_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME,
  "OneDrive - Geraldes", "Documents", "MeetingRecorder", "recordings"
);

// Find session directory
let sessionDir = process.argv[3];
if (!sessionDir) {
  // Use the latest session
  const sessions = fs.readdirSync(RECORDINGS_DIR)
    .map(d => ({ name: d, mtime: fs.statSync(path.join(RECORDINGS_DIR, d)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  if (sessions.length === 0) {
    console.error("No sessions found in", RECORDINGS_DIR);
    process.exit(1);
  }
  sessionDir = path.join(RECORDINGS_DIR, sessions[0].name);
  console.log("Using latest session:", sessions[0].name);
}

if (!fs.existsSync(sessionDir)) {
  console.error("Session directory not found:", sessionDir);
  process.exit(1);
}

// Find ffmpeg
const ffmpegPath = path.join(__dirname, "node_modules", "ffmpeg-static", "ffmpeg.exe");
if (!fs.existsSync(ffmpegPath)) {
  console.error("ffmpeg not found at:", ffmpegPath);
  process.exit(1);
}

// Get chunk files
const chunks = fs.readdirSync(sessionDir)
  .filter(f => f.startsWith("chunk-") && f.endsWith(".ogg"))
  .sort();

console.log(`Found ${chunks.length} chunks`);
chunks.forEach(f => {
  const stats = fs.statSync(path.join(sessionDir, f));
  console.log(`  ${f}: ${stats.size} bytes`);
});

// Check if chunk-000 exists (has EBML header)
const hasChunk0 = chunks.includes("chunk-000.ogg");
if (!hasChunk0) {
  console.error("\nWARNING: chunk-000.ogg is missing! Recording will be corrupt.");
  console.error("This is the pruning bug - chunk-000 has the WebM headers.");
}

async function callGemini(audioBuffer, mimeType, prompt) {
  const base64Audio = audioBuffer.toString("base64");

  const body = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeType,
            data: base64Audio,
          }
        },
        {
          text: prompt,
        }
      ]
    }]
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${text}`);
  }

  const json = await response.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no response)";
}

async function testApproach1_FullRecording() {
  console.log("\n===== APPROACH 1: Full Recording (binary concat + ffmpeg re-mux) =====\n");

  if (!hasChunk0) {
    console.log("Skipping - chunk-000 missing, can't reconstruct valid WebM");
    return;
  }

  // Binary concat all chunks
  const buffers = chunks.map(f => fs.readFileSync(path.join(sessionDir, f)));
  const combined = Buffer.concat(buffers);
  const totalBytes = combined.length;

  // Re-mux with ffmpeg
  const rawPath = path.join(sessionDir, "_test-raw.webm");
  const muxedPath = path.join(sessionDir, "_test-muxed.webm");

  fs.writeFileSync(rawPath, combined);

  try {
    execFileSync(ffmpegPath, ["-i", rawPath, "-c", "copy", "-y", muxedPath]);
    const muxed = fs.readFileSync(muxedPath);
    console.log(`Muxed file: ${muxed.length} bytes (from ${totalBytes} raw bytes)`);

    // Check duration
    try {
      const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", muxedPath]);
      console.log(`Duration: ${parseFloat(probe.toString()).toFixed(1)}s`);
    } catch { /* ffprobe not available */ }

    // Send to Gemini
    console.log("\nSending full recording to Gemini...");
    const result = await callGemini(
      muxed,
      "audio/webm",
      "Transcribe the speech in this audio. Return the exact words spoken, nothing more."
    );
    console.log("\nGemini transcription (full recording):");
    console.log(result);

  } finally {
    try { fs.unlinkSync(rawPath); } catch {}
    try { fs.unlinkSync(muxedPath); } catch {}
  }
}

async function testApproach2_WAVChunks() {
  console.log("\n===== APPROACH 2: Individual WAV Chunks (like realtime reference) =====\n");

  if (!hasChunk0) {
    console.log("Skipping - chunk-000 missing");
    return;
  }

  const TIMESLICE_MS = 3000;

  for (let i = 0; i < Math.min(chunks.length, 10); i++) {
    const chunkFile = chunks[i];
    const chunkIdx = parseInt(chunkFile.match(/chunk-(\d+)/)[1], 10);

    let wavPath;

    if (chunkIdx === 0) {
      // Chunk 0 is a valid standalone WebM - convert to WAV
      wavPath = path.join(sessionDir, `_test-chunk-${chunkIdx}.wav`);
      const chunkPath = path.join(sessionDir, chunkFile);
      try {
        execFileSync(ffmpegPath, [
          "-i", chunkPath, "-f", "wav", "-acodec", "pcm_s16le",
          "-ar", "16000", "-ac", "1", "-y", wavPath
        ]);
      } catch (e) {
        console.log(`Chunk ${chunkIdx}: Failed to convert to WAV - ${e.message}`);
        continue;
      }
    } else {
      // Chunks 1+: cumulative concat + extract
      const cumBufs = [];
      for (let j = 0; j <= i; j++) {
        cumBufs.push(fs.readFileSync(path.join(sessionDir, chunks[j])));
      }
      const cumulative = Buffer.concat(cumBufs);
      const cumPath = path.join(sessionDir, `_test-cumulative-${chunkIdx}.webm`);
      wavPath = path.join(sessionDir, `_test-chunk-${chunkIdx}.wav`);

      fs.writeFileSync(cumPath, cumulative);

      const startSec = (chunkIdx * TIMESLICE_MS) / 1000;
      try {
        execFileSync(ffmpegPath, [
          "-i", cumPath, "-ss", String(startSec),
          "-f", "wav", "-acodec", "pcm_s16le",
          "-ar", "16000", "-ac", "1", "-y", wavPath
        ]);
      } catch (e) {
        console.log(`Chunk ${chunkIdx}: Failed to extract WAV - ${e.message}`);
        try { fs.unlinkSync(cumPath); } catch {}
        continue;
      }
      try { fs.unlinkSync(cumPath); } catch {}
    }

    if (!fs.existsSync(wavPath) || fs.statSync(wavPath).size < 100) {
      console.log(`Chunk ${chunkIdx}: WAV too small or missing, skipping`);
      try { fs.unlinkSync(wavPath); } catch {}
      continue;
    }

    const wavBuf = fs.readFileSync(wavPath);
    console.log(`Chunk ${chunkIdx} (${(chunkIdx * TIMESLICE_MS / 1000)}s): WAV ${wavBuf.length} bytes`);

    try {
      const result = await callGemini(
        wavBuf,
        "audio/wav",
        "Transcribe the speech in this audio clip. Return only the exact words spoken. If silent, return SILENT."
      );
      console.log(`  → ${result}`);
    } catch (e) {
      console.log(`  → ERROR: ${e.message}`);
    }

    try { fs.unlinkSync(wavPath); } catch {}

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }
}

async function testApproach3_CumulativeWebM() {
  console.log("\n===== APPROACH 3: Cumulative WebM Extract (our actual approach) =====\n");

  if (!hasChunk0) {
    console.log("Skipping - chunk-000 missing");
    return;
  }

  const TIMESLICE_MS = 3000;

  for (let i = 0; i < Math.min(chunks.length, 10); i++) {
    const chunkFile = chunks[i];
    const chunkIdx = parseInt(chunkFile.match(/chunk-(\d+)/)[1], 10);

    let audioBuffer;
    let mimeType;

    if (chunkIdx === 0) {
      // Send chunk 0 directly as WebM
      audioBuffer = fs.readFileSync(path.join(sessionDir, chunkFile));
      mimeType = "audio/webm";
    } else {
      // Cumulative concat + ffmpeg extract as WebM (our actual approach)
      const cumBufs = [];
      for (let j = 0; j <= i; j++) {
        cumBufs.push(fs.readFileSync(path.join(sessionDir, chunks[j])));
      }
      const cumulative = Buffer.concat(cumBufs);
      const cumPath = path.join(sessionDir, `_test-cum-${chunkIdx}.webm`);
      const outPath = path.join(sessionDir, `_test-ext-${chunkIdx}.webm`);

      fs.writeFileSync(cumPath, cumulative);

      const startSec = (chunkIdx * TIMESLICE_MS) / 1000;
      try {
        execFileSync(ffmpegPath, [
          "-i", cumPath, "-ss", String(startSec),
          "-c", "copy", "-y", outPath
        ]);
      } catch (e) {
        console.log(`Chunk ${chunkIdx}: ffmpeg extract failed - ${e.message}`);
        try { fs.unlinkSync(cumPath); } catch {}
        continue;
      }
      try { fs.unlinkSync(cumPath); } catch {}

      if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 100) {
        console.log(`Chunk ${chunkIdx}: extracted file too small`);
        try { fs.unlinkSync(outPath); } catch {}
        continue;
      }

      audioBuffer = fs.readFileSync(outPath);
      mimeType = "audio/webm";
      try { fs.unlinkSync(outPath); } catch {}
    }

    console.log(`Chunk ${chunkIdx} (${(chunkIdx * TIMESLICE_MS / 1000)}s): ${audioBuffer.length} bytes (${mimeType})`);

    try {
      const result = await callGemini(
        audioBuffer,
        mimeType,
        "Transcribe the speech in this audio clip. Return only the exact words spoken. If silent, return SILENT."
      );
      console.log(`  → ${result}`);
    } catch (e) {
      console.log(`  → ERROR: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

async function main() {
  console.log("Session:", sessionDir);
  console.log("Chunks:", chunks.length);
  console.log("Has chunk-000:", hasChunk0);

  await testApproach1_FullRecording();
  await testApproach2_WAVChunks();
  await testApproach3_CumulativeWebM();

  console.log("\n===== DONE =====");
}

main().catch(console.error);
