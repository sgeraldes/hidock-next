/**
 * Mobile-Responsive File Manager Component
 * 
 * Optimized for touch interfaces and mobile devices with:
 * - Touch-friendly controls and gestures
 * - Responsive layout that adapts to screen size
 * - Swipe actions for file operations
 * - Mobile-optimized dialogs and modals
 * 
 * Requirements addressed: 8.1, 8.2, 8.3, 8.4
 */

import { useAppStore } from '@/store/useAppStore';
import type { AudioRecording } from '@/types';
import { formatBytes, formatDate, formatDuration } from '@/utils/formatters';
import {
    Check,
    Download,
    FileText,
    Filter,
    Grid, List,
    MoreVertical,
    Play,
    Plus,
    Search,
    Trash2,
    X
} from 'lucide-react';
import React, { useCallback, useState } from 'react';

interface SwipeAction {
    id: string;
    label: string;
    icon: React.ReactNode;
    color: string;
    action: () => void;
}

interface TouchPosition {
    x: number;
    y: number;
}

export const MobileFileManager: React.FC = () => {
    const {
        recordings,
        selectedRecordings,
        setSelectedRecordings,
        toggleRecordingSelection,
        updateRecording,
        removeRecording
    } = useAppStore();

    // Mobile-specific state
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [showMobileMenu, setShowMobileMenu] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('date');
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    // Touch/swipe state
    const [swipedItem, setSwipedItem] = useState<string | null>(null);
    const [touchStart, setTouchStart] = useState<TouchPosition | null>(null);
    const [touchCurrent, setTouchCurrent] = useState<TouchPosition | null>(null);
    const swipeThreshold = 100;

    // Filter recordings for mobile
    const filteredRecordings = recordings.filter(recording =>
        recording.fileName.toLowerCase().includes(searchQuery.toLowerCase())
    ).sort((a, b) => {
        switch (sortBy) {
            case 'name':
                return a.fileName.localeCompare(b.fileName);
            case 'size':
                return b.size - a.size;
            case 'date':
            default:
                return b.dateCreated.getTime() - a.dateCreated.getTime();
        }
    });

    // Touch handlers for swipe gestures
    const handleTouchStart = useCallback((e: React.TouchEvent, recordingId: string) => {
        const touch = e.touches[0];
        setTouchStart({ x: touch.clientX, y: touch.clientY });
        setSwipedItem(recordingId);
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!touchStart) return;

        const touch = e.touches[0];
        setTouchCurrent({ x: touch.clientX, y: touch.clientY });
    }, [touchStart]);

    const handleTouchEnd = useCallback(() => {
        if (!touchStart || !touchCurrent || !swipedItem) {
            setTouchStart(null);
            setTouchCurrent(null);
            return;
        }

        const deltaX = touchCurrent.x - touchStart.x;
        const deltaY = Math.abs(touchCurrent.y - touchStart.y);

        // Only trigger swipe if horizontal movement is greater than vertical
        if (Math.abs(deltaX) > swipeThreshold && deltaY < 50) {
            // Swipe actions would be implemented here
            console.log(`Swiped ${deltaX > 0 ? 'right' : 'left'} on ${swipedItem}`);
        }

        setTouchStart(null);
        setTouchCurrent(null);
        setSwipedItem(null);
    }, [touchStart, touchCurrent, swipedItem, swipeThreshold]);

    // Selection mode handlers
    const enterSelectionMode = useCallback(() => {
        setIsSelectionMode(true);
        setShowMobileMenu(false);
    }, []);

    const exitSelectionMode = useCallback(() => {
        setIsSelectionMode(false);
        setSelectedRecordings([]);
    }, [setSelectedRecordings]);

    const selectAll = useCallback(() => {
        setSelectedRecordings(filteredRecordings.map(r => r.id));
    }, [filteredRecordings, setSelectedRecordings]);

    // File operation handlers
    const handleBatchDownload = useCallback(() => {
        // Implement batch download
        console.log('Batch download:', selectedRecordings);
        exitSelectionMode();
    }, [selectedRecordings, exitSelectionMode]);

    const handleBatchDelete = useCallback(() => {
        if (confirm(`Delete ${selectedRecordings.length} file(s)?`)) {
            selectedRecordings.forEach(id => removeRecording(id));
            exitSelectionMode();
        }
    }, [selectedRecordings, removeRecording, exitSelectionMode]);

    return (
        <div className="min-h-screen bg-slate-900">
            {/* Mobile Header */}
            <div className="sticky top-0 z-10 bg-slate-800 border-b border-slate-700">
                <div className="flex items-center justify-between p-4">
                    {isSelectionMode ? (
                        <>
                            <div className="flex items-center space-x-4">
                                <button
                                    onClick={exitSelectionMode}
                                    className="p-2 hover:bg-slate-700 rounded-lg"
                                >
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                                <span className="text-slate-100 font-medium">
                                    {selectedRecordings.length} selected
                                </span>
                            </div>

                            <div className="flex items-center space-x-2">
                                <button
                                    onClick={selectAll}
                                    className="p-2 hover:bg-slate-700 rounded-lg text-slate-400"
                                >
                                    <Check className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={handleBatchDownload}
                                    className="p-2 hover:bg-slate-700 rounded-lg text-primary-400"
                                    disabled={selectedRecordings.length === 0}
                                >
                                    <Download className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={handleBatchDelete}
                                    className="p-2 hover:bg-slate-700 rounded-lg text-red-400"
                                    disabled={selectedRecordings.length === 0}
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <h1 className="text-xl font-bold text-slate-100">Files</h1>
                                <p className="text-sm text-slate-400">
                                    {filteredRecordings.length} files
                                </p>
                            </div>

                            <button
                                onClick={() => setShowMobileMenu(!showMobileMenu)}
                                className="p-2 hover:bg-slate-700 rounded-lg"
                            >
                                <MoreVertical className="w-5 h-5 text-slate-400" />
                            </button>
                        </>
                    )}
                </div>

                {/* Search Bar */}
                {!isSelectionMode && (
                    <div className="px-4 pb-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search files..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 text-base"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Mobile Menu Dropdown */}
            {showMobileMenu && (
                <div className="absolute top-16 right-4 z-20 bg-slate-800 border border-slate-700 rounded-lg shadow-xl min-w-48">
                    <div className="py-2">
                        <button
                            onClick={enterSelectionMode}
                            className="w-full px-4 py-3 text-left text-slate-100 hover:bg-slate-700 flex items-center space-x-3"
                        >
                            <Check className="w-4 h-4" />
                            <span>Select Files</span>
                        </button>

                        <button
                            onClick={() => {
                                setShowFilters(!showFilters);
                                setShowMobileMenu(false);
                            }}
                            className="w-full px-4 py-3 text-left text-slate-100 hover:bg-slate-700 flex items-center space-x-3"
                        >
                            <Filter className="w-4 h-4" />
                            <span>Filters & Sort</span>
                        </button>

                        <button
                            onClick={() => {
                                setViewMode(viewMode === 'list' ? 'grid' : 'list');
                                setShowMobileMenu(false);
                            }}
                            className="w-full px-4 py-3 text-left text-slate-100 hover:bg-slate-700 flex items-center space-x-3"
                        >
                            {viewMode === 'list' ? <Grid className="w-4 h-4" /> : <List className="w-4 h-4" />}
                            <span>{viewMode === 'list' ? 'Grid View' : 'List View'}</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Filters Panel */}
            {showFilters && (
                <div className="bg-slate-800 border-b border-slate-700 p-4">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Sort by</label>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as 'name' | 'date' | 'size')}
                                className="w-full bg-slate-700 border border-slate-600 rounded-lg text-slate-100 p-3 text-base"
                            >
                                <option value="date">Date (newest first)</option>
                                <option value="name">Name (A-Z)</option>
                                <option value="size">Size (largest first)</option>
                            </select>
                        </div>

                        <button
                            onClick={() => setShowFilters(false)}
                            className="w-full btn-primary py-3"
                        >
                            Apply Filters
                        </button>
                    </div>
                </div>
            )}

            {/* File List */}
            <div className="p-4">
                {filteredRecordings.length === 0 ? (
                    <div className="text-center py-12">
                        <FileText className="w-16 h-16 text-slate-500 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-slate-100 mb-2">No Files Found</h3>
                        <p className="text-slate-400">
                            {searchQuery ? 'Try a different search term' : 'Connect your device to see files'}
                        </p>
                    </div>
                ) : viewMode === 'list' ? (
                    <MobileFileList
                        recordings={filteredRecordings}
                        selectedRecordings={selectedRecordings}
                        isSelectionMode={isSelectionMode}
                        onToggleSelection={toggleRecordingSelection}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                        swipedItem={swipedItem}
                        touchStart={touchStart}
                        touchCurrent={touchCurrent}
                    />
                ) : (
                    <MobileFileGrid
                        recordings={filteredRecordings}
                        selectedRecordings={selectedRecordings}
                        isSelectionMode={isSelectionMode}
                        onToggleSelection={toggleRecordingSelection}
                    />
                )}
            </div>

            {/* Floating Action Button */}
            {!isSelectionMode && (
                <button className="fixed bottom-6 right-6 w-14 h-14 bg-primary-600 hover:bg-primary-700 rounded-full shadow-lg flex items-center justify-center z-10">
                    <Plus className="w-6 h-6 text-white" />
                </button>
            )}
        </div>
    );
};

