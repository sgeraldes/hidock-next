/**
 * Audio utilities for format validation, conversion, and processing
 * Requirements: 8.2, 8.3, 9.3
 */

export interface AudioFormat {
    extension: string;
    mimeType: string;
    label: string;
    quality: 'low' | 'medium' | 'high' | 'lossless';
}

export interface AudioMetadata {
    duration: number;
    sampleRate: number;
    channels: number;
    bitRate: number;
    format: string;
    size: number;
}

export interface ConversionOptions {
    targetFormat: string;
    quality: number; // 0-1
    sampleRate?: number;
    channels?: number;
    normalize?: boolean;
}

// Supported audio formats
export const SUPPORTED_FORMATS: AudioFormat[] = [
    { extension: 'mp3', mimeType: 'audio/mpeg', label: 'MP3', quality: 'medium' },
    { extension: 'wav', mimeType: 'audio/wav', label: 'WAV', quality: 'lossless' },
    { extension: 'm4a', mimeType: 'audio/mp4', label: 'M4A', quality: 'high' },
    { extension: 'ogg', mimeType: 'audio/ogg', label: 'OGG', quality: 'medium' },
    { extension: 'flac', mimeType: 'audio/flac', label: 'FLAC', quality: 'lossless' },
    { extension: 'aac', mimeType: 'audio/aac', label: 'AAC', quality: 'high' },
    { extension: 'webm', mimeType: 'audio/webm', label: 'WebM', quality: 'medium' }
];

/**
 * Validate if a file is a supported audio format
 */
export function validateAudioFile(file: File): { isValid: boolean; error?: string; format?: AudioFormat } {
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (!extension) {
        return { isValid: false, error: 'File has no extension' };
    }

    const format = SUPPORTED_FORMATS.find(f => f.extension === extension);

    if (!format) {
        return {
            isValid: false,
            error: `Unsupported format: ${extension}. Supported formats: ${SUPPORTED_FORMATS.map(f => f.extension).join(', ')}`
        };
    }

    // Check MIME type if available
    if (file.type && !file.type.startsWith('audio/')) {
        return { isValid: false, error: 'File is not an audio file' };
    }

    // Check file size (max 100MB)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
        return { isValid: false, error: 'File size exceeds 100MB limit' };
    }

    return { isValid: true, format };
}

/**
 * Extract audio metadata from file
 */
export async function extractAudioMetadata(file: File): Promise<AudioMetadata> {
    return new Promise((resolve, reject) => {
        const audio = new Audio();
        const url = URL.createObjectURL(file);

        audio.addEventListener('loadedmetadata', () => {
            const metadata: AudioMetadata = {
                duration: audio.duration,
                sampleRate: 44100, // Default, actual value would need Web Audio API
                channels: 2, // Default, actual value would need Web Audio API
                bitRate: Math.round((file.size * 8) / audio.duration), // Estimated
                format: file.name.split('.').pop()?.toLowerCase() || 'unknown',
                size: file.size
            };

            URL.revokeObjectURL(url);
            resolve(metadata);
        });

        audio.addEventListener('error', () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load audio metadata'));
        });

        audio.src = url;
    });
}

/**
 * Get detailed audio information using Web Audio API
 */
export async function getDetailedAudioInfo(file: File): Promise<AudioMetadata> {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const metadata: AudioMetadata = {
            duration: audioBuffer.duration,
            sampleRate: audioBuffer.sampleRate,
            channels: audioBuffer.numberOfChannels,
            bitRate: Math.round((file.size * 8) / audioBuffer.duration),
            format: file.name.split('.').pop()?.toLowerCase() || 'unknown',
            size: file.size
        };

        audioContext.close();
        return metadata;
    } catch (error) {
        console.warn('Failed to get detailed audio info, falling back to basic metadata:', error);
        return extractAudioMetadata(file);
    }
}

/**
 * Convert audio format (client-side conversion is limited)
 */
export async function convertAudioFormat(
    file: File,
    options: ConversionOptions
): Promise<{ blob: Blob; metadata: AudioMetadata }> {
    try {
        const audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Create new buffer with target specifications
        const targetSampleRate = options.sampleRate || audioBuffer.sampleRate;
        const targetChannels = options.channels || audioBuffer.numberOfChannels;

        let processedBuffer = audioBuffer;

        // Resample if needed (basic implementation)
        if (targetSampleRate !== audioBuffer.sampleRate) {
            const ratio = targetSampleRate / audioBuffer.sampleRate;
            const newLength = Math.round(audioBuffer.length * ratio);
            processedBuffer = audioContext.createBuffer(
                audioBuffer.numberOfChannels,
                newLength,
                targetSampleRate
            );

            // Simple linear interpolation resampling
            for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
                const inputData = audioBuffer.getChannelData(channel);
                const outputData = processedBuffer.getChannelData(channel);

                for (let i = 0; i < newLength; i++) {
                    const position = i / ratio;
                    const index = Math.floor(position);
                    const fraction = position - index;

                    if (index + 1 < inputData.length) {
                        outputData[i] = inputData[index] * (1 - fraction) + inputData[index + 1] * fraction;
                    } else {
                        outputData[i] = inputData[index] || 0;
                    }
                }
            }
        }

        // Convert to mono if needed
        if (targetChannels === 1 && processedBuffer.numberOfChannels > 1) {
            const monoBuffer = audioContext.createBuffer(1, processedBuffer.length, targetSampleRate);
            const monoData = monoBuffer.getChannelData(0);

            for (let i = 0; i < processedBuffer.length; i++) {
                let sum = 0;
                for (let channel = 0; channel < processedBuffer.numberOfChannels; channel++) {
                    sum += processedBuffer.getChannelData(channel)[i];
                }
                monoData[i] = sum / processedBuffer.numberOfChannels;
            }

            processedBuffer = monoBuffer;
        }

        // Normalize if requested
        if (options.normalize) {
            for (let channel = 0; channel < processedBuffer.numberOfChannels; channel++) {
                const channelData = processedBuffer.getChannelData(channel);
                const maxValue = Math.max(...channelData.map(Math.abs));

                if (maxValue > 0) {
                    const normalizeRatio = 0.95 / maxValue; // Leave some headroom
                    for (let i = 0; i < channelData.length; i++) {
                        channelData[i] *= normalizeRatio;
                    }
                }
            }
        }

        // Convert to WAV (most compatible format for client-side)
        const wavBlob = audioBufferToWav(processedBuffer);

        const metadata: AudioMetadata = {
            duration: processedBuffer.duration,
            sampleRate: processedBuffer.sampleRate,
            channels: processedBuffer.numberOfChannels,
            bitRate: Math.round((wavBlob.size * 8) / processedBuffer.duration),
            format: 'wav',
            size: wavBlob.size
        };

        audioContext.close();

        return { blob: wavBlob, metadata };
    } catch (error) {
        throw new Error(`Audio conversion failed: ${error}`);
    }
}

/**
 * Convert AudioBuffer to WAV blob
 */
function audioBufferToWav(buffer: AudioBuffer): Blob {
    const length = buffer.length;
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = 2; // 16-bit

    const arrayBuffer = new ArrayBuffer(44 + length * numberOfChannels * bytesPerSample);
    const view = new DataView(arrayBuffer);

    // WAV header
    const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * numberOfChannels * bytesPerSample, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM format
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * bytesPerSample, true);
    view.setUint16(32, numberOfChannels * bytesPerSample, true);
    view.setUint16(34, 16, true); // 16-bit
    writeString(36, 'data');
    view.setUint32(40, length * numberOfChannels * bytesPerSample, true);

    // Convert float samples to 16-bit PCM
    let offset = 44;
    for (let i = 0; i < length; i++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
            view.setInt16(offset, sample * 0x7FFF, true);
            offset += 2;
        }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Apply audio effects
 */
export async function applyAudioEffects(
    file: File,
    effects: {
        volume?: number; // 0-2
        fadeIn?: number; // seconds
        fadeOut?: number; // seconds
        highpass?: number; // Hz
        lowpass?: number; // Hz
        reverb?: boolean;
    }
): Promise<Blob> {
    try {
        const audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Create offline context for processing
        const offlineContext = new OfflineAudioContext(
            audioBuffer.numberOfChannels,
            audioBuffer.length,
            audioBuffer.sampleRate
        );

        const source = offlineContext.createBufferSource();
        source.buffer = audioBuffer;

        let currentNode: AudioNode = source;

        // Apply volume
        if (effects.volume !== undefined && effects.volume !== 1) {
            const gainNode = offlineContext.createGain();
            gainNode.gain.value = effects.volume;
            currentNode.connect(gainNode);
            currentNode = gainNode;
        }

        // Apply fade in/out
        if (effects.fadeIn || effects.fadeOut) {
            const fadeGain = offlineContext.createGain();

            if (effects.fadeIn) {
                fadeGain.gain.setValueAtTime(0, 0);
                fadeGain.gain.linearRampToValueAtTime(1, effects.fadeIn);
            }

            if (effects.fadeOut) {
                const fadeStart = audioBuffer.duration - effects.fadeOut;
                fadeGain.gain.setValueAtTime(1, fadeStart);
                fadeGain.gain.linearRampToValueAtTime(0, audioBuffer.duration);
            }

            currentNode.connect(fadeGain);
            currentNode = fadeGain;
        }

        // Apply filters
        if (effects.highpass) {
            const highpassFilter = offlineContext.createBiquadFilter();
            highpassFilter.type = 'highpass';
            highpassFilter.frequency.value = effects.highpass;
            currentNode.connect(highpassFilter);
            currentNode = highpassFilter;
        }

        if (effects.lowpass) {
            const lowpassFilter = offlineContext.createBiquadFilter();
            lowpassFilter.type = 'lowpass';
            lowpassFilter.frequency.value = effects.lowpass;
            currentNode.connect(lowpassFilter);
            currentNode = lowpassFilter;
        }

        // Apply reverb (simple convolution)
        if (effects.reverb) {
            const convolver = offlineContext.createConvolver();
            convolver.buffer = createReverbImpulse(offlineContext, 2, 0.3);

            const wetGain = offlineContext.createGain();
            const dryGain = offlineContext.createGain();
            wetGain.gain.value = 0.3;
            dryGain.gain.value = 0.7;

            currentNode.connect(dryGain);
            currentNode.connect(convolver);
            convolver.connect(wetGain);

            const merger = offlineContext.createChannelMerger(2);
            dryGain.connect(merger);
            wetGain.connect(merger);

            currentNode = merger;
        }

        currentNode.connect(offlineContext.destination);
        source.start();

        const processedBuffer = await offlineContext.startRendering();
        audioContext.close();

        return audioBufferToWav(processedBuffer);
    } catch (error) {
        throw new Error(`Audio effects processing failed: ${error}`);
    }
}

/**
 * Create a simple reverb impulse response
 */
function createReverbImpulse(
    audioContext: OfflineAudioContext,
    duration: number,
    decay: number
): AudioBuffer {
    const sampleRate = audioContext.sampleRate;
    const length = sampleRate * duration;
    const impulse = audioContext.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
        const channelData = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            const n = length - i;
            channelData[i] = (Math.random() * 2 - 1) * Math.pow(n / length, decay);
        }
    }

    return impulse;
}

/**
 * Analyze audio for silence detection
 */
export async function detectSilence(
    file: File,
    threshold: number = 0.01,
    minDuration: number = 0.5
): Promise<Array<{ start: number; end: number }>> {
    try {
        const audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const channelData = audioBuffer.getChannelData(0); // Use first channel
        const sampleRate = audioBuffer.sampleRate;
        const minSamples = Math.floor(minDuration * sampleRate);

        const silentRegions: Array<{ start: number; end: number }> = [];
        let silentStart = -1;

        for (let i = 0; i < channelData.length; i++) {
            const amplitude = Math.abs(channelData[i]);

            if (amplitude < threshold) {
                if (silentStart === -1) {
                    silentStart = i;
                }
            } else {
                if (silentStart !== -1) {
                    const silentLength = i - silentStart;
                    if (silentLength >= minSamples) {
                        silentRegions.push({
                            start: silentStart / sampleRate,
                            end: i / sampleRate
                        });
                    }
                    silentStart = -1;
                }
            }
        }

        // Handle silence at the end
        if (silentStart !== -1) {
            const silentLength = channelData.length - silentStart;
            if (silentLength >= minSamples) {
                silentRegions.push({
                    start: silentStart / sampleRate,
                    end: channelData.length / sampleRate
                });
            }
        }

        audioContext.close();
        return silentRegions;
    } catch (error) {
        throw new Error(`Silence detection failed: ${error}`);
    }
}

/**
 * Trim silence from audio
 */
export async function trimSilence(
    file: File,
    threshold: number = 0.01
): Promise<{ blob: Blob; trimmedStart: number; trimmedEnd: number }> {
    try {
        const audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;

        // Find start of audio content
        let startSample = 0;
        for (let i = 0; i < channelData.length; i++) {
            if (Math.abs(channelData[i]) > threshold) {
                startSample = i;
                break;
            }
        }

        // Find end of audio content
        let endSample = channelData.length - 1;
        for (let i = channelData.length - 1; i >= 0; i--) {
            if (Math.abs(channelData[i]) > threshold) {
                endSample = i;
                break;
            }
        }

        // Create trimmed buffer
        const trimmedLength = endSample - startSample + 1;
        const trimmedBuffer = audioContext.createBuffer(
            audioBuffer.numberOfChannels,
            trimmedLength,
            sampleRate
        );

        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
            const originalData = audioBuffer.getChannelData(channel);
            const trimmedData = trimmedBuffer.getChannelData(channel);

            for (let i = 0; i < trimmedLength; i++) {
                trimmedData[i] = originalData[startSample + i];
            }
        }

        const blob = audioBufferToWav(trimmedBuffer);

        audioContext.close();

        return {
            blob,
            trimmedStart: startSample / sampleRate,
            trimmedEnd: (channelData.length - endSample - 1) / sampleRate
        };
    } catch (error) {
        throw new Error(`Audio trimming failed: ${error}`);
    }
}

/**
 * Generate audio waveform data for visualization
 */
export async function generateWaveformData(
    file: File,
    samples: number = 1000
): Promise<Float32Array> {
    try {
        const audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const channelData = audioBuffer.getChannelData(0); // Use first channel
        const blockSize = Math.floor(channelData.length / samples);
        const waveformData = new Float32Array(samples);

        for (let i = 0; i < samples; i++) {
            const start = i * blockSize;
            const end = Math.min(start + blockSize, channelData.length);

            let max = 0;
            for (let j = start; j < end; j++) {
                const amplitude = Math.abs(channelData[j]);
                if (amplitude > max) {
                    max = amplitude;
                }
            }

            waveformData[i] = max;
        }

        audioContext.close();
        return waveformData;
    } catch (error) {
        throw new Error(`Waveform generation failed: ${error}`);
    }
}
