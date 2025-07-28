/**
 * Audio Visualization Components for Web Application
 * 
 * Provides waveform and spectrum visualization for audio playback and recording
 * Requirements: 8.2, 8.3, 9.3
 */

import { Download, Maximize2, Minimize2, Settings } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface WaveformVisualizerProps {
    audioData?: Float32Array;
    currentTime?: number;
    duration?: number;
    isPlaying?: boolean;
    onSeek?: (time: number) => void;
    className?: string;
    height?: number;
    color?: string;
    backgroundColor?: string;
    showProgress?: boolean;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
    audioData,
    currentTime = 0,
    duration = 0,
    isPlaying = false,
    onSeek,
    className = '',
    height = 100,
    color = '#4a9eff',
    backgroundColor = '#1a1a1a',
    showProgress = true
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>();

    const drawWaveform = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !audioData) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { width, height: canvasHeight } = canvas;

        // Clear canvas
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, canvasHeight);

        // Draw waveform
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();

        const barWidth = width / audioData.length;
        const centerY = canvasHeight / 2;

        for (let i = 0; i < audioData.length; i++) {
            const x = i * barWidth;
            const amplitude = audioData[i];
            const barHeight = amplitude * centerY * 0.8;

            // Draw positive part
            ctx.moveTo(x, centerY);
            ctx.lineTo(x, centerY - barHeight);

            // Draw negative part (mirrored)
            ctx.moveTo(x, centerY);
            ctx.lineTo(x, centerY + barHeight);
        }

        ctx.stroke();

        // Draw progress indicator
        if (showProgress && duration > 0) {
            const progressX = (currentTime / duration) * width;

            ctx.strokeStyle = '#ff4444';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(progressX, 0);
            ctx.lineTo(progressX, canvasHeight);
            ctx.stroke();

            // Draw time indicator
            ctx.fillStyle = '#ff4444';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            const timeText = `${Math.floor(currentTime / 60)}:${Math.floor(currentTime % 60).toString().padStart(2, '0')}`;
            ctx.fillText(timeText, progressX, 15);
        }
    }, [audioData, currentTime, duration, color, backgroundColor, showProgress]);

    useEffect(() => {
        drawWaveform();
    }, [drawWaveform]);

    const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!onSeek || !duration) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const clickTime = (x / canvas.width) * duration;

        onSeek(clickTime);
    }, [onSeek, duration]);

    return (
        <canvas
            ref={canvasRef}
            width={800}
            height={height}
            className={`w-full cursor-pointer ${className}`}
            onClick={handleCanvasClick}
            style={{ height: `${height}px` }}
        />
    );
};

export interface SpectrumAnalyzerProps {
    audioContext?: AudioContext;
    analyser?: AnalyserNode;
    isActive?: boolean;
    className?: string;
    height?: number;
    barCount?: number;
    color?: string;
    backgroundColor?: string;
}

export const SpectrumAnalyzer: React.FC<SpectrumAnalyzerProps> = ({
    audioContext,
    analyser,
    isActive = false,
    className = '',
    height = 150,
    barCount = 64,
    color = '#00ff88',
    backgroundColor = '#1a1a1a'
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>();

    const drawSpectrum = useCallback(() => {
        if (!isActive || !analyser) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { width, height: canvasHeight } = canvas;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const draw = () => {
            if (!isActive) return;

            analyser.getByteFrequencyData(dataArray);

            // Clear canvas
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, width, canvasHeight);

            const barWidth = width / barCount;
            const binSize = Math.floor(dataArray.length / barCount);

            for (let i = 0; i < barCount; i++) {
                // Average the frequency data for this bar
                let sum = 0;
                for (let j = 0; j < binSize; j++) {
                    sum += dataArray[i * binSize + j];
                }
                const average = sum / binSize;

                const barHeight = (average / 255) * canvasHeight * 0.8;
                const x = i * barWidth;
                const y = canvasHeight - barHeight;

                // Create gradient color based on frequency
                const hue = (i / barCount) * 120; // 0 to 120 degrees (red to green)
                ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
                ctx.fillRect(x, y, barWidth - 1, barHeight);
            }

            animationRef.current = requestAnimationFrame(draw);
        };

        draw();
    }, [isActive, analyser, barCount, backgroundColor]);

    useEffect(() => {
        if (isActive) {
            drawSpectrum();
        } else if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [isActive, drawSpectrum]);

    return (
        <canvas
            ref={canvasRef}
            width={800}
            height={height}
            className={`w-full ${className}`}
            style={{ height: `${height}px` }}
        />
    );
};

export interface AudioVisualizationProps {
    audioFile?: File;
    audioContext?: AudioContext;
    analyser?: AnalyserNode;
    currentTime?: number;
    duration?: number;
    isPlaying?: boolean;
    onSeek?: (time: number) => void;
    className?: string;
}

export const AudioVisualization: React.FC<AudioVisualizationProps> = ({
    audioFile,
    audioContext,
    analyser,
    currentTime = 0,
    duration = 0,
    isPlaying = false,
    onSeek,
    className = ''
}) => {
    const [waveformData, setWaveformData] = useState<Float32Array>();
    const [visualizationType, setVisualizationType] = useState<'waveform' | 'spectrum'>('waveform');
    const [isExpanded, setIsExpanded] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [settings, setSettings] = useState({
        waveformColor: '#4a9eff',
        spectrumColor: '#00ff88',
        backgroundColor: '#1a1a1a',
        sensitivity: 1.0,
        smoothing: 0.8
    });

    // Generate waveform data when audio file changes
    useEffect(() => {
        if (!audioFile) return;

        const generateWaveform = async () => {
            try {
                const { generateWaveformData } = await import('@/utils/audioUtils');
                const data = await generateWaveformData(audioFile, 1000);
                setWaveformData(data);
            } catch (error) {
                console.error('Failed to generate waveform:', error);
            }
        };

        generateWaveform();
    }, [audioFile]);

    const downloadVisualization = useCallback(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return;

        const link = document.createElement('a');
        link.download = `visualization-${Date.now()}.png`;
        link.href = canvas.toDataURL();
        link.click();
    }, []);

    return (
        <div className={`bg-slate-800 rounded-lg p-4 ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-4">
                    <h3 className="text-slate-100 font-medium">Audio Visualization</h3>

                    <div className="flex bg-slate-700 rounded-lg p-1">
                        <button
                            onClick={() => setVisualizationType('waveform')}
                            className={`px-3 py-1 text-sm rounded transition-colors ${visualizationType === 'waveform'
                                    ? 'bg-primary-600 text-white'
                                    : 'text-slate-300 hover:text-white'
                                }`}
                        >
                            Waveform
                        </button>
                        <button
                            onClick={() => setVisualizationType('spectrum')}
                            className={`px-3 py-1 text-sm rounded transition-colors ${visualizationType === 'spectrum'
                                    ? 'bg-primary-600 text-white'
                                    : 'text-slate-300 hover:text-white'
                                }`}
                        >
                            Spectrum
                        </button>
                    </div>
                </div>

                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        <Settings className="w-4 h-4 text-slate-400" />
                    </button>

                    <button
                        onClick={downloadVisualization}
                        className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        <Download className="w-4 h-4 text-slate-400" />
                    </button>

                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        {isExpanded ? (
                            <Minimize2 className="w-4 h-4 text-slate-400" />
                        ) : (
                            <Maximize2 className="w-4 h-4 text-slate-400" />
                        )}
                    </button>
                </div>
            </div>

            {/* Settings Panel */}
            {showSettings && (
                <div className="bg-slate-700 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Waveform Color
                            </label>
                            <input
                                type="color"
                                value={settings.waveformColor}
                                onChange={(e) => setSettings(prev => ({ ...prev, waveformColor: e.target.value }))}
                                className="w-full h-8 rounded border-0"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Spectrum Color
                            </label>
                            <input
                                type="color"
                                value={settings.spectrumColor}
                                onChange={(e) => setSettings(prev => ({ ...prev, spectrumColor: e.target.value }))}
                                className="w-full h-8 rounded border-0"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Background Color
                            </label>
                            <input
                                type="color"
                                value={settings.backgroundColor}
                                onChange={(e) => setSettings(prev => ({ ...prev, backgroundColor: e.target.value }))}
                                className="w-full h-8 rounded border-0"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Sensitivity
                            </label>
                            <input
                                type="range"
                                min="0.1"
                                max="2"
                                step="0.1"
                                value={settings.sensitivity}
                                onChange={(e) => setSettings(prev => ({ ...prev, sensitivity: parseFloat(e.target.value) }))}
                                className="w-full"
                            />
                            <span className="text-xs text-slate-400">{settings.sensitivity}x</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Visualization */}
            <div className={`bg-slate-900 rounded-lg ${isExpanded ? 'h-80' : 'h-40'}`}>
                {visualizationType === 'waveform' ? (
                    <WaveformVisualizer
                        audioData={waveformData}
                        currentTime={currentTime}
                        duration={duration}
                        isPlaying={isPlaying}
                        onSeek={onSeek}
                        height={isExpanded ? 320 : 160}
                        color={settings.waveformColor}
                        backgroundColor={settings.backgroundColor}
                        className="rounded-lg"
                    />
                ) : (
                    <SpectrumAnalyzer
                        audioContext={audioContext}
                        analyser={analyser}
                        isActive={isPlaying}
                        height={isExpanded ? 320 : 160}
                        color={settings.spectrumColor}
                        backgroundColor={settings.backgroundColor}
                        className="rounded-lg"
                    />
                )}
            </div>

            {/* Info */}
            {audioFile && (
                <div className="mt-4 text-sm text-slate-400">
                    <div className="flex justify-between">
                        <span>File: {audioFile.name}</span>
                        <span>Size: {(audioFile.size / (1024 * 1024)).toFixed(1)} MB</span>
                    </div>
                    {duration > 0 && (
                        <div className="flex justify-between mt-1">
                            <span>Duration: {Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}</span>
                            <span>Type: {visualizationType}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};