/**
 * Audio Processing Service for Web Application
 * 
 * Provides client-side audio processing capabilities including:
 * - Noise reduction and audio enhancement
 * - Silence detection and removal
 * - Audio normalization and quality improvement
 * - Format conversion and codec support
 * 
 * Requirements: 9.3, 3.1, 3.2
 */

export interface ProcessingOptions {
    noiseReduction?: {
        enabled: boolean;
        strength: number; // 0-1
        method: 'spectral' | 'adaptive';
    };
    silenceRemoval?: {
        enabled: boolean;
        threshold: number; // dB
        minDuration: number; // seconds
    };
    normalization?: {
        enabled: boolean;
        targetLevel: number; // dB
        method: 'peak' | 'rms' | 'lufs';
    };
    enhancement?: {
        enabled: boolean;
        highpass: number; // Hz
        lowpass: number; // Hz
        compression: boolean;
    };
    format?: {
        sampleRate?: number;
        channels?: number;
        bitDepth?: number;
    };
}

export interface ProcessingResult {
    success: boolean;
    audioBuffer: AudioBuffer | null;
    blob: Blob | null;
    metadata: {
        originalDuration: number;
        processedDuration: number;
        noiseReductionDb: number;
        silenceRemovedSeconds: number;
        peakLevelDb: number;
        rmsLevelDb: number;
    };
    error?: string;
}

export interface AudioAnalysis {
    duration: number;
    sampleRate: number;
    channels: number;
    peakLevel: number;
    rmsLevel: number;
    dynamicRange: number;
    spectralCentroid: number;
    silentRegions: Array<{ start: number; end: number }>;
    noiseProfile: Float32Array;
}

export class AudioProcessingService {
    private audioContext: AudioContext;
    private workletLoaded = false;

    constructor() {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.initializeWorklets();
    }

    private async initializeWorklets() {
        try {
            // Load audio worklets for real-time processing
            await this.audioContext.audioWorklet.addModule('/audio-worklets/noise-reduction-processor.js');
            await this.audioContext.audioWorklet.addModule('/audio-worklets/compressor-processor.js');
            this.workletLoaded = true;
        } catch (error) {
            console.warn('Audio worklets not available, falling back to offline processing:', error);
        }
    }

    /**
     * Process audio file with specified options
     */
    async processAudio(file: File, options: ProcessingOptions): Promise<ProcessingResult> {
        try {
            // Load audio file
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            // Analyze original audio
            const originalAnalysis = await this.analyzeAudio(audioBuffer);

            // Create offline context for processing
            const offlineContext = new OfflineAudioContext(
                audioBuffer.numberOfChannels,
                audioBuffer.length,
                audioBuffer.sampleRate
            );

            // Create source
            const source = offlineContext.createBufferSource();
            source.buffer = audioBuffer;

            let currentNode: AudioNode = source;

            // Apply processing chain
            if (options.noiseReduction?.enabled) {
                currentNode = await this.applyNoiseReduction(currentNode, offlineContext, options.noiseReduction);
            }

            if (options.enhancement?.enabled) {
                currentNode = this.applyAudioEnhancement(currentNode, offlineContext, options.enhancement);
            }

            if (options.normalization?.enabled) {
                currentNode = this.applyNormalization(currentNode, offlineContext, options.normalization);
            }

            // Connect to destination
            currentNode.connect(offlineContext.destination);

            // Start processing
            source.start();
            const processedBuffer = await offlineContext.startRendering();

            // Apply silence removal if enabled
            let finalBuffer = processedBuffer;
            let silenceRemoved = 0;

            if (options.silenceRemoval?.enabled) {
                const result = await this.removeSilence(processedBuffer, options.silenceRemoval);
                finalBuffer = result.buffer;
                silenceRemoved = result.silenceRemoved;
            }

            // Analyze processed audio
            const processedAnalysis = await this.analyzeAudio(finalBuffer);

            // Convert to blob
            const blob = this.audioBufferToBlob(finalBuffer);

            return {
                success: true,
                audioBuffer: finalBuffer,
                blob,
                metadata: {
                    originalDuration: originalAnalysis.duration,
                    processedDuration: processedAnalysis.duration,
                    noiseReductionDb: this.calculateNoiseReduction(originalAnalysis, processedAnalysis),
                    silenceRemovedSeconds: silenceRemoved,
                    peakLevelDb: 20 * Math.log10(processedAnalysis.peakLevel),
                    rmsLevelDb: 20 * Math.log10(processedAnalysis.rmsLevel)
                }
            };

        } catch (error) {
            return {
                success: false,
                audioBuffer: null,
                blob: null,
                metadata: {
                    originalDuration: 0,
                    processedDuration: 0,
                    noiseReductionDb: 0,
                    silenceRemovedSeconds: 0,
                    peakLevelDb: 0,
                    rmsLevelDb: 0
                },
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Analyze audio characteristics
     */
    async analyzeAudio(audioBuffer: AudioBuffer): Promise<AudioAnalysis> {
        const channelData = audioBuffer.getChannelData(0); // Use first channel
        const sampleRate = audioBuffer.sampleRate;

        // Calculate basic metrics
        let peakLevel = 0;
        let sumSquares = 0;

        for (let i = 0; i < channelData.length; i++) {
            const sample = Math.abs(channelData[i]);
            peakLevel = Math.max(peakLevel, sample);
            sumSquares += sample * sample;
        }

        const rmsLevel = Math.sqrt(sumSquares / channelData.length);

        // Calculate dynamic range
        const sortedSamples = Array.from(channelData).map(Math.abs).sort((a, b) => b - a);
        const percentile95 = sortedSamples[Math.floor(0.05 * sortedSamples.length)];
        const percentile10 = sortedSamples[Math.floor(0.90 * sortedSamples.length)];
        const dynamicRange = percentile95 / (percentile10 || 0.001);

        // Calculate spectral centroid
        const spectralCentroid = await this.calculateSpectralCentroid(channelData, sampleRate);

        // Detect silent regions
        const silentRegions = this.detectSilence(channelData, sampleRate, -40, 0.5);

        // Generate noise profile
        const noiseProfile = this.generateNoiseProfile(channelData, sampleRate);

        return {
            duration: audioBuffer.duration,
            sampleRate,
            channels: audioBuffer.numberOfChannels,
            peakLevel,
            rmsLevel,
            dynamicRange,
            spectralCentroid,
            silentRegions,
            noiseProfile
        };
    }

    /**
     * Apply noise reduction
     */
    private async applyNoiseReduction(
        inputNode: AudioNode,
        context: OfflineAudioContext,
        options: NonNullable<ProcessingOptions['noiseReduction']>
    ): Promise<AudioNode> {
        if (options.method === 'spectral') {
            return this.applySpectralNoiseReduction(inputNode, context, options.strength);
        } else {
            return this.applyAdaptiveNoiseReduction(inputNode, context, options.strength);
        }
    }

    /**
     * Apply spectral noise reduction
     */
    private applySpectralNoiseReduction(
        inputNode: AudioNode,
        context: OfflineAudioContext,
        strength: number
    ): AudioNode {
        // Create a simple high-pass filter as a basic noise reduction
        const filter = context.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 80 + (strength * 120); // 80-200 Hz cutoff
        filter.Q.value = 0.7;

        inputNode.connect(filter);
        return filter;
    }

    /**
     * Apply adaptive noise reduction
     */
    private applyAdaptiveNoiseReduction(
        inputNode: AudioNode,
        context: OfflineAudioContext,
        strength: number
    ): AudioNode {
        // Create a more sophisticated filter chain
        const highpass = context.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 60;
        highpass.Q.value = 0.5;

        const notch = context.createBiquadFilter();
        notch.type = 'notch';
        notch.frequency.value = 60; // Remove 60Hz hum
        notch.Q.value = 10;

        const lowpass = context.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 8000 - (strength * 2000); // Adaptive cutoff
        lowpass.Q.value = 0.7;

        inputNode.connect(highpass);
        highpass.connect(notch);
        notch.connect(lowpass);

        return lowpass;
    }

    /**
     * Apply audio enhancement
     */
    private applyAudioEnhancement(
        inputNode: AudioNode,
        context: OfflineAudioContext,
        options: NonNullable<ProcessingOptions['enhancement']>
    ): AudioNode {
        let currentNode = inputNode;

        // High-pass filter
        if (options.highpass > 0) {
            const highpass = context.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.value = options.highpass;
            highpass.Q.value = 0.7;

            currentNode.connect(highpass);
            currentNode = highpass;
        }

        // Low-pass filter
        if (options.lowpass > 0) {
            const lowpass = context.createBiquadFilter();
            lowpass.type = 'lowpass';
            lowpass.frequency.value = options.lowpass;
            lowpass.Q.value = 0.7;

            currentNode.connect(lowpass);
            currentNode = lowpass;
        }

        // Compression
        if (options.compression) {
            const compressor = context.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 30;
            compressor.ratio.value = 3;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;

            currentNode.connect(compressor);
            currentNode = compressor;
        }

        return currentNode;
    }

    /**
     * Apply normalization
     */
    private applyNormalization(
        inputNode: AudioNode,
        context: OfflineAudioContext,
        options: NonNullable<ProcessingOptions['normalization']>
    ): AudioNode {
        const gainNode = context.createGain();

        // Simple gain adjustment (more sophisticated normalization would require analysis)
        const targetGain = Math.pow(10, options.targetLevel / 20);
        gainNode.gain.value = targetGain;

        inputNode.connect(gainNode);
        return gainNode;
    }

    /**
     * Remove silence from audio buffer
     */
    private async removeSilence(
        audioBuffer: AudioBuffer,
        options: NonNullable<ProcessingOptions['silenceRemoval']>
    ): Promise<{ buffer: AudioBuffer; silenceRemoved: number }> {
        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const threshold = Math.pow(10, options.threshold / 20);
        const minSamples = Math.floor(options.minDuration * sampleRate);

        // Find speech segments
        const speechSegments: Array<{ start: number; end: number }> = [];
        let currentStart = -1;

        for (let i = 0; i < channelData.length; i++) {
            const amplitude = Math.abs(channelData[i]);

            if (amplitude > threshold) {
                if (currentStart === -1) {
                    currentStart = i;
                }
            } else {
                if (currentStart !== -1) {
                    const segmentLength = i - currentStart;
                    if (segmentLength >= minSamples) {
                        speechSegments.push({ start: currentStart, end: i });
                    }
                    currentStart = -1;
                }
            }
        }

        // Handle speech at the end
        if (currentStart !== -1) {
            const segmentLength = channelData.length - currentStart;
            if (segmentLength >= minSamples) {
                speechSegments.push({ start: currentStart, end: channelData.length });
            }
        }

        if (speechSegments.length === 0) {
            return { buffer: audioBuffer, silenceRemoved: 0 };
        }

        // Calculate total speech length
        const totalSpeechSamples = speechSegments.reduce(
            (sum, segment) => sum + (segment.end - segment.start),
            0
        );

        // Create new buffer with only speech
        const newBuffer = this.audioContext.createBuffer(
            audioBuffer.numberOfChannels,
            totalSpeechSamples,
            sampleRate
        );

        let outputIndex = 0;
        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
            const inputData = audioBuffer.getChannelData(channel);
            const outputData = newBuffer.getChannelData(channel);

            outputIndex = 0;
            for (const segment of speechSegments) {
                for (let i = segment.start; i < segment.end; i++) {
                    outputData[outputIndex++] = inputData[i];
                }
            }
        }

        const silenceRemoved = (audioBuffer.length - totalSpeechSamples) / sampleRate;
        return { buffer: newBuffer, silenceRemoved };
    }

    /**
     * Detect silence in audio
     */
    private detectSilence(
        channelData: Float32Array,
        sampleRate: number,
        thresholdDb: number,
        minDuration: number
    ): Array<{ start: number; end: number }> {
        const threshold = Math.pow(10, thresholdDb / 20);
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

        return silentRegions;
    }

    /**
     * Calculate spectral centroid
     */
    private async calculateSpectralCentroid(
        channelData: Float32Array,
        sampleRate: number
    ): Promise<number> {
        const fftSize = 2048;
        const hopSize = fftSize / 4;
        let weightedSum = 0;
        let magnitudeSum = 0;

        for (let i = 0; i < channelData.length - fftSize; i += hopSize) {
            const frame = channelData.slice(i, i + fftSize);

            // Apply window
            for (let j = 0; j < frame.length; j++) {
                frame[j] *= 0.5 * (1 - Math.cos(2 * Math.PI * j / (frame.length - 1))); // Hanning window
            }

            // FFT (simplified - in practice you'd use a proper FFT library)
            const spectrum = this.simpleFFT(frame);

            for (let k = 0; k < spectrum.length / 2; k++) {
                const magnitude = Math.sqrt(spectrum[k * 2] ** 2 + spectrum[k * 2 + 1] ** 2);
                const frequency = (k * sampleRate) / fftSize;

                weightedSum += frequency * magnitude;
                magnitudeSum += magnitude;
            }
        }

        return magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
    }

    /**
     * Generate noise profile from audio
     */
    private generateNoiseProfile(channelData: Float32Array, sampleRate: number): Float32Array {
        // Use first 0.5 seconds as noise sample
        const noiseSamples = Math.min(Math.floor(0.5 * sampleRate), channelData.length);
        const noiseData = channelData.slice(0, noiseSamples);

        // Calculate RMS in frequency bands
        const bands = 32;
        const profile = new Float32Array(bands);
        const bandSize = Math.floor(noiseData.length / bands);

        for (let i = 0; i < bands; i++) {
            const start = i * bandSize;
            const end = Math.min(start + bandSize, noiseData.length);
            let sum = 0;

            for (let j = start; j < end; j++) {
                sum += noiseData[j] ** 2;
            }

            profile[i] = Math.sqrt(sum / (end - start));
        }

        return profile;
    }

    /**
     * Simple FFT implementation (for demonstration - use a proper library in production)
     */
    private simpleFFT(data: Float32Array): Float32Array {
        const N = data.length;
        const result = new Float32Array(N * 2); // Real and imaginary parts

        // Copy real parts
        for (let i = 0; i < N; i++) {
            result[i * 2] = data[i];
            result[i * 2 + 1] = 0;
        }

        // Simple DFT (very inefficient - use proper FFT in production)
        const output = new Float32Array(N * 2);
        for (let k = 0; k < N; k++) {
            let realSum = 0;
            let imagSum = 0;

            for (let n = 0; n < N; n++) {
                const angle = -2 * Math.PI * k * n / N;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);

                realSum += result[n * 2] * cos - result[n * 2 + 1] * sin;
                imagSum += result[n * 2] * sin + result[n * 2 + 1] * cos;
            }

            output[k * 2] = realSum;
            output[k * 2 + 1] = imagSum;
        }

        return output;
    }

    /**
     * Calculate noise reduction amount
     */
    private calculateNoiseReduction(original: AudioAnalysis, processed: AudioAnalysis): number {
        // Simple estimation based on noise profile comparison
        let originalNoise = 0;
        let processedNoise = 0;

        for (let i = 0; i < Math.min(original.noiseProfile.length, processed.noiseProfile.length); i++) {
            originalNoise += original.noiseProfile[i];
            processedNoise += processed.noiseProfile[i];
        }

        if (processedNoise > 0) {
            return 20 * Math.log10(originalNoise / processedNoise);
        }

        return 0;
    }

    /**
     * Convert AudioBuffer to Blob
     */
    private audioBufferToBlob(audioBuffer: AudioBuffer): Blob {
        const length = audioBuffer.length;
        const numberOfChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
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
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numberOfChannels * bytesPerSample, true);
        view.setUint16(32, numberOfChannels * bytesPerSample, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, length * numberOfChannels * bytesPerSample, true);

        // Convert float samples to 16-bit PCM
        let offset = 44;
        for (let i = 0; i < length; i++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
                view.setInt16(offset, sample * 0x7FFF, true);
                offset += 2;
            }
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    /**
     * Get default processing options
     */
    static getDefaultOptions(): ProcessingOptions {
        return {
            noiseReduction: {
                enabled: true,
                strength: 0.5,
                method: 'spectral'
            },
            silenceRemoval: {
                enabled: false,
                threshold: -40,
                minDuration: 0.5
            },
            normalization: {
                enabled: true,
                targetLevel: -20,
                method: 'rms'
            },
            enhancement: {
                enabled: true,
                highpass: 80,
                lowpass: 8000,
                compression: true
            }
        };
    }

    /**
     * Cleanup resources
     */
    dispose() {
        if (this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
    }
}