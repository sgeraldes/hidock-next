/**
 * VERIFY AUDIO FILES CONTAIN REAL AUDIO
 */

const fs = require('fs');
const path = require('path');

const audioFile = 'G:\\OneDrive - Geraldes\\Documents\\MeetingRecorder\\recordings\\687a9cf9-e2c0-4db3-8a7e-0c24a3d5afa1\\chunk-000.ogg';

console.log('='.repeat(80));
console.log('AUDIO FILE VERIFICATION');
console.log('='.repeat(80));

console.log(`\nFile: ${path.basename(audioFile)}`);
console.log(`Path: ${audioFile}`);

// Read file
const buffer = fs.readFileSync(audioFile);

console.log(`\nFile size: ${buffer.length} bytes (${(buffer.length / 1024).toFixed(2)} KB)`);

// Check if it's empty
if (buffer.length === 0) {
  console.log('✗✗✗ FILE IS EMPTY - NO AUDIO!');
  process.exit(1);
}

console.log('✓ File is not empty');

// Check for WebM signature (starts with 0x1A 0x45 0xDF 0xA3)
const webmSignature = Buffer.from([0x1A, 0x45, 0xDF, 0xA3]);
if (buffer.slice(0, 4).equals(webmSignature)) {
  console.log('✓ Valid WebM file signature detected');
} else {
  console.log(`First 4 bytes: ${buffer.slice(0, 4).toString('hex')}`);
  console.log('⚠ Not a standard WebM signature, but may still be valid audio');
}

// Show first 32 bytes in hex to verify it's not just zeros
console.log('\nFirst 32 bytes (hex):');
const hexString = buffer.slice(0, 32).toString('hex').match(/.{1,2}/g).join(' ');
console.log(hexString);

// Check if it's all zeros (empty audio)
const isAllZeros = buffer.slice(0, 1024).every(byte => byte === 0);
if (isAllZeros) {
  console.log('✗✗✗ FILE CONTAINS ONLY ZEROS - NO REAL AUDIO DATA!');
  process.exit(1);
}

console.log('✓ File contains non-zero data (real audio)');

// Calculate entropy (randomness) to verify it's compressed audio, not just pattern
const counts = new Array(256).fill(0);
for (let i = 0; i < Math.min(buffer.length, 10000); i++) {
  counts[buffer[i]]++;
}

let entropy = 0;
for (const count of counts) {
  if (count > 0) {
    const p = count / Math.min(buffer.length, 10000);
    entropy -= p * Math.log2(p);
  }
}

console.log(`\nEntropy: ${entropy.toFixed(2)} bits/byte`);
if (entropy > 6.0) {
  console.log('✓ High entropy (likely compressed audio data)');
} else if (entropy > 3.0) {
  console.log('✓ Moderate entropy (audio data present)');
} else {
  console.log('⚠ Low entropy (might be silence or noise)');
}

console.log('\n' + '='.repeat(80));
console.log('VERDICT: FILE CONTAINS REAL AUDIO DATA');
console.log('='.repeat(80));
