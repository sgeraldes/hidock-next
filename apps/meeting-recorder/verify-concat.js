#!/usr/bin/env node
/**
 * Verify binary concatenation of WebM chunks.
 * Usage: node verify-concat.js <session-directory>
 *
 * Reads all chunk-*.ogg files, binary-concatenates them into recording-test.webm,
 * and inspects the WebM structure to confirm validity.
 */

const fs = require("fs");
const path = require("path");

const sessionDir = process.argv[2];
if (!sessionDir) {
  console.error("Usage: node verify-concat.js <session-directory>");
  process.exit(1);
}

if (!fs.existsSync(sessionDir)) {
  console.error("Directory not found: " + sessionDir);
  process.exit(1);
}

const files = fs.readdirSync(sessionDir)
  .filter(f => f.startsWith("chunk-") && f.endsWith(".ogg"))
  .sort();

console.log("Found " + files.length + " chunk files:");
files.forEach(f => {
  const stats = fs.statSync(path.join(sessionDir, f));
  console.log("  " + f + ": " + stats.size + " bytes");
});

if (files.length === 0) {
  console.error("No chunk files found!");
  process.exit(1);
}

// Check first chunk for WebM EBML signature
const firstChunk = fs.readFileSync(path.join(sessionDir, files[0]));
const isWebM = firstChunk[0] === 0x1a && firstChunk[1] === 0x45 && firstChunk[2] === 0xdf && firstChunk[3] === 0xa3;
console.log("\nFirst chunk EBML signature: " + (isWebM ? "VALID (WebM)" : "MISSING - bytes: " + firstChunk.subarray(0, 4).toString("hex")));

// Find Cluster element
let clusterOffset = -1;
for (let i = 0; i < firstChunk.length - 3; i++) {
  if (firstChunk[i] === 0x1f && firstChunk[i+1] === 0x43 && firstChunk[i+2] === 0xb6 && firstChunk[i+3] === 0x75) {
    clusterOffset = i;
    break;
  }
}
console.log("Init segment size: " + (clusterOffset === -1 ? "NOT FOUND" : clusterOffset + " bytes"));

// Binary concatenate
console.log("\nBinary concatenating " + files.length + " chunks...");
const buffers = files.map(f => fs.readFileSync(path.join(sessionDir, f)));
const totalBytes = buffers.reduce((sum, b) => sum + b.length, 0);
const combined = Buffer.concat(buffers, totalBytes);

const outputPath = path.join(sessionDir, "recording-test.webm");
fs.writeFileSync(outputPath, combined);
console.log("Output: " + outputPath);
console.log("Total size: " + totalBytes + " bytes");

// Compare with existing recording.ogg
const existingOgg = path.join(sessionDir, "recording.ogg");
if (fs.existsSync(existingOgg)) {
  const oggSize = fs.statSync(existingOgg).size;
  console.log("\nExisting recording.ogg (ffmpeg): " + oggSize + " bytes");
  console.log("New recording-test.webm (binary): " + totalBytes + " bytes");
  if (totalBytes > oggSize * 2) {
    console.log(">> Binary concat is MUCH larger - confirms ffmpeg was only using first chunk!");
  }
}

console.log("\nDone! Open recording-test.webm in a browser or VLC to verify full duration playback.");