// Mobile File List Component
interface MobileFileListProps {
    recordings: AudioRecording[];
    selectedRecordings: string[];
    isSelectionMode: boolean;
    onToggleSelection: (id: string) => void;
    onTouchStart: (e: React.TouchEvent, id: string) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    swipedItem: string | null;
    touchStart: TouchPosition | null;
    touchCurrent: TouchPosition | null;
}

const MobileFileList: React.FC<MobileFileListProps> = ({
    recordings,
    selectedRecordings,
    isSelectionMode,
    onToggleSelection,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    swipedItem,
    touchStart,
    touchCurrent
}) => {
    const getSwipeOffset = (recordingId: string) => {
        if (swipedItem !== recordingId || !touchStart || !touchCurrent) return 0;
        return touchCurrent.x - touchStart.x;
    };

    return (
        <div className="space-y-2">
            {recordings.map((recording) => {
                const isSelected = selectedRecordings.includes(recording.id);
                const swipeOffset = getSwipeOffset(recording.id);

                return (
                    <div
                        key={recording.id}
                        className="relative overflow-hidden"
                        onTouchStart={(e) => onTouchStart(e, recording.id)}
                        onTouchMove={onTouchMove}
                        onTouchEnd={onTouchEnd}
                    >
                        {/* Swipe Actions Background */}
                        <div className="absolute inset-0 flex items-center justify-between bg-slate-700">
                            <div className="flex items-center space-x-4 pl-4">
                                <button className="p-3 bg-primary-600 rounded-full">
                                    <Play className="w-4 h-4 text-white" />
                                </button>
                                <button className="p-3 bg-green-600 rounded-full">
                                    <Download className="w-4 h-4 text-white" />
                                </button>
                            </div>
                            <div className="flex items-center space-x-4 pr-4">
                                <button className="p-3 bg-red-600 rounded-full">
                                    <Trash2 className="w-4 h-4 text-white" />
                                </button>
                            </div>
                        </div>

                        {/* File Item */}
                        <div
                            className={`
                relative bg-slate-800 border border-slate-700 rounded-lg p-4 transition-all duration-200
                ${isSelected ? 'bg-primary-600/10 border-primary-500' : ''}
                ${isSelectionMode ? 'pl-12' : ''}
              `}
                            style={{
                                transform: `translateX(${Math.max(-100, Math.min(100, swipeOffset))}px)`
                            }}
                        >
                            {/* Selection Checkbox */}
                            {isSelectionMode && (
                                <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => onToggleSelection(recording.id)}
                                        className="w-5 h-5 rounded border-slate-500 bg-slate-700 text-primary-600 focus:ring-primary-500"
                                    />
                                </div>
                            )}

                            <div className="flex items-center space-x-4">
                                {/* File Icon */}
                                <div className="flex-shrink-0">
                                    <div className="w-12 h-12 bg-primary-600/20 rounded-lg flex items-center justify-center">
                                        <FileText className="w-6 h-6 text-primary-400" />
                                    </div>
                                </div>

                                {/* File Info */}
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-slate-100 font-medium truncate mb-1">
                                        {recording.fileName}
                                    </h3>
                                    <div className="flex items-center space-x-4 text-sm text-slate-400">
                                        <span>{formatDuration(recording.duration)}</span>
                                        <span>{formatBytes(recording.size)}</span>
                                        <span>{formatDate(recording.dateCreated)}</span>
                                    </div>
                                    {recording.transcription && (
                                        <div className="flex items-center space-x-1 mt-1">
                                            <FileText className="w-3 h-3 text-blue-400" />
                                            <span className="text-xs text-blue-400">Transcribed</span>
                                        </div>
                                    )}
                                </div>

                                {/* Status Badge */}
                                <div className="flex-shrink-0">
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(recording.status)}`}>
                                        {recording.status.replace('_', ' ')}
                                    </span>
                                </div>

                                {/* Action Menu (when not in selection mode) */}
                                {!isSelectionMode && (
                                    <button className="flex-shrink-0 p-2 hover:bg-slate-700 rounded-lg">
                                        <MoreVertical className="w-4 h-4 text-slate-400" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// Mobile File Grid Component
interface MobileFileGridProps {
    recordings: AudioRecording[];
    selectedRecordings: string[];
    isSelectionMode: boolean;
    onToggleSelection: (id: string) => void;
}

const MobileFileGrid: React.FC<MobileFileGridProps> = ({
    recordings,
    selectedRecordings,
    isSelectionMode,
    onToggleSelection
}) => {
    return (
        <div className="grid grid-cols-2 gap-4">
            {recordings.map((recording) => {
                const isSelected = selectedRecordings.includes(recording.id);

                return (
                    <div
                        key={recording.id}
                        className={`
              relative bg-slate-800 border border-slate-700 rounded-lg p-4 transition-all duration-200
              ${isSelected ? 'bg-primary-600/10 border-primary-500' : ''}
            `}
                    >
                        {/* Selection Checkbox */}
                        {isSelectionMode && (
                            <div className="absolute top-2 left-2">
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => onToggleSelection(recording.id)}
                                    className="w-4 h-4 rounded border-slate-500 bg-slate-700 text-primary-600 focus:ring-primary-500"
                                />
                            </div>
                        )}

                        {/* File Icon */}
                        <div className="flex justify-center mb-3">
                            <div className="w-16 h-16 bg-primary-600/20 rounded-lg flex items-center justify-center">
                                <FileText className="w-8 h-8 text-primary-400" />
                            </div>
                        </div>

                        {/* File Info */}
                        <div className="text-center space-y-2">
                            <h3 className="text-slate-100 font-medium text-sm truncate" title={recording.fileName}>
                                {recording.fileName}
                            </h3>

                            <div className="text-xs text-slate-400 space-y-1">
                                <div>{formatDuration(recording.duration)}</div>
                                <div>{formatBytes(recording.size)}</div>
                            </div>

                            {/* Status Badge */}
                            <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(recording.status)}`}>
                                {recording.status.replace('_', ' ')}
                            </span>

                            {recording.transcription && (
                                <div className="flex items-center justify-center space-x-1">
                                    <FileText className="w-3 h-3 text-blue-400" />
                                    <span className="text-xs text-blue-400">Transcribed</span>
                                </div>
                            )}
                        </div>

                        {/* Quick Actions (when not in selection mode) */}
                        {!isSelectionMode && (
                            <div className="flex justify-center space-x-2 mt-3">
                                <button className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg">
                                    <Play className="w-3 h-3 text-slate-400" />
                                </button>
                                <button className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg">
                                    <Download className="w-3 h-3 text-slate-400" />
                                </button>
                                <button className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg">
                                    <MoreVertical className="w-3 h-3 text-slate-400" />
                                </button>
                            </div>
                        )}
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