import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Music, Download, Play, Pause, Trash2, FileText, ChevronUp, ChevronDown, ChevronsUpDown, Search, Filter, X, Clock, HardDrive } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { AudioPlayer } from '@/components/AudioPlayer';
import { formatBytes, formatDuration, formatDate } from '@/utils/formatters';
import type { AudioRecording } from '@/types';

type SortField = 'name' | 'duration' | 'size' | 'date' | 'status';
type SortDirection = 'asc' | 'desc';

interface FilterState {
  searchTerm: string;
  fileType: 'all' | 'hda' | 'wav' | 'mp3';
  dateRange: 'all' | 'today' | 'week' | 'month' | 'year';
  sizeRange: 'all' | 'small' | 'medium' | 'large'; // small: <10MB, medium: 10-50MB, large: >50MB
  status: 'all' | 'downloaded' | 'transcribed' | 'not_transcribed' | 'on_device';
}

export const Recordings: React.FC = () => {
  const {
    recordings,
    selectedRecordings,
    isLoading,
    loadingProgress,
    toggleRecordingSelection,
    setSelectedRecordings,
    updateRecording
  } = useAppStore();

  // Log recordings count changes
  React.useEffect(() => {
    console.log(`🖼️ UI: Recordings page re-rendered with ${recordings.length} files at ${new Date().toLocaleTimeString()}`);
  }, [recordings.length]);

  const [playingRecording, setPlayingRecording] = useState<AudioRecording | null>(null);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    searchTerm: '',
    fileType: 'all',
    dateRange: 'all',
    sizeRange: 'all',
    status: 'all'
  });
  
  // Check for navigation from Dashboard
  React.useEffect(() => {
    const sortPreference = sessionStorage.getItem('recordings-sort');
    const filterPreference = sessionStorage.getItem('recordings-filter');
    
    if (sortPreference) {
      if (sortPreference === 'duration-desc') {
        setSortField('duration');
        setSortDirection('desc');
      } else if (sortPreference === 'date-desc') {
        setSortField('date');
        setSortDirection('desc');
      }
      sessionStorage.removeItem('recordings-sort');
    }
    
    if (filterPreference) {
      if (filterPreference === 'downloaded') {
        setFilters(prev => ({ ...prev, status: 'downloaded' }));
      } else if (filterPreference === 'transcribed') {
        setFilters(prev => ({ ...prev, status: 'transcribed' }));
      }
      sessionStorage.removeItem('recordings-filter');
    }
  }, []);
  
  // Mobile-specific states
  const [selectionMode, setSelectionMode] = useState(false);
  const [activeRecording, setActiveRecording] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showActionButtons, setShowActionButtons] = useState(false);
  const [showSelectionBar, setShowSelectionBar] = useState(false);
  const [screenWidth, setScreenWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  
  // Detect mobile viewport and screen size
  React.useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      setScreenWidth(width);
      setIsMobile(width < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // Animate action buttons in/out
  React.useEffect(() => {
    if (isMobile && activeRecording && !selectionMode) {
      // Small delay before showing to make animation smoother
      const timer = setTimeout(() => setShowActionButtons(true), 50);
      return () => clearTimeout(timer);
    } else {
      setShowActionButtons(false);
    }
  }, [isMobile, activeRecording, selectionMode]);
  
  // Animate selection bar in/out
  React.useEffect(() => {
    if (isMobile && selectionMode && selectedRecordings.length > 0) {
      const timer = setTimeout(() => setShowSelectionBar(true), 50);
      return () => clearTimeout(timer);
    } else {
      setShowSelectionBar(false);
    }
  }, [isMobile, selectionMode, selectedRecordings.length]);

  const handleSelectAll = () => {
    if (selectedRecordings.length === filteredRecordings.length) {
      setSelectedRecordings([]);
      if (isMobile) setSelectionMode(false);
    } else {
      setSelectedRecordings(filteredRecordings.map(r => r.id));
    }
  };
  
  // Handle long press for mobile selection mode
  const handleLongPress = (recordingId: string) => {
    if (isMobile && !selectionMode) {
      setSelectionMode(true);
      setSelectedRecordings([recordingId]);
      setActiveRecording(null);
    }
  };
  
  // Handle row click on mobile
  const handleRowClick = (recording: AudioRecording) => {
    if (isMobile) {
      if (selectionMode) {
        toggleRecordingSelection(recording.id);
      } else {
        setActiveRecording(activeRecording === recording.id ? null : recording.id);
      }
    }
  };
  
  // Exit selection mode when no items selected
  React.useEffect(() => {
    if (isMobile && selectionMode && selectedRecordings.length === 0) {
      setSelectionMode(false);
    }
  }, [selectedRecordings, selectionMode, isMobile]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ChevronsUpDown className="w-3 h-3 text-slate-500" />;
    }
    return sortDirection === 'asc' 
      ? <ChevronUp className="w-3 h-3 text-primary-400" />
      : <ChevronDown className="w-3 h-3 text-primary-400" />;
  };

  // Filter recordings based on all filter criteria
  const filteredRecordings = useMemo(() => {
    return recordings.filter(recording => {
      // Search term filter
      if (filters.searchTerm) {
        const searchLower = filters.searchTerm.toLowerCase();
        if (!recording.fileName.toLowerCase().includes(searchLower)) {
          return false;
        }
      }

      // File type filter
      if (filters.fileType !== 'all') {
        const extension = recording.fileName.split('.').pop()?.toLowerCase();
        if (extension !== filters.fileType) {
          return false;
        }
      }

      // Date range filter
      if (filters.dateRange !== 'all') {
        const recordingDate = recording.dateCreated instanceof Date 
          ? recording.dateCreated 
          : new Date(recording.dateCreated);
        const now = new Date();
        const dayInMs = 24 * 60 * 60 * 1000;
        
        switch (filters.dateRange) {
          case 'today':
            if (now.getTime() - recordingDate.getTime() > dayInMs) return false;
            break;
          case 'week':
            if (now.getTime() - recordingDate.getTime() > 7 * dayInMs) return false;
            break;
          case 'month':
            if (now.getTime() - recordingDate.getTime() > 30 * dayInMs) return false;
            break;
          case 'year':
            if (now.getTime() - recordingDate.getTime() > 365 * dayInMs) return false;
            break;
        }
      }

      // Size range filter
      if (filters.sizeRange !== 'all') {
        const sizeInMB = recording.size / (1024 * 1024);
        switch (filters.sizeRange) {
          case 'small':
            if (sizeInMB >= 10) return false;
            break;
          case 'medium':
            if (sizeInMB < 10 || sizeInMB >= 50) return false;
            break;
          case 'large':
            if (sizeInMB < 50) return false;
            break;
        }
      }

      // Status filter
      if (filters.status !== 'all') {
        if (filters.status === 'downloaded' && recording.status !== 'downloaded') return false;
        if (filters.status === 'transcribed' && !recording.transcription) return false;
        if (filters.status === 'not_transcribed' && recording.transcription) return false;
        if (filters.status === 'on_device' && recording.status !== 'on_device') return false;
      }

      return true;
    });
  }, [recordings, filters]);

  const sortedRecordings = useMemo(() => {
    return [...filteredRecordings].sort((a, b) => {
      let compareValue = 0;
      
      switch (sortField) {
        case 'name':
          compareValue = a.fileName.localeCompare(b.fileName);
          break;
        case 'duration':
          compareValue = a.duration - b.duration;
          break;
        case 'size':
          compareValue = a.size - b.size;
          break;
        case 'date':
          const dateA = a.dateCreated instanceof Date ? a.dateCreated : new Date(a.dateCreated);
          const dateB = b.dateCreated instanceof Date ? b.dateCreated : new Date(b.dateCreated);
          compareValue = dateA.getTime() - dateB.getTime();
          break;
        case 'status':
          compareValue = a.status.localeCompare(b.status);
          break;
      }
      
      return sortDirection === 'asc' ? compareValue : -compareValue;
    });
  }, [filteredRecordings, sortField, sortDirection]);

  const resetFilters = () => {
    setFilters({
      searchTerm: '',
      fileType: 'all',
      dateRange: 'all',
      sizeRange: 'all',
      status: 'all'
    });
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.searchTerm) count++;
    if (filters.fileType !== 'all') count++;
    if (filters.dateRange !== 'all') count++;
    if (filters.sizeRange !== 'all') count++;
    if (filters.status !== 'all') count++;
    return count;
  }, [filters]);
  
  // Responsive date formatting
  const formatResponsiveDate = (date: Date | string) => {
    const d = date instanceof Date ? date : new Date(date);
    
    if (screenWidth < 360) {
      // Very small screens: MM/DD HH:MM
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${month}/${day} ${hours}:${minutes}`;
    } else if (screenWidth < 640) {
      // Small screens: MMM DD, HH:MM
      return d.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } else if (screenWidth < 1024) {
      // Medium screens: MMM DD, YYYY HH:MM
      return d.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } else {
      // Large screens: full date
      return formatDate(d);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'downloaded': return 'bg-green-600/20 text-green-400';
      case 'transcribed': return 'bg-blue-600/20 text-blue-400';
      case 'playing': return 'bg-purple-600/20 text-purple-400';
      case 'downloading': return 'bg-yellow-600/20 text-yellow-400';
      default: return 'bg-slate-600/20 text-slate-400';
    }
  };

  const handlePlayRecording = async (recording: AudioRecording) => {
    if (playingRecording?.id === recording.id) {
      setPlayingRecording(null);
      updateRecording(recording.id, { status: 'downloaded' });
    } else {
      try {
        // Update status to show loading
        updateRecording(recording.id, { status: 'downloading' });
        
        // Get the audio URL before setting as playing
        await getAudioUrl(recording);
        
        setPlayingRecording(recording);
        updateRecording(recording.id, { status: 'playing' });
      } catch (error) {
        console.error('Failed to load audio:', error);
        updateRecording(recording.id, { status: 'error' });
        alert(`Failed to load audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  const handleRecordingEnded = () => {
    if (playingRecording) {
      updateRecording(playingRecording.id, { status: 'downloaded' });
      setPlayingRecording(null);
    }
  };

  const [audioUrls, setAudioUrls] = useState<Map<string, string>>(new Map());

  const getAudioUrl = async (recording: AudioRecording): Promise<string> => {
    // Check if we already have a URL for this recording
    const existingUrl = audioUrls.get(recording.id);
    if (existingUrl) {
      return existingUrl;
    }

    try {
      // Import device service dynamically to avoid circular dependencies
      const { deviceService } = await import('@/services/deviceService');
      
      // Check if device is connected
      if (!deviceService.isDeviceConnected()) {
        throw new Error('Device not connected. Please connect your HiDock device.');
      }
      
      // Download with reasonable timeout (should be fast now without file list fetch)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Download timeout after 30 seconds')), 30000);
      });
      
      // Pass the filename and size directly - no more file list fetching!
      const audioUrl = await Promise.race([
        deviceService.getAudioBlobUrl(recording.id, recording.fileName, recording.size),
        timeoutPromise
      ]);
      
      // Store the URL for future use
      setAudioUrls(prev => new Map(prev).set(recording.id, audioUrl));
      
      return audioUrl;
    } catch (error) {
      console.error('Failed to get audio URL:', error);
      throw error;
    }
  };

  const handleDownloadRecording = async (recording: AudioRecording) => {
    try {
      // Update status to show downloading
      updateRecording(recording.id, { status: 'downloading' });
      
      // Get or create the audio URL (blob URL from device)
      const audioUrl = await getAudioUrl(recording);
      
      // Create a download link for the blob URL
      const link = document.createElement('a');
      link.href = audioUrl;
      link.download = recording.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Update status back to downloaded
      updateRecording(recording.id, { status: 'downloaded' });
    } catch (error) {
      console.error('Failed to download recording:', error);
      updateRecording(recording.id, { status: 'error' });
      alert(`Failed to download: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleBulkDownload = async () => {
    for (const recordingId of selectedRecordings) {
      const recording = recordings.find(r => r.id === recordingId);
      if (recording) {
        await handleDownloadRecording(recording);
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0">
        {/* Mobile Header */}
        {isMobile ? (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h1 className="text-lg font-bold text-slate-100">Recordings</h1>
                <p className="text-xs text-slate-400">
                  {filteredRecordings.length}/{recordings.length}
                  {activeFilterCount > 0 && ` • ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}`}
                </p>
              </div>
              {selectionMode && (
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      setSelectionMode(false);
                      setSelectedRecordings([]);
                    }}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSelectAll}
                    className="text-xs bg-slate-700 px-3 py-1 rounded text-white"
                  >
                    {selectedRecordings.length === filteredRecordings.length ? 'None' : 'All'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Desktop Header */
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
            <div className="mb-4 sm:mb-0">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-100">Recordings</h1>
              <p className="text-sm text-slate-400">
                {filteredRecordings.length} of {recordings.length} recordings
                {activeFilterCount > 0 && ` (${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active)`}
              </p>
            </div>

            <div className="flex items-center space-x-2 sm:space-x-3">
              <button
                onClick={handleSelectAll}
                className="btn-secondary text-sm sm:text-base"
              >
                {selectedRecordings.length === recordings.length ? 'Deselect All' : 'Select All'}
              </button>

              {selectedRecordings.length > 0 && (
                <>
                  <button 
                    onClick={handleBulkDownload}
                    className="btn-primary flex items-center space-x-1 sm:space-x-2 text-sm sm:text-base"
                  >
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">Download ({selectedRecordings.length})</span>
                    <span className="sm:hidden">({selectedRecordings.length})</span>
                  </button>

                  <button className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-3 sm:px-4 rounded-lg flex items-center space-x-1 sm:space-x-2 text-sm sm:text-base">
                    <Trash2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Delete ({selectedRecordings.length})</span>
                    <span className="sm:hidden">({selectedRecordings.length})</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Search and Filter Bar */}
        <div className={`flex ${isMobile ? 'flex-col gap-2' : 'flex-col sm:flex-row gap-3'} mb-3 sm:mb-4`}>
          <div className={`flex ${isMobile ? 'flex-row gap-2' : 'flex-1 gap-3'}`}>
            {/* Search Input */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder={isMobile ? "Search..." : "Search recordings..."}
                value={filters.searchTerm}
                onChange={(e) => setFilters(prev => ({ ...prev, searchTerm: e.target.value }))}
                className={`w-full pl-9 pr-8 ${isMobile ? 'py-1.5 text-sm' : 'py-2'} bg-slate-700 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500`}
              />
              {filters.searchTerm && (
                <button
                  onClick={() => setFilters(prev => ({ ...prev, searchTerm: '' }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Filter Toggle Button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center justify-center ${isMobile ? 'px-3' : 'px-4'} ${isMobile ? 'py-1.5' : 'py-2'} rounded-lg transition-colors ${
                showFilters || activeFilterCount > 0
                  ? 'bg-primary-600 text-white hover:bg-primary-700'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <Filter className="w-4 h-4" />
              {!isMobile && <span className="ml-2">Filters</span>}
              {activeFilterCount > 0 && (
                <span className={`bg-white/20 px-1.5 py-0.5 rounded-full text-xs ${isMobile ? 'ml-1' : 'ml-2'}`}>
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* Sort Dropdown for Mobile */}
          {isMobile && (
            <div className="flex gap-2">
              <select
                value={`${sortField}-${sortDirection}`}
                onChange={(e) => {
                  const [field, dir] = e.target.value.split('-');
                  setSortField(field as SortField);
                  setSortDirection(dir as SortDirection);
                }}
                className="flex-1 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
              >
                <option value="date-desc">Date (Newest)</option>
                <option value="date-asc">Date (Oldest)</option>
                <option value="name-asc">Name (A-Z)</option>
                <option value="name-desc">Name (Z-A)</option>
                <option value="duration-desc">Duration (Longest)</option>
                <option value="duration-asc">Duration (Shortest)</option>
                <option value="size-desc">Size (Largest)</option>
                <option value="size-asc">Size (Smallest)</option>
                <option value="status-asc">Status</option>
              </select>
            </div>
          )}
        </div>

        {/* Filter Options Panel */}
        {showFilters && (
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* File Type Filter */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">File Type</label>
                <select
                  value={filters.fileType}
                  onChange={(e) => setFilters(prev => ({ ...prev, fileType: e.target.value as FilterState['fileType'] }))}
                  className="w-full px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                >
                  <option value="all">All Formats</option>
                  <option value="hda">HDA (Device)</option>
                  <option value="wav">WAV (Converted)</option>
                  <option value="mp3">MP3 (Converted)</option>
                </select>
              </div>

              {/* Date Range Filter */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Date Range</label>
                <select
                  value={filters.dateRange}
                  onChange={(e) => setFilters(prev => ({ ...prev, dateRange: e.target.value as FilterState['dateRange'] }))}
                  className="w-full px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                >
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="year">This Year</option>
                </select>
              </div>

              {/* Size Range Filter */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">File Size</label>
                <select
                  value={filters.sizeRange}
                  onChange={(e) => setFilters(prev => ({ ...prev, sizeRange: e.target.value as FilterState['sizeRange'] }))}
                  className="w-full px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                >
                  <option value="all">All Sizes</option>
                  <option value="small">&lt; 10 MB</option>
                  <option value="medium">10 - 50 MB</option>
                  <option value="large">&gt; 50 MB</option>
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value as FilterState['status'] }))}
                  className="w-full px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                >
                  <option value="all">All Status</option>
                  <option value="on_device">○  On Device</option>
                  <option value="downloaded">●  Downloaded</option>
                  <option value="transcribed">✓  Transcribed</option>
                  <option value="not_transcribed">✗  Not Transcribed</option>
                </select>
              </div>

              {/* Reset Filters Button */}
              <div className="flex items-end">
                <button
                  onClick={resetFilters}
                  className="w-full px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-300 hover:text-white transition-colors"
                >
                  Reset All
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {(isLoading || loadingProgress) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-slate-800/95 backdrop-blur-sm rounded-xl p-8 shadow-2xl border border-slate-700 pointer-events-auto">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
              {loadingProgress ? (
                <>
                  <h3 className="text-lg font-semibold text-slate-100 mb-2">
                    {loadingProgress.operation}
                  </h3>
                  <div className="bg-slate-700 rounded-full h-2 w-64 mb-2 mx-auto">
                    <div
                      className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min((loadingProgress.current / Math.max(loadingProgress.total, 1)) * 100, 100)}%`
                      }}
                    />
                  </div>
                  <p className="text-slate-400">
                    {loadingProgress.message || `${loadingProgress.current}/${loadingProgress.total}`}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold text-slate-100 mb-2">Loading Recordings...</h3>
                  <p className="text-slate-400">Please wait while we fetch your recordings</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recordings List */}
      <div className={`flex-1 overflow-hidden`}>
        <div className={`card h-full relative ${(isLoading || loadingProgress) ? 'overflow-hidden' : ''} flex flex-col`}>
        {/* Blurred backdrop for loading - only on table */}
        {(isLoading || loadingProgress) && (
          <div className="absolute inset-0 bg-slate-800/80 backdrop-blur-sm z-[5] rounded-xl"></div>
        )}

        {filteredRecordings.length === 0 && !isLoading && !loadingProgress ? (
          <div className="p-12 text-center">
            <Music className="w-16 h-16 text-slate-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-100 mb-2">No Recordings Found</h3>
            <p className="text-slate-400">
              {recordings.length === 0 
                ? "Connect your HiDock device to see your recordings here."
                : activeFilterCount > 0
                ? "No recordings match your current filters. Try adjusting or resetting them."
                : "No recordings match your search criteria."
              }
            </p>
            {activeFilterCount > 0 && (
              <button
                onClick={resetFilters}
                className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300 hover:text-white transition-colors"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Desktop Table Header - Hidden on Mobile */}
            {screenWidth >= 640 && (
              <div className="bg-slate-700/50 px-3 sm:px-6 py-3 border-b border-slate-600 flex-shrink-0">
                <div className={`grid ${screenWidth >= 1280 ? 'grid-cols-12' : screenWidth >= 1024 ? 'grid-cols-11' : 'grid-cols-10'} gap-2 sm:gap-4 items-center text-xs sm:text-sm font-medium text-slate-300`}>
                  <div className="col-span-1">
                    <input
                      type="checkbox"
                      checked={selectedRecordings.length === recordings.length && recordings.length > 0}
                      onChange={handleSelectAll}
                      className="rounded border-slate-500 bg-slate-700 text-primary-600 focus:ring-primary-500 w-4 h-4"
                    />
                  </div>
                  <div className="col-span-5 sm:col-span-4">
                    <button
                      onClick={() => handleSort('name')}
                      className="flex items-center space-x-1 hover:text-slate-100 transition-colors"
                    >
                      <span>Name</span>
                      {getSortIcon('name')}
                    </button>
                  </div>
                  <div className="col-span-2 hidden sm:block">
                    <button
                      onClick={() => handleSort('duration')}
                      className="flex items-center space-x-1 hover:text-slate-100 transition-colors"
                    >
                      <span>Duration</span>
                      {getSortIcon('duration')}
                    </button>
                  </div>
                  <div className="col-span-2">
                    <button
                      onClick={() => handleSort('size')}
                      className="flex items-center space-x-1 hover:text-slate-100 transition-colors"
                    >
                      <span>Size</span>
                      {getSortIcon('size')}
                    </button>
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <button
                      onClick={() => handleSort('date')}
                      className="flex items-center space-x-1 hover:text-slate-100 transition-colors"
                    >
                      <span className="hidden sm:inline">Date</span>
                      <span className="sm:hidden">Date</span>
                      {getSortIcon('date')}
                    </button>
                  </div>
                  <div className="col-span-1">
                    <button
                      onClick={() => handleSort('status')}
                      className="flex items-center space-x-1 hover:text-slate-100 transition-colors"
                    >
                      <span className="hidden lg:inline">Status</span>
                      {getSortIcon('status')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Scrollable List/Table Body */}
            <div className="flex-1 overflow-auto pb-2">
              <div className={isMobile ? "" : "divide-y divide-slate-700"}>
                {sortedRecordings.map((recording) => {
                  // Handle long press for mobile
                  let pressTimer: NodeJS.Timeout;
                  const handleTouchStart = () => {
                    if (isMobile) {
                      pressTimer = setTimeout(() => {
                        handleLongPress(recording.id);
                      }, 500);
                    }
                  };
                  const handleTouchEnd = () => {
                    if (pressTimer) clearTimeout(pressTimer);
                  };
                  
                  return screenWidth < 640 ? (
                    /* Mobile Compact Layout */
                    <div
                      key={recording.id}
                      className={`relative border-b border-slate-700 ${
                        selectedRecordings.includes(recording.id) ? 'bg-primary-600/10' : ''
                      } ${activeRecording === recording.id ? 'bg-slate-700/30' : ''}`}
                      onClick={() => handleRowClick(recording)}
                      onTouchStart={handleTouchStart}
                      onTouchEnd={handleTouchEnd}
                      onTouchCancel={handleTouchEnd}
                    >
                      <div className="px-3 py-2 flex items-center">
                        {/* Checkbox - Only visible in selection mode */}
                        {selectionMode && (
                          <input
                            type="checkbox"
                            checked={selectedRecordings.includes(recording.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              toggleRecordingSelection(recording.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="mr-3 rounded border-slate-500 bg-slate-700 text-primary-600 focus:ring-primary-500"
                          />
                        )}
                        
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0 mr-2">
                              {/* File Name */}
                              <p className="text-sm font-medium text-slate-100 truncate">
                                {recording.fileName}
                              </p>
                              {/* Metadata Line */}
                              <div className="flex items-center space-x-3 mt-0.5 text-xs text-slate-400">
                                <span>{formatDuration(recording.duration)}</span>
                                <span>•</span>
                                <span>{formatBytes(recording.size)}</span>
                                <span>•</span>
                                <span>{formatResponsiveDate(recording.dateCreated)}</span>
                                {recording.transcription && (
                                  <>
                                    <span>•</span>
                                    <FileText className="w-3 h-3 inline" />
                                  </>
                                )}
                              </div>
                            </div>
                            {/* Status Indicator */}
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${
                              recording.status === 'downloaded' ? 'bg-green-400' :
                              recording.status === 'transcribed' ? 'bg-blue-400' :
                              recording.status === 'playing' ? 'bg-purple-400' :
                              recording.status === 'downloading' ? 'bg-yellow-400' :
                              'bg-slate-400'
                            }`} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Desktop Table Layout */
                    <div
                      key={recording.id}
                      className={`group hover:bg-slate-700/30 transition-colors relative ${
                        selectedRecordings.includes(recording.id) ? 'bg-primary-600/10' : ''
                      }`}
                    >
                      <div className="px-3 sm:px-6 py-2 sm:py-3">
                      <div className={`grid ${screenWidth >= 1280 ? 'grid-cols-12' : screenWidth >= 1024 ? 'grid-cols-11' : 'grid-cols-10'} gap-2 sm:gap-4 items-center`}>
                    <div className="col-span-1">
                      <input
                        type="checkbox"
                        checked={selectedRecordings.includes(recording.id)}
                        onChange={() => toggleRecordingSelection(recording.id)}
                        className="rounded border-slate-500 bg-slate-700 text-primary-600 focus:ring-primary-500 w-4 h-4"
                      />
                    </div>

                    <div className={`${screenWidth >= 1280 ? 'col-span-4' : screenWidth >= 1024 ? 'col-span-3' : 'col-span-3'}`}>
                      <div className="flex items-center space-x-2 sm:space-x-3">
                        <Music className="w-3 h-3 sm:w-4 sm:h-4 text-primary-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-slate-100 font-medium text-xs sm:text-sm truncate">{recording.fileName}</p>
                          {recording.transcription && (
                            <p className="text-slate-400 text-xs flex items-center space-x-1">
                              <FileText className="w-3 h-3" />
                              <span>Transcribed</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className={`${screenWidth >= 1024 ? 'col-span-2' : 'hidden'}`}>
                      <span className="text-slate-300 text-xs sm:text-sm">{formatDuration(recording.duration)}</span>
                    </div>

                    <div className="col-span-2">
                      <span className="text-slate-300 text-xs sm:text-sm">{formatBytes(recording.size)}</span>
                    </div>

                    <div className={`${screenWidth >= 1280 ? 'col-span-2' : 'col-span-3'}`}>
                      <span className="text-slate-400 text-xs sm:text-sm">{formatResponsiveDate(recording.dateCreated)}</span>
                    </div>

                    <div className={`${screenWidth >= 1280 ? 'col-span-1' : 'col-span-2'}`}>
                      <span className={`px-1 sm:px-2 py-0.5 sm:py-1 rounded-full text-xs font-medium ${getStatusColor(recording.status)}`}>
                        {screenWidth >= 1280 ? (
                          recording.status.replace('_', ' ')
                        ) : (
                          recording.status === 'on_device' ? '○' : '●'
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons - Always visible on mobile, hover on desktop */}
                  <div className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 pointer-events-auto sm:pointer-events-none sm:group-hover:pointer-events-auto transition-opacity duration-200">
                    <div className="bg-slate-800/95 backdrop-blur-sm border border-slate-600/50 rounded-lg px-2 py-1 flex items-center space-x-1 shadow-xl">
                      <button
                        onClick={() => handlePlayRecording(recording)}
                        className={`p-1 hover:bg-slate-600 rounded transition-colors ${
                          playingRecording?.id === recording.id 
                            ? 'text-primary-400 bg-slate-700' 
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title={playingRecording?.id === recording.id ? "Stop" : "Play"}
                        disabled={recording.status === 'downloading'}
                      >
                        {recording.status === 'downloading' ? (
                          <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                        ) : playingRecording?.id === recording.id ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDownloadRecording(recording)}
                        className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200 transition-colors"
                        title="Download"
                        disabled={recording.status === 'downloading'}
                      >
                        {recording.status === 'downloading' && !playingRecording ? (
                          <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                      </button>
                      {recording.transcription && (
                        <button
                          className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200 transition-colors"
                          title="View Transcription"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        className="p-1 hover:bg-slate-600 rounded text-red-400 hover:text-red-300 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Inline Audio Player */}
                  {playingRecording?.id === recording.id && (
                    <div className="mt-4 border-t border-slate-700 pt-4">
                      <AudioPlayer
                        src={audioUrls.get(recording.id) || ''}
                        title={recording.fileName}
                        onEnded={handleRecordingEnded}
                        onPause={() => updateRecording(recording.id, { status: 'downloaded' })}
                        autoPlay={true}
                        showAdvancedControls={true}
                      />
                    </div>
                  )}
                  </div>
                </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
      
      {/* Mobile Floating Action Buttons */}
      {isMobile && activeRecording && !selectionMode && (
        <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-out ${
          showActionButtons 
            ? 'opacity-100 translate-y-0 scale-100' 
            : 'opacity-0 translate-y-4 scale-95 pointer-events-none'
        }`}>
          <div className="bg-slate-800/95 backdrop-blur-sm border border-slate-600 rounded-full px-4 py-3 flex items-center space-x-4 shadow-2xl">
            {(() => {
              const recording = sortedRecordings.find(r => r.id === activeRecording);
              if (!recording) return null;
              
              return (
                <>
                  <button
                    onClick={() => handlePlayRecording(recording)}
                    style={{
                      transitionDelay: showActionButtons ? '50ms' : '0ms'
                    }}
                    className={`p-3 rounded-full transition-all duration-300 transform hover:scale-110 ${
                      showActionButtons ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                    } ${
                      playingRecording?.id === recording.id 
                        ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/30' 
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                    disabled={recording.status === 'downloading'}
                  >
                    {recording.status === 'downloading' ? (
                      <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    ) : playingRecording?.id === recording.id ? (
                      <Pause className="w-5 h-5" />
                    ) : (
                      <Play className="w-5 h-5" />
                    )}
                  </button>
                  
                  <button
                    onClick={() => handleDownloadRecording(recording)}
                    style={{
                      transitionDelay: showActionButtons ? '100ms' : '0ms'
                    }}
                    className={`p-3 bg-slate-700 text-slate-300 rounded-full hover:bg-slate-600 transition-all duration-300 transform hover:scale-110 ${
                      showActionButtons ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                    }`}
                    disabled={recording.status === 'downloading'}
                  >
                    {recording.status === 'downloading' && !playingRecording ? (
                      <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Download className="w-5 h-5" />
                    )}
                  </button>
                  
                  {recording.transcription && (
                    <button
                      style={{
                        transitionDelay: showActionButtons ? '150ms' : '0ms'
                      }}
                      className={`p-3 bg-slate-700 text-slate-300 rounded-full hover:bg-slate-600 transition-all duration-300 transform hover:scale-110 ${
                        showActionButtons ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                      }`}
                    >
                      <FileText className="w-5 h-5" />
                    </button>
                  )}
                  
                  <button
                    style={{
                      transitionDelay: showActionButtons ? '200ms' : '0ms'
                    }}
                    className={`p-3 bg-red-600/20 text-red-400 rounded-full hover:bg-red-600/30 transition-all duration-300 transform hover:scale-110 ${
                      showActionButtons ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                    }`}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}
      
      {/* Mobile Selection Action Bar */}
      {isMobile && selectionMode && selectedRecordings.length > 0 && (
        <div className={`fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 px-4 py-3 z-50 transition-all duration-300 ease-out ${
          showSelectionBar 
            ? 'opacity-100 translate-y-0' 
            : 'opacity-0 translate-y-full pointer-events-none'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">
              {selectedRecordings.length} selected
            </span>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleBulkDownload}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium"
              >
                Download
              </button>
              <button
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
