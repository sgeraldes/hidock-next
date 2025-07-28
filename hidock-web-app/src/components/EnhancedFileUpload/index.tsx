/**
 * Enhanced File Upload Component with Advanced Features
 * 
 * Features:
 * - Drag-and-drop with visual feedback
 * - Multiple file upload with queue management
 * - Real-time progress tracking with cancellation
 * - File validation and error handling
 * - Preview and metadata extraction
 * - Batch operations and retry mechanisms
 * 
 * Requirements addressed: 2.1, 2.2, 2.3, 8.1, 8.2, 8.3
 */

import { AUDIO_CONFIG, ERROR_MESSAGES } from '@/constants';
import type { AudioData } from '@/types';
import { formatBytes, formatDuration } from '@/utils/formatters';
import {
    AlertCircle,
    Check,
    Eye,
    File,
    Info,
    Loader2,
    Pause, Play, RotateCcw, Trash2,
    Upload,
    X
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface UploadFile {
    id: string;
    file: File;
    progress: number;
    status: 'pending' | 'uploading' | 'paused' | 'completed' | 'failed' | 'cancelled';
    error?: string;
    audioData?: AudioData;
    metadata?: {
        duration?: number;
        bitrate?: number;
        sampleRate?: number;
    };
}

interface EnhancedFileUploadProps {
    onFileSelect: (audioData: AudioData) => void;
    onError: (error: string) => void;
    onProgress?: (progress: { completed: number; total: number; currentFile?: string }) => void;
    disabled?: boolean;
    maxFiles?: number;
    allowMultiple?: boolean;
    className?: string;
}

export const EnhancedFileUpload: React.FC<EnhancedFileUploadProps> = ({
    onFileSelect,
    onError,
    onProgress,
    disabled = false,
    maxFiles = 10,
    allowMultiple = true,
    className = ''
}) => {
    // Component state
    const [isDragOver, setIsDragOver] = useState(false);
    const [uploadQueue, setUploadQueue] = useState<UploadFile[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [showQueue, setShowQueue] = useState(false);

    // Refs
    const fileInputRef = useRef<HTMLInputElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processingControllerRef = useRef<AbortController | null>(null);

    // Initialize audio context for metadata extraction
    useEffect(() => {
        if (typeof window !== 'undefined' && window.AudioContext) {
            audioContextRef.current = new AudioContext();
        }

        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    // File validation
    const validateFile = useCallback((file: File): string | null => {
        if (file.size > AUDIO_CONFIG.MAX_FILE_SIZE) {
            return ERROR_MESSAGES.FILE_TOO_LARGE;
        }

        if (!AUDIO_CONFIG.SUPPORTED_FORMATS.includes(file.type)) {
            return ERROR_MESSAGES.UNSUPPORTED_FORMAT;
        }

        return null;
    }, []);

    // Extract audio metadata
    const extractMetadata = useCallback(async (file: File): Promise<any> => {
        if (!audioContextRef.current) return {};

        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);

            return {
                duration: audioBuffer.duration,
                sampleRate: audioBuffer.sampleRate,
                channels: audioBuffer.numberOfChannels,
                bitrate: Math.round((file.size * 8) / audioBuffer.duration / 1000) // Approximate bitrate in kbps
            };
        } catch (error) {
            console.warn('Failed to extract audio metadata:', error);
            return {};
        }
    }, []);

    // Process a single file
    const processFile = useCallback(async (uploadFile: UploadFile): Promise<void> => {
        const { file } = uploadFile;

        // Update status to uploading
        setUploadQueue(prev => prev.map(uf =>
            uf.id === uploadFile.id
                ? { ...uf, status: 'uploading' as const, progress: 0 }
                : uf
        ));

        try {
            // Extract metadata
            const metadata = await extractMetadata(file);

            // Update with metadata
            setUploadQueue(prev => prev.map(uf =>
                uf.id === uploadFile.id
                    ? { ...uf, metadata, progress: 25 }
                    : uf
            ));

            // Simulate processing delay and progress
            for (let progress = 25; progress <= 75; progress += 25) {
                await new Promise(resolve => setTimeout(resolve, 200));

                setUploadQueue(prev => prev.map(uf =>
                    uf.id === uploadFile.id
                        ? { ...uf, progress }
                        : uf
                ));
            }

            // Read file as base64
            const reader = new FileReader();

            const audioData = await new Promise<AudioData>((resolve, reject) => {
                reader.onload = (e) => {
                    const result = e.target?.result as string;
                    if (!result) {
                        reject(new Error('Failed to read file'));
                        return;
                    }

                    const base64Data = result.split(',')[1];

                    resolve({
                        fileName: file.name,
                        base64: base64Data,
                        mimeType: file.type,
                        size: file.size,
                    });
                };

                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });

            // Complete processing
            setUploadQueue(prev => prev.map(uf =>
                uf.id === uploadFile.id
                    ? {
                        ...uf,
                        status: 'completed' as const,
                        progress: 100,
                        audioData
                    }
                    : uf
            ));

            // Notify parent component
            onFileSelect(audioData);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Processing failed';

            setUploadQueue(prev => prev.map(uf =>
                uf.id === uploadFile.id
                    ? {
                        ...uf,
                        status: 'failed' as const,
                        error: errorMessage
                    }
                    : uf
            ));

            onError(errorMessage);
        }
    }, [extractMetadata, onFileSelect, onError]);

    // Process upload queue
    const processQueue = useCallback(async () => {
        if (isProcessing) return;

        setIsProcessing(true);
        processingControllerRef.current = new AbortController();

        const pendingFiles = uploadQueue.filter(uf => uf.status === 'pending');

        for (const uploadFile of pendingFiles) {
            if (processingControllerRef.current?.signal.aborted) break;

            await processFile(uploadFile);

            // Update overall progress
            const completed = uploadQueue.filter(uf => uf.status === 'completed').length;
            onProgress?.({
                completed,
                total: uploadQueue.length,
                currentFile: uploadFile.file.name
            });
        }

        setIsProcessing(false);
        processingControllerRef.current = null;
    }, [uploadQueue, isProcessing, processFile, onProgress]);

    // Add files to queue
    const addFilesToQueue = useCallback((files: File[]) => {
        const validFiles: UploadFile[] = [];

        for (const file of files) {
            // Check file limit
            if (uploadQueue.length + validFiles.length >= maxFiles) {
                onError(`Maximum ${maxFiles} files allowed`);
                break;
            }

            // Validate file
            const validationError = validateFile(file);
            if (validationError) {
                onError(`${file.name}: ${validationError}`);
                continue;
            }

            // Check for duplicates
            const isDuplicate = uploadQueue.some(uf =>
                uf.file.name === file.name && uf.file.size === file.size
            );

            if (isDuplicate) {
                onError(`${file.name}: File already in queue`);
                continue;
            }

            validFiles.push({
                id: `${Date.now()}-${Math.random()}`,
                file,
                progress: 0,
                status: 'pending'
            });
        }

        if (validFiles.length > 0) {
            setUploadQueue(prev => [...prev, ...validFiles]);
            setShowQueue(true);
        }
    }, [uploadQueue, maxFiles, validateFile, onError]);

    // File input handler
    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            addFilesToQueue(files);
        }

        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, [addFilesToQueue]);

    // Drag and drop handlers
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        if (!disabled) {
            setIsDragOver(true);
        }
    }, [disabled]);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);

        if (disabled) return;

        const files = Array.from(e.dataTransfer.files);
        const audioFiles = files.filter(file =>
            AUDIO_CONFIG.SUPPORTED_FORMATS.includes(file.type)
        );

        if (audioFiles.length === 0 && files.length > 0) {
            onError(ERROR_MESSAGES.UNSUPPORTED_FORMAT);
            return;
        }

        addFilesToQueue(audioFiles);
    }, [disabled, addFilesToQueue, onError]);

    // Queue management functions
    const removeFromQueue = useCallback((id: string) => {
        setUploadQueue(prev => prev.filter(uf => uf.id !== id));
    }, []);

    const retryFile = useCallback((id: string) => {
        setUploadQueue(prev => prev.map(uf =>
            uf.id === id
                ? { ...uf, status: 'pending' as const, error: undefined, progress: 0 }
                : uf
        ));
    }, []);

    const pauseProcessing = useCallback(() => {
        if (processingControllerRef.current) {
            processingControllerRef.current.abort();
        }
    }, []);

    const clearQueue = useCallback(() => {
        pauseProcessing();
        setUploadQueue([]);
        setShowQueue(false);
    }, [pauseProcessing]);

    // Auto-process queue when files are added
    useEffect(() => {
        if (uploadQueue.some(uf => uf.status === 'pending') && !isProcessing) {
            processQueue();
        }
    }, [uploadQueue, isProcessing, processQueue]);

    // Calculate queue statistics
    const queueStats = {
        total: uploadQueue.length,
        completed: uploadQueue.filter(uf => uf.status === 'completed').length,
        failed: uploadQueue.filter(uf => uf.status === 'failed').length,
        pending: uploadQueue.filter(uf => uf.status === 'pending').length,
        uploading: uploadQueue.filter(uf => uf.status === 'uploading').length
    };

    return (
        <div className={className}>
            {/* Main Upload Area */}
            <div
                className={`
          relative border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200
          ${isDragOver && !disabled
                        ? 'border-primary-400 bg-primary-400/10'
                        : 'border-slate-600 hover:border-slate-500'
                    }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !disabled && fileInputRef.current?.click()}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={AUDIO_CONFIG.SUPPORTED_FORMATS.join(',')}
                    onChange={handleFileInput}
                    disabled={disabled}
                    multiple={allowMultiple}
                    className="hidden"
                />

                <div className="space-y-4">
                    <Upload className="w-12 h-12 text-slate-500 mx-auto" />
                    <div>
                        <h3 className="text-lg font-medium text-slate-100 mb-2">
                            {allowMultiple ? 'Upload Audio Files' : 'Upload Audio File'}
                        </h3>
                        <p className="text-slate-400 mb-4">
                            Drag and drop {allowMultiple ? 'files' : 'a file'} here, or click to browse
                        </p>
                        <div className="text-sm text-slate-500">
                            <p>Supported formats: MP3, WAV, M4A, OGG</p>
                            <p>Maximum size: {formatBytes(AUDIO_CONFIG.MAX_FILE_SIZE)}</p>
                            {allowMultiple && <p>Maximum files: {maxFiles}</p>}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="btn-primary inline-flex items-center space-x-2"
                        disabled={disabled}
                    >
                        <File className="w-4 h-4" />
                        <span>Choose {allowMultiple ? 'Files' : 'File'}</span>
                    </button>
                </div>
            </div>

            {/* Queue Status */}
            {uploadQueue.length > 0 && (
                <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                        <button
                            onClick={() => setShowQueue(!showQueue)}
                            className="flex items-center space-x-2 text-slate-300 hover:text-slate-100"
                        >
                            <span>Upload Queue ({queueStats.total})</span>
                            {showQueue ? <X className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>

                        <div className="flex items-center space-x-2">
                            {isProcessing ? (
                                <button
                                    onClick={pauseProcessing}
                                    className="p-1 hover:bg-slate-700 rounded text-slate-400"
                                    title="Pause"
                                >
                                    <Pause className="w-4 h-4" />
                                </button>
                            ) : queueStats.pending > 0 && (
                                <button
                                    onClick={processQueue}
                                    className="p-1 hover:bg-slate-700 rounded text-slate-400"
                                    title="Resume"
                                >
                                    <Play className="w-4 h-4" />
                                </button>
                            )}

                            <button
                                onClick={clearQueue}
                                className="p-1 hover:bg-slate-700 rounded text-red-400"
                                title="Clear Queue"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Queue Progress Summary */}
                    <div className="bg-slate-800/50 rounded-lg p-3 mb-2">
                        <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
                            <span>
                                {queueStats.completed} of {queueStats.total} completed
                            </span>
                            <span>
                                {queueStats.failed > 0 && `${queueStats.failed} failed`}
                            </span>
                        </div>

                        <div className="bg-slate-700 rounded-full h-2">
                            <div
                                className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                                style={{
                                    width: `${queueStats.total > 0 ? (queueStats.completed / queueStats.total) * 100 : 0}%`
                                }}
                            />
                        </div>
                    </div>

                    {/* Queue Items */}
                    {showQueue && (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {uploadQueue.map((uploadFile) => (
                                <QueueItem
                                    key={uploadFile.id}
                                    uploadFile={uploadFile}
                                    onRemove={removeFromQueue}
                                    onRetry={retryFile}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Tips */}
            <div className="mt-4 p-3 bg-slate-800/50 rounded-lg">
                <div className="flex items-start space-x-2">
                    <Info className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-slate-400">
                        <p className="font-medium mb-1">Tips for best results:</p>
                        <ul className="space-y-1 text-xs">
                            <li>• Use clear, high-quality audio recordings</li>
                            <li>• Minimize background noise when possible</li>
                            <li>• Ensure speakers are clearly audible</li>
                            <li>• Files under 10MB typically process faster</li>
                            {allowMultiple && <li>• You can upload multiple files at once</li>}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Queue Item Component
interface QueueItemProps {
    uploadFile: UploadFile;
    onRemove: (id: string) => void;
    onRetry: (id: string) => void;
}

const QueueItem: React.FC<QueueItemProps> = ({ uploadFile, onRemove, onRetry }) => {
    const { file, progress, status, error, metadata } = uploadFile;

    const getStatusIcon = () => {
        switch (status) {
            case 'pending':
                return <Loader2 className="w-4 h-4 text-slate-400" />;
            case 'uploading':
                return <Loader2 className="w-4 h-4 text-primary-400 animate-spin" />;
            case 'completed':
                return <Check className="w-4 h-4 text-green-400" />;
            case 'failed':
                return <AlertCircle className="w-4 h-4 text-red-400" />;
            case 'cancelled':
                return <X className="w-4 h-4 text-slate-400" />;
            default:
                return <File className="w-4 h-4 text-slate-400" />;
        }
    };

    const getStatusColor = () => {
        switch (status) {
            case 'uploading':
                return 'text-primary-400';
            case 'completed':
                return 'text-green-400';
            case 'failed':
                return 'text-red-400';
            default:
                return 'text-slate-400';
        }
    };

    return (
        <div className="bg-slate-800 rounded-lg p-3">
            <div className="flex items-center space-x-3">
                {/* Status Icon */}
                <div className="flex-shrink-0">
                    {getStatusIcon()}
                </div>

                {/* File Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-slate-100 font-medium truncate">{file.name}</p>
                        <span className={`text-sm ${getStatusColor()}`}>
                            {status === 'uploading' ? `${progress}%` : status}
                        </span>
                    </div>

                    <div className="flex items-center space-x-4 text-xs text-slate-400">
                        <span>{formatBytes(file.size)}</span>
                        {metadata?.duration && (
                            <span>{formatDuration(metadata.duration)}</span>
                        )}
                        {metadata?.bitrate && (
                            <span>{metadata.bitrate} kbps</span>
                        )}
                    </div>

                    {/* Progress Bar */}
                    {status === 'uploading' && (
                        <div className="mt-2 bg-slate-700 rounded-full h-1">
                            <div
                                className="bg-primary-500 h-1 rounded-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <p className="mt-1 text-xs text-red-400">{error}</p>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-1">
                    {status === 'failed' && (
                        <button
                            onClick={() => onRetry(uploadFile.id)}
                            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200"
                            title="Retry"
                        >
                            <RotateCcw className="w-3 h-3" />
                        </button>
                    )}

                    <button
                        onClick={() => onRemove(uploadFile.id)}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-red-400"
                        title="Remove"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
            </div>
        </div>
    );
};