/**
 * Enhanced File Management Interface for HiDock Web Application
 * 
 * This component provides comprehensive file management capabilities including:
 * - Drag-and-drop file upload with validation and progress indication
 * - File list with sorting, filtering, and batch selection
 * - File operation controls with confirmation dialogs and progress tracking
 * - Mobile-responsive interface with touch-friendly controls
 * 
 * Requirements addressed: 2.1, 2.2, 2.3, 2.4, 2.5, 8.1, 8.2, 8.3, 8.4
 */

import { AUDIO_CONFIG, ERROR_MESSAGES } from '@/constants';
import { useAppStore } from '@/store/useAppStore';
import type { AudioData, AudioRecording } from '@/types';
import { formatBytes, formatDate, formatDuration } from '@/utils/formatters';
import {
    Download,
    Eye,
    FileText,
    Filter,
    Grid,
    HardDrive,
    List,
    Loader2,
    Play,
    Search,
    SortAsc, SortDesc,
    Trash2,
    Upload
} from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';

// File operation types
type FileOperation = 'download' | 'delete' | 'play' | 'transcribe';
type ViewMode = 'list' | 'grid';
type SortField = 'name' | 'size' | 'duration' | 'date' | 'status';
type SortOrder = 'asc' | 'desc';

interface FileFilter {
    search: string;
    status: string[];
    dateRange: {
        start: string;
        end: string;
    };
    sizeRange: {
        min: number;
        max: number;
    };
    fileTypes: string[];
}

interface FileOperationProgress {
    id: string;
    operation: FileOperation;
    progress: number;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    error?: string;
}

export const FileManager: React.FC = () => {
    const {
        recordings,
        selectedRecordings,
        setSelectedRecordings,
        toggleRecordingSelection,
        updateRecording,
        removeRecording,
        setError
    } = useAppStore();

    // Component state
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [sortField, setSortField] = useState<SortField>('date');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
    const [showFilters, setShowFilters] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [operationProgress, setOperationProgress] = useState<Map<string, FileOperationProgress>>(new Map());

    // Filter state
    const [filter, setFilter] = useState<FileFilter>({
        search: '',
        status: [],
        dateRange: { start: '', end: '' },
        sizeRange: { min: 0, max: Infinity },
        fileTypes: []
    });

    // File upload state
    const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map());
    const [uploadQueue, setUploadQueue] = useState<File[]>([]);

    // Filtered and sorted recordings
    const filteredRecordings = useMemo(() => {
        let filtered = recordings.filter(recording => {
            // Search filter
            if (filter.search && !recording.fileName.toLowerCase().includes(filter.search.toLowerCase())) {
                return false;
            }

            // Status filter
            if (filter.status.length > 0 && !filter.status.includes(recording.status)) {
                return false;
            }

            // Date range filter
            if (filter.dateRange.start) {
                const startDate = new Date(filter.dateRange.start);
                if (recording.dateCreated < startDate) return false;
            }
            if (filter.dateRange.end) {
                const endDate = new Date(filter.dateRange.end);
                if (recording.dateCreated > endDate) return false;
            }

            // Size range filter
            if (recording.size < filter.sizeRange.min || recording.size > filter.sizeRange.max) {
                return false;
            }

            // File type filter
            if (filter.fileTypes.length > 0) {
                const extension = recording.fileName.split('.').pop()?.toLowerCase();
                if (!extension || !filter.fileTypes.includes(extension)) {
                    return false;
                }
            }

            return true;
        });

        // Sort recordings
        filtered.sort((a, b) => {
            let aValue: any, bValue: any;

            switch (sortField) {
                case 'name':
                    aValue = a.fileName.toLowerCase();
                    bValue = b.fileName.toLowerCase();
                    break;
                case 'size':
                    aValue = a.size;
                    bValue = b.size;
                    break;
                case 'duration':
                    aValue = a.duration;
                    bValue = b.duration;
                    break;
                case 'date':
                    aValue = a.dateCreated.getTime();
                    bValue = b.dateCreated.getTime();
                    break;
                case 'status':
                    aValue = a.status;
                    bValue = b.status;
                    break;
                default:
                    return 0;
            }

            if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        return filtered;
    }, [recordings, filter, sortField, sortOrder]);

    // File upload handlers
    const validateFile = useCallback((file: File): string | null => {
        if (file.size > AUDIO_CONFIG.MAX_FILE_SIZE) {
            return ERROR_MESSAGES.FILE_TOO_LARGE;
        }

        if (!AUDIO_CONFIG.SUPPORTED_FORMATS.includes(file.type)) {
            return ERROR_MESSAGES.UNSUPPORTED_FORMAT;
        }

        return null;
    }, []);

    const processFileUpload = useCallback(async (file: File) => {
        const validationError = validateFile(file);
        if (validationError) {
            setError(validationError);
            return;
        }

        const uploadId = `upload_${Date.now()}_${Math.random()}`;
        setUploadProgress(prev => new Map(prev.set(uploadId, 0)));

        try {
            // Simulate upload progress
            const progressInterval = setInterval(() => {
                setUploadProgress(prev => {
                    const current = prev.get(uploadId) || 0;
                    if (current >= 100) {
                        clearInterval(progressInterval);
                        return prev;
                    }
                    return new Map(prev.set(uploadId, Math.min(current + 10, 100)));
                });
            }, 200);

            // Process file
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result as string;
                if (result) {
                    const base64Data = result.split(',')[1];
                    const audioData: AudioData = {
                        fileName: file.name,
                        base64: base64Data,
                        mimeType: file.type,
                        size: file.size,
                    };

                    // Add to recordings (in real app, this would upload to device)
                    const newRecording: AudioRecording = {
                        id: `recording_${Date.now()}`,
                        fileName: file.name,
                        size: file.size,
                        duration: 0, // Would be calculated from audio
                        dateCreated: new Date(),
                        status: 'downloaded',
                        localPath: URL.createObjectURL(file)
                    };

                    // Add recording to store
                    // addRecording(newRecording);
                }

                // Clean up progress
                setTimeout(() => {
                    setUploadProgress(prev => {
                        const newMap = new Map(prev);
                        newMap.delete(uploadId);
                        return newMap;
                    });
                }, 1000);
            };

            reader.readAsDataURL(file);
        } catch (error) {
            setError('Failed to upload file');
            setUploadProgress(prev => {
                const newMap = new Map(prev);
                newMap.delete(uploadId);
                return newMap;
            });
        }
    }, [validateFile, setError]);

    // Drag and drop handlers
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        const audioFiles = files.filter(file =>
            AUDIO_CONFIG.SUPPORTED_FORMATS.includes(file.type)
        );

        if (audioFiles.length === 0 && files.length > 0) {
            setError(ERROR_MESSAGES.UNSUPPORTED_FORMAT);
            return;
        }

        audioFiles.forEach(processFileUpload);
    }, [processFileUpload, setError]);

    // File operation handlers
    const handleFileOperation = useCallback(async (
        recordingIds: string[],
        operation: FileOperation
    ) => {
        const operationId = `${operation}_${Date.now()}`;

        // Initialize progress tracking
        recordingIds.forEach(id => {
            setOperationProgress(prev => new Map(prev.set(id, {
                id: operationId,
                operation,
                progress: 0,
                status: 'pending'
            })));
        });

        try {
            // Simulate operation progress
            for (const recordingId of recordingIds) {
                const recording = recordings.find(r => r.id === recordingId);
                if (!recording) continue;

                // Update progress
                setOperationProgress(prev => new Map(prev.set(recordingId, {
                    id: operationId,
                    operation,
                    progress: 50,
                    status: 'in_progress'
                })));

                // Simulate operation delay
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Handle different operations
                switch (operation) {
                    case 'download':
                        updateRecording(recordingId, { status: 'downloaded' });
                        break;
                    case 'delete':
                        removeRecording(recordingId);
                        break;
                    case 'play':
                        updateRecording(recordingId, { status: 'playing' });
                        break;
                    case 'transcribe':
                        updateRecording(recordingId, { status: 'transcribing' });
                        // Simulate transcription completion
                        setTimeout(() => {
                            updateRecording(recordingId, {
                                status: 'transcribed',
                                transcription: 'Sample transcription text...'
                            });
                        }, 3000);
                        break;
                }

                // Complete operation
                setOperationProgress(prev => new Map(prev.set(recordingId, {
                    id: operationId,
                    operation,
                    progress: 100,
                    status: 'completed'
                })));
            }

            // Clean up progress after delay
            setTimeout(() => {
                recordingIds.forEach(id => {
                    setOperationProgress(prev => {
                        const newMap = new Map(prev);
                        newMap.delete(id);
                        return newMap;
                    });
                });
            }, 2000);

        } catch (error) {
            // Handle operation failure
            recordingIds.forEach(id => {
                setOperationProgress(prev => new Map(prev.set(id, {
                    id: operationId,
                    operation,
                    progress: 0,
                    status: 'failed',
                    error: error instanceof Error ? error.message : 'Operation failed'
                })));
            });
        }
    }, [recordings, updateRecording, removeRecording]);

    // Selection handlers
    const handleSelectAll = useCallback(() => {
        if (selectedRecordings.length === filteredRecordings.length) {
            setSelectedRecordings([]);
        } else {
            setSelectedRecordings(filteredRecordings.map(r => r.id));
        }
    }, [selectedRecordings, filteredRecordings, setSelectedRecordings]);

    const handleSort = useCallback((field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('asc');
        }
    }, [sortField, sortOrder]);

    // Get operation progress for a recording
    const getOperationProgress = useCallback((recordingId: string) => {
        return operationProgress.get(recordingId);
    }, [operationProgress]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-100">File Manager</h1>
                    <p className="text-slate-400">
                        {filteredRecordings.length} of {recordings.length} files
                    </p>
                </div>

                <div className="flex items-center space-x-3">
                    {/* View mode toggle */}
                    <div className="flex items-center bg-slate-700 rounded-lg p-1">
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded ${viewMode === 'list' ? 'bg-slate-600 text-slate-100' : 'text-slate-400'}`}
                        >
                            <List className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-2 rounded ${viewMode === 'grid' ? 'bg-slate-600 text-slate-100' : 'text-slate-400'}`}
                        >
                            <Grid className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Filter toggle */}
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`btn-secondary flex items-center space-x-2 ${showFilters ? 'bg-primary-600' : ''}`}
                    >
                        <Filter className="w-4 h-4" />
                        <span className="hidden sm:inline">Filters</span>
                    </button>
                </div>
            </div>

            {/* Search and Filters */}
            <div className="space-y-4">
                {/* Search bar */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search files..."
                        value={filter.search}
                        onChange={(e) => setFilter(prev => ({ ...prev, search: e.target.value }))}
                        className="w-full pl-10 pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                </div>

                {/* Advanced filters */}
                {showFilters && (
                    <div className="card p-4 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            {/* Status filter */}
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Status</label>
                                <select
                                    multiple
                                    value={filter.status}
                                    onChange={(e) => setFilter(prev => ({
                                        ...prev,
                                        status: Array.from(e.target.selectedOptions, option => option.value)
                                    }))}
                                    className="w-full bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
                                >
                                    <option value="on_device">On Device</option>
                                    <option value="downloaded">Downloaded</option>
                                    <option value="transcribed">Transcribed</option>
                                    <option value="playing">Playing</option>
                                </select>
                            </div>

                            {/* Date range */}
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
                                <div className="space-y-2">
                                    <input
                                        type="date"
                                        value={filter.dateRange.start}
                                        onChange={(e) => setFilter(prev => ({
                                            ...prev,
                                            dateRange: { ...prev.dateRange, start: e.target.value }
                                        }))}
                                        className="w-full bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
                                    />
                                    <input
                                        type="date"
                                        value={filter.dateRange.end}
                                        onChange={(e) => setFilter(prev => ({
                                            ...prev,
                                            dateRange: { ...prev.dateRange, end: e.target.value }
                                        }))}
                                        className="w-full bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
                                    />
                                </div>
                            </div>

                            {/* File types */}
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">File Types</label>
                                <div className="space-y-1">
                                    {['wav', 'mp3', 'm4a', 'ogg'].map(type => (
                                        <label key={type} className="flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={filter.fileTypes.includes(type)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setFilter(prev => ({
                                                            ...prev,
                                                            fileTypes: [...prev.fileTypes, type]
                                                        }));
                                                    } else {
                                                        setFilter(prev => ({
                                                            ...prev,
                                                            fileTypes: prev.fileTypes.filter(t => t !== type)
                                                        }));
                                                    }
                                                }}
                                                className="mr-2 rounded border-slate-500 bg-slate-700 text-primary-600"
                                            />
                                            <span className="text-sm text-slate-300">{type.toUpperCase()}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Clear filters */}
                            <div className="flex items-end">
                                <button
                                    onClick={() => setFilter({
                                        search: '',
                                        status: [],
                                        dateRange: { start: '', end: '' },
                                        sizeRange: { min: 0, max: Infinity },
                                        fileTypes: []
                                    })}
                                    className="btn-secondary w-full"
                                >
                                    Clear Filters
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Batch Actions */}
            {selectedRecordings.length > 0 && (
                <div className="card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <span className="text-slate-300">
                            {selectedRecordings.length} file{selectedRecordings.length !== 1 ? 's' : ''} selected
                        </span>

                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                onClick={() => handleFileOperation(selectedRecordings, 'download')}
                                className="btn-primary flex items-center space-x-2"
                            >
                                <Download className="w-4 h-4" />
                                <span>Download</span>
                            </button>

                            <button
                                onClick={() => handleFileOperation(selectedRecordings, 'transcribe')}
                                className="btn-secondary flex items-center space-x-2"
                            >
                                <FileText className="w-4 h-4" />
                                <span>Transcribe</span>
                            </button>

                            <button
                                onClick={() => {
                                    if (confirm(`Delete ${selectedRecordings.length} file(s)?`)) {
                                        handleFileOperation(selectedRecordings, 'delete');
                                    }
                                }}
                                className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg flex items-center space-x-2"
                            >
                                <Trash2 className="w-4 h-4" />
                                <span>Delete</span>
                            </button>

                            <button
                                onClick={() => setSelectedRecordings([])}
                                className="btn-secondary"
                            >
                                Clear Selection
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* File Upload Drop Zone */}
            <div
                className={`
          border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200
          ${isDragOver
                        ? 'border-primary-400 bg-primary-400/10'
                        : 'border-slate-600 hover:border-slate-500'
                    }
        `}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                <p className="text-slate-400 mb-2">
                    Drag and drop audio files here to upload
                </p>
                <p className="text-sm text-slate-500">
                    Supported: MP3, WAV, M4A, OGG (max {formatBytes(AUDIO_CONFIG.MAX_FILE_SIZE)})
                </p>

                {/* Upload progress */}
                {uploadProgress.size > 0 && (
                    <div className="mt-4 space-y-2">
                        {Array.from(uploadProgress.entries()).map(([id, progress]) => (
                            <div key={id} className="bg-slate-700 rounded-full h-2">
                                <div
                                    className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* File List/Grid */}
            <div className="card">
                {filteredRecordings.length === 0 ? (
                    <div className="p-12 text-center">
                        <HardDrive className="w-16 h-16 text-slate-500 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-slate-100 mb-2">
                            {recordings.length === 0 ? 'No Files Found' : 'No Files Match Filter'}
                        </h3>
                        <p className="text-slate-400">
                            {recordings.length === 0
                                ? 'Connect your HiDock device to see files here.'
                                : 'Try adjusting your search or filter criteria.'
                            }
                        </p>
                    </div>
                ) : viewMode === 'list' ? (
                    <FileListView
                        recordings={filteredRecordings}
                        selectedRecordings={selectedRecordings}
                        onToggleSelection={toggleRecordingSelection}
                        onSelectAll={handleSelectAll}
                        onSort={handleSort}
                        sortField={sortField}
                        sortOrder={sortOrder}
                        onFileOperation={handleFileOperation}
                        getOperationProgress={getOperationProgress}
                    />
                ) : (
                    <FileGridView
                        recordings={filteredRecordings}
                        selectedRecordings={selectedRecordings}
                        onToggleSelection={toggleRecordingSelection}
                        onFileOperation={handleFileOperation}
                        getOperationProgress={getOperationProgress}
                    />
                )}
            </div>
        </div>
    );
};

// File List View Component
interface FileListViewProps {
    recordings: AudioRecording[];
    selectedRecordings: string[];
    onToggleSelection: (id: string) => void;
    onSelectAll: () => void;
    onSort: (field: SortField) => void;
    sortField: SortField;
    sortOrder: SortOrder;
    onFileOperation: (ids: string[], operation: FileOperation) => void;
    getOperationProgress: (id: string) => FileOperationProgress | undefined;
}

const FileListView: React.FC<FileListViewProps> = ({
    recordings,
    selectedRecordings,
    onToggleSelection,
    onSelectAll,
    onSort,
    sortField,
    sortOrder,
    onFileOperation,
    getOperationProgress
}) => {
    const SortButton: React.FC<{ field: SortField; children: React.ReactNode }> = ({ field, children }) => (
        <button
            onClick={() => onSort(field)}
            className="flex items-center space-x-1 hover:text-slate-100 transition-colors"
        >
            <span>{children}</span>
            {sortField === field && (
                sortOrder === 'asc' ? <SortAsc className="w-3 h-3" /> : <SortDesc className="w-3 h-3" />
            )}
        </button>
    );

    return (
        <div className="overflow-hidden">
            {/* Table Header */}
            <div className="bg-slate-700/50 px-6 py-3 border-b border-slate-600">
                <div className="grid grid-cols-12 gap-4 items-center text-sm font-medium text-slate-300">
                    <div className="col-span-1">
                        <input
                            type="checkbox"
                            checked={selectedRecordings.length === recordings.length && recordings.length > 0}
                            onChange={onSelectAll}
                            className="rounded border-slate-500 bg-slate-700 text-primary-600 focus:ring-primary-500"
                        />
                    </div>
                    <div className="col-span-4">
                        <SortButton field="name">Name</SortButton>
                    </div>
                    <div className="col-span-2">
                        <SortButton field="duration">Duration</SortButton>
                    </div>
                    <div className="col-span-2">
                        <SortButton field="size">Size</SortButton>
                    </div>
                    <div className="col-span-2">
                        <SortButton field="date">Date</SortButton>
                    </div>
                    <div className="col-span-1">
                        <SortButton field="status">Status</SortButton>
                    </div>
                </div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-slate-700">
                {recordings.map((recording) => {
                    const progress = getOperationProgress(recording.id);

                    return (
                        <div
                            key={recording.id}
                            className={`px-6 py-4 hover:bg-slate-700/30 transition-colors ${selectedRecordings.includes(recording.id) ? 'bg-primary-600/10' : ''
                                }`}
                        >
                            <div className="grid grid-cols-12 gap-4 items-center">
                                <div className="col-span-1">
                                    <input
                                        type="checkbox"
                                        checked={selectedRecordings.includes(recording.id)}
                                        onChange={() => onToggleSelection(recording.id)}
                                        className="rounded border-slate-500 bg-slate-700 text-primary-600 focus:ring-primary-500"
                                    />
                                </div>

                                <div className="col-span-4">
                                    <div className="flex items-center space-x-3">
                                        <FileText className="w-4 h-4 text-primary-400 flex-shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-slate-100 font-medium truncate">{recording.fileName}</p>
                                            {recording.transcription && (
                                                <p className="text-slate-400 text-sm flex items-center space-x-1">
                                                    <Eye className="w-3 h-3" />
                                                    <span>Transcribed</span>
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="col-span-2">
                                    <span className="text-slate-300">{formatDuration(recording.duration)}</span>
                                </div>

                                <div className="col-span-2">
                                    <span className="text-slate-300">{formatBytes(recording.size)}</span>
                                </div>

                                <div className="col-span-2">
                                    <span className="text-slate-400 text-sm">{formatDate(recording.dateCreated)}</span>
                                </div>

                                <div className="col-span-1">
                                    <div className="flex items-center space-x-2">
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(recording.status)}`}>
                                            {recording.status.replace('_', ' ')}
                                        </span>
                                        {progress && progress.status === 'in_progress' && (
                                            <Loader2 className="w-3 h-3 animate-spin text-primary-400" />
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Progress bar for active operations */}
                            {progress && progress.status === 'in_progress' && (
                                <div className="mt-2 bg-slate-700 rounded-full h-1">
                                    <div
                                        className="bg-primary-500 h-1 rounded-full transition-all duration-300"
                                        style={{ width: `${progress.progress}%` }}
                                    />
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div className="mt-3 flex items-center space-x-2">
                                <button
                                    onClick={() => onFileOperation([recording.id], 'play')}
                                    className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200"
                                    title="Play"
                                    disabled={progress?.status === 'in_progress'}
                                >
                                    <Play className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => onFileOperation([recording.id], 'download')}
                                    className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200"
                                    title="Download"
                                    disabled={progress?.status === 'in_progress'}
                                >
                                    <Download className="w-4 h-4" />
                                </button>
                                {!recording.transcription && (
                                    <button
                                        onClick={() => onFileOperation([recording.id], 'transcribe')}
                                        className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200"
                                        title="Transcribe"
                                        disabled={progress?.status === 'in_progress'}
                                    >
                                        <FileText className="w-4 h-4" />
                                    </button>
                                )}
                                <button
                                    onClick={() => {
                                        if (confirm(`Delete ${recording.fileName}?`)) {
                                            onFileOperation([recording.id], 'delete');
                                        }
                                    }}
                                    className="p-1 hover:bg-slate-600 rounded text-red-400 hover:text-red-300"
                                    title="Delete"
                                    disabled={progress?.status === 'in_progress'}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// File Grid View Component
interface FileGridViewProps {
    recordings: AudioRecording[];
    selectedRecordings: string[];
    onToggleSelection: (id: string) => void;
    onFileOperation: (ids: string[], operation: FileOperation) => void;
    getOperationProgress: (id: string) => FileOperationProgress | undefined;
}

const FileGridView: React.FC<FileGridViewProps> = ({
    recordings,
    selectedRecordings,
    onToggleSelection,
    onFileOperation,
    getOperationProgress
}) => {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
            {recordings.map((recording) => {
                const progress = getOperationProgress(recording.id);
                const isSelected = selectedRecordings.includes(recording.id);

                return (
                    <div
                        key={recording.id}
                        className={`
              relative bg-slate-700/50 rounded-lg p-4 hover:bg-slate-700 transition-all duration-200
              ${isSelected ? 'ring-2 ring-primary-500 bg-primary-600/10' : ''}
            `}
                    >
                        {/* Selection checkbox */}
                        <div className="absolute top-2 left-2">
                            <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => onToggleSelection(recording.id)}
                                className="rounded border-slate-500 bg-slate-700 text-primary-600 focus:ring-primary-500"
                            />
                        </div>

                        {/* File icon and status */}
                        <div className="flex items-center justify-between mb-3">
                            <FileText className="w-8 h-8 text-primary-400" />
                            <div className="flex items-center space-x-1">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(recording.status)}`}>
                                    {recording.status.replace('_', ' ')}
                                </span>
                                {progress && progress.status === 'in_progress' && (
                                    <Loader2 className="w-3 h-3 animate-spin text-primary-400" />
                                )}
                            </div>
                        </div>

                        {/* File info */}
                        <div className="space-y-2 mb-4">
                            <h3 className="text-slate-100 font-medium truncate" title={recording.fileName}>
                                {recording.fileName}
                            </h3>
                            <div className="text-sm text-slate-400 space-y-1">
                                <div className="flex items-center justify-between">
                                    <span>Duration:</span>
                                    <span>{formatDuration(recording.duration)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span>Size:</span>
                                    <span>{formatBytes(recording.size)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span>Date:</span>
                                    <span>{formatDate(recording.dateCreated)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Progress bar */}
                        {progress && progress.status === 'in_progress' && (
                            <div className="mb-4 bg-slate-600 rounded-full h-1">
                                <div
                                    className="bg-primary-500 h-1 rounded-full transition-all duration-300"
                                    style={{ width: `${progress.progress}%` }}
                                />
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1">
                                <button
                                    onClick={() => onFileOperation([recording.id], 'play')}
                                    className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200"
                                    title="Play"
                                    disabled={progress?.status === 'in_progress'}
                                >
                                    <Play className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => onFileOperation([recording.id], 'download')}
                                    className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200"
                                    title="Download"
                                    disabled={progress?.status === 'in_progress'}
                                >
                                    <Download className="w-4 h-4" />
                                </button>
                                {!recording.transcription && (
                                    <button
                                        onClick={() => onFileOperation([recording.id], 'transcribe')}
                                        className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200"
                                        title="Transcribe"
                                        disabled={progress?.status === 'in_progress'}
                                    >
                                        <FileText className="w-4 h-4" />
                                    </button>
                                )}
                            </div>

                            <button
                                onClick={() => {
                                    if (confirm(`Delete ${recording.fileName}?`)) {
                                        onFileOperation([recording.id], 'delete');
                                    }
                                }}
                                className="p-1.5 hover:bg-slate-600 rounded text-red-400 hover:text-red-300"
                                title="Delete"
                                disabled={progress?.status === 'in_progress'}
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// Helper function for status colors
const getStatusColor = (status: string) => {
    switch (status) {
        case 'downloaded': return 'bg-green-600/20 text-green-400';
        case 'transcribed': return 'bg-blue-600/20 text-blue-400';
        case 'playing': return 'bg-purple-600/20 text-purple-400';
        case 'downloading': return 'bg-yellow-600/20 text-yellow-400';
        case 'transcribing': return 'bg-orange-600/20 text-orange-400';
        default: return 'bg-slate-600/20 text-slate-400';
    }
};