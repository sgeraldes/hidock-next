/**
 * Audio Processing Component for Web Application
 * 
 * Provides UI for advanced audio processing features including:
 * - Noise reduction controls
 * - Silence detection and removal
 * - Audio normalization settings
 * - Real-time processing preview
 * 
 * Requirements: 8.2, 8.3, 9.3
 */

import { AudioVisualization } from '@/components/AudioVisualization';
import { AudioProcessingService, ProcessingOptions, ProcessingResult } from '@/services/audioProcessingService';
import { formatDuration, formatFileSize } from '@/utils/formatters';
import {
    Download,
    Eye,
    EyeOff,
    Pause,
    Play,
    RotateCcw,
    Settings,
    Upload,
    Zap
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface AudioProcessorProps {
    onProcessingComplete?: (result: ProcessingResult) => void;
    onError?: (error: string) => void;
    className?: string;
}

export const AudioProcessor: React.FC<AudioProcessorProps> = ({
    onProcessingComplete,
    onError,
    className = ''
}) => {
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingProgress, setProcessingProgress] = useState(0);
    const [processedResult, setProcessedResult] = useState<ProcessingResult | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    const [options, setOptions] = useState<ProcessingOptions>(() =>
        AudioProcessingService.getDefaultOptions()
    );

    const audioRef = useRef<HTMLAudioElement>(null);
    const processingServiceRef = useRef<AudioProcessingService>();
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        processingServiceRef.current = new AudioProcessingService();

        return () => {
            processingServiceRef.current?.dispose();
        };
    }, []);

    const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('audio/')) {
            onError?.('Please select a valid audio file');
            return;
        }

        // Check file size (max 100MB)
        if (file.size > 100 * 1024 * 1024) {
            onError?.('File size must be less than 100MB');
            return;
        }

        setAudioFile(file);
        setProcessedResult(null);
        setCurrentTime(0);
        setDuration(0);

        // Load audio for preview
        const audio = new Audio();
        audio.addEventListener('loadedmetadata', () => {
            setDuration(audio.duration);
        });
        audio.src = URL.createObjectURL(file);
    }, [onError]);

    const handleDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
    }, []);

    const handleDrop = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file && file.type.startsWith('audio/')) {
            setAudioFile(file);
        }
    }, []);

    const processAudio = useCallback(async () => {
        if (!audioFile || !processingServiceRef.current) return;

        setIsProcessing(true);
        setProcessingProgress(0);

        try {
            // Simulate progress updates
            const progressInterval = setInterval(() => {
                setProcessingProgress(prev => Math.min(prev + 10, 90));
            }, 200);

            const result = await processingServiceRef.current.processAudio(audioFile, options);

            clearInterval(progressInterval);
            setProcessingProgress(100);

            if (result.success) {
                setProcessedResult(result);
                onProcessingComplete?.(result);
            } else {
                onError?.(result.error || 'Processing failed');
            }
        } catch (error) {
            onError?.(error instanceof Error ? error.message : 'Processing failed');
        } finally {
            setIsProcessing(false);
            setTimeout(() => setProcessingProgress(0), 1000);
        }
    }, [audioFile, options, onProcessingComplete, onError]);

    const playAudio = useCallback((processed = false) => {
        const audio = audioRef.current;
        if (!audio) return;

        if (processed && processedResult?.blob) {
            audio.src = URL.createObjectURL(processedResult.blob);
        } else if (audioFile) {
            audio.src = URL.createObjectURL(audioFile);
        }

        if (isPlaying) {
            audio.pause();
            setIsPlaying(false);
        } else {
            audio.play();
            setIsPlaying(true);
        }
    }, [audioFile, processedResult, isPlaying]);

    const downloadProcessed = useCallback(() => {
        if (!processedResult?.blob || !audioFile) return;

        const url = URL.createObjectURL(processedResult.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${audioFile.name.split('.')[0]}_processed.wav`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [processedResult, audioFile]);

    const resetSettings = useCallback(() => {
        setOptions(AudioProcessingService.getDefaultOptions());
    }, []);

    const updateOption = useCallback(<T extends keyof ProcessingOptions>(
        category: T,
        updates: Partial<ProcessingOptions[T]>
    ) => {
        setOptions(prev => ({
            ...prev,
            [category]: {
                ...prev[category],
                ...updates
            }
        }));
    }, []);

    return (
        <div className={`bg-slate-800 rounded-lg p-6 ${className}`}>
            <audio
                ref={audioRef}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onEnded={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
            />

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-slate-100">Audio Processor</h2>

                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => setShowPreview(!showPreview)}
                        className={`p-2 rounded-lg transition-colors ${showPreview ? 'bg-primary-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                            }`}
                        title="Toggle preview"
                    >
                        {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>

                    <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className={`p-2 rounded-lg transition-colors ${showAdvanced ? 'bg-primary-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                            }`}
                        title="Advanced settings"
                    >
                        <Settings className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* File Upload */}
            {!audioFile && (
                <div
                    className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center hover:border-slate-500 transition-colors cursor-pointer"
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                    <p className="text-slate-300 mb-2">Drop an audio file here or click to browse</p>
                    <p className="text-sm text-slate-500">Supports MP3, WAV, M4A, OGG, FLAC (max 100MB)</p>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*"
                        onChange={handleFileSelect}
                        className="hidden"
                    />
                </div>
            )}

            {/* File Info */}
            {audioFile && (
                <div className="bg-slate-700 rounded-lg p-4 mb-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-medium text-slate-100">{audioFile.name}</h3>
                            <p className="text-sm text-slate-400">
                                {formatFileSize(audioFile.size)} • {formatDuration(duration)}
                            </p>
                        </div>

                        <div className="flex items-center space-x-2">
                            <button
                                onClick={() => playAudio(false)}
                                className="p-2 bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
                                disabled={isProcessing}
                            >
                                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                            </button>

                            <button
                                onClick={() => {
                                    setAudioFile(null);
                                    setProcessedResult(null);
                                }}
                                className="p-2 bg-slate-600 hover:bg-slate-500 rounded-lg transition-colors"
                            >
                                <RotateCcw className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Processing Controls */}
            {audioFile && (
                <div className="space-y-6">
                    {/* Basic Controls */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-slate-700 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-medium text-slate-300">Noise Reduction</label>
                                <input
                                    type="checkbox"
                                    checked={options.noiseReduction?.enabled}
                                    onChange={(e) => updateOption('noiseReduction', { enabled: e.target.checked })}
                                    className="rounded"
                                />
                            </div>
                            {options.noiseReduction?.enabled && (
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={options.noiseReduction.strength}
                                    onChange={(e) => updateOption('noiseReduction', { strength: parseFloat(e.target.value) })}
                                    className="w-full"
                                />
                            )}
                        </div>

                        <div className="bg-slate-700 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-medium text-slate-300">Remove Silence</label>
                                <input
                                    type="checkbox"
                                    checked={options.silenceRemoval?.enabled}
                                    onChange={(e) => updateOption('silenceRemoval', { enabled: e.target.checked })}
                                    className="rounded"
                                />
                            </div>
                            {options.silenceRemoval?.enabled && (
                                <input
                                    type="range"
                                    min="-60"
                                    max="-20"
                                    step="5"
                                    value={options.silenceRemoval.threshold}
                                    onChange={(e) => updateOption('silenceRemoval', { threshold: parseFloat(e.target.value) })}
                                    className="w-full"
                                />
                            )}
                        </div>

                        <div className="bg-slate-700 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-medium text-slate-300">Normalize</label>
                                <input
                                    type="checkbox"
                                    checked={options.normalization?.enabled}
                                    onChange={(e) => updateOption('normalization', { enabled: e.target.checked })}
                                    className="rounded"
                                />
                            </div>
                            {options.normalization?.enabled && (
                                <input
                                    type="range"
                                    min="-30"
                                    max="-6"
                                    step="1"
                                    value={options.normalization.targetLevel}
                                    onChange={(e) => updateOption('normalization', { targetLevel: parseFloat(e.target.value) })}
                                    className="w-full"
                                />
                            )}
                        </div>

                        <div className="bg-slate-700 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-medium text-slate-300">Enhancement</label>
                                <input
                                    type="checkbox"
                                    checked={options.enhancement?.enabled}
                                    onChange={(e) => updateOption('enhancement', { enabled: e.target.checked })}
                                    className="rounded"
                                />
                            </div>
                            {options.enhancement?.enabled && (
                                <div className="text-xs text-slate-400">
                                    Filters & Compression
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Advanced Settings */}
                    {showAdvanced && (
                        <div className="bg-slate-700 rounded-lg p-4">
                            <h3 className="font-medium text-slate-100 mb-4">Advanced Settings</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Noise Reduction Advanced */}
                                {options.noiseReduction?.enabled && (
                                    <div>
                                        <h4 className="text-sm font-medium text-slate-300 mb-3">Noise Reduction</h4>
                                        <div className="space-y-3">
                                            <div>
                                                <label className="block text-xs text-slate-400 mb-1">Method</label>
                                                <select
                                                    value={options.noiseReduction.method}
                                                    onChange={(e) => updateOption('noiseReduction', { method: e.target.value as 'spectral' | 'adaptive' })}
                                                    className="w-full bg-slate-600 text-slate-100 rounded px-2 py-1 text-sm"
                                                >
                                                    <option value="spectral">Spectral Subtraction</option>
                                                    <option value="adaptive">Adaptive Filter</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-slate-400 mb-1">
                                                    Strength: {options.noiseReduction.strength.toFixed(1)}
                                                </label>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="1"
                                                    step="0.05"
                                                    value={options.noiseReduction.strength}
                                                    onChange={(e) => updateOption('noiseReduction', { strength: parseFloat(e.target.value) })}
                                                    className="w-full"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Enhancement Advanced */}
                                {options.enhancement?.enabled && (
                                    <div>
                                        <h4 className="text-sm font-medium text-slate-300 mb-3">Enhancement</h4>
                                        <div className="space-y-3">
                                            <div>
                                                <label className="block text-xs text-slate-400 mb-1">
                                                    High-pass: {options.enhancement.highpass} Hz
                                                </label>
                                                <input
                                                    type="range"
                                                    min="20"
                                                    max="200"
                                                    step="10"
                                                    value={options.enhancement.highpass}
                                                    onChange={(e) => updateOption('enhancement', { highpass: parseInt(e.target.value) })}
                                                    className="w-full"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-slate-400 mb-1">
                                                    Low-pass: {options.enhancement.lowpass} Hz
                                                </label>
                                                <input
                                                    type="range"
                                                    min="4000"
                                                    max="20000"
                                                    step="500"
                                                    value={options.enhancement.lowpass}
                                                    onChange={(e) => updateOption('enhancement', { lowpass: parseInt(e.target.value) })}
                                                    className="w-full"
                                                />
                                            </div>
                                            <div className="flex items-center">
                                                <input
                                                    type="checkbox"
                                                    checked={options.enhancement.compression}
                                                    onChange={(e) => updateOption('enhancement', { compression: e.target.checked })}
                                                    className="mr-2"
                                                />
                                                <label className="text-xs text-slate-400">Dynamic Compression</label>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-end mt-4">
                                <button
                                    onClick={resetSettings}
                                    className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-slate-100 rounded-lg transition-colors text-sm"
                                >
                                    Reset to Defaults
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Process Button */}
                    <div className="flex justify-center">
                        <button
                            onClick={processAudio}
                            disabled={isProcessing}
                            className="px-8 py-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center space-x-2"
                        >
                            <Zap className="w-5 h-5" />
                            <span>{isProcessing ? 'Processing...' : 'Process Audio'}</span>
                        </button>
                    </div>

                    {/* Progress */}
                    {isProcessing && (
                        <div className="bg-slate-700 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-slate-300">Processing audio...</span>
                                <span className="text-sm text-slate-400">{processingProgress}%</span>
                            </div>
                            <div className="w-full bg-slate-600 rounded-full h-2">
                                <div
                                    className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${processingProgress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Results */}
                    {processedResult && (
                        <div className="bg-slate-700 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-medium text-slate-100">Processing Results</h3>

                                <div className="flex items-center space-x-2">
                                    <button
                                        onClick={() => playAudio(true)}
                                        className="p-2 bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
                                    >
                                        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                    </button>

                                    <button
                                        onClick={downloadProcessed}
                                        className="p-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
                                    >
                                        <Download className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <div>
                                    <span className="text-slate-400">Duration:</span>
                                    <div className="text-slate-100">
                                        {formatDuration(processedResult.metadata.originalDuration)} →{' '}
                                        {formatDuration(processedResult.metadata.processedDuration)}
                                    </div>
                                </div>

                                <div>
                                    <span className="text-slate-400">Noise Reduced:</span>
                                    <div className="text-slate-100">
                                        {processedResult.metadata.noiseReductionDb.toFixed(1)} dB
                                    </div>
                                </div>

                                <div>
                                    <span className="text-slate-400">Silence Removed:</span>
                                    <div className="text-slate-100">
                                        {processedResult.metadata.silenceRemovedSeconds.toFixed(1)}s
                                    </div>
                                </div>

                                <div>
                                    <span className="text-slate-400">Peak Level:</span>
                                    <div className="text-slate-100">
                                        {processedResult.metadata.peakLevelDb.toFixed(1)} dB
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Visualization */}
                    {showPreview && audioFile && (
                        <AudioVisualization
                            audioFile={audioFile}
                            currentTime={currentTime}
                            duration={duration}
                            isPlaying={isPlaying}
                            onSeek={(time) => {
                                if (audioRef.current) {
                                    audioRef.current.currentTime = time;
                                    setCurrentTime(time);
                                }
                            }}
                        />
                    )}
                </div>
            )}
        </div>
    );
};