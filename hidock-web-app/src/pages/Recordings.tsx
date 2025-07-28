import React, { useState } from 'react';
import { Music, Download, Play, Trash2, FileText, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { AudioPlayer } from '@/components/AudioPlayer';
import { formatBytes, formatDuration, formatDate } from '@/utils/formatters';
import type { AudioRecording } from '@/types';

export const Recordings: React.FC = () => {
  const { 
    recordings, 
    selectedRecordings, 
    toggleRecordingSelection, 
    setSelectedRecordings,
    updateRecording
  } = useAppStore();
  
  const [playingRecording, setPlayingRecording] = useState<AudioRecording | null>(null);

  const handleSelectAll = () => {
    if (selectedRecordings.length === recordings.length) {
      setSelectedRecordings([]);
    } else {
      setSelectedRecordings(recordings.map(r => r.id));
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

  const handlePlayRecording = (recording: AudioRecording) => {
    if (playingRecording?.id === recording.id) {
      setPlayingRecording(null);
    } else {
      setPlayingRecording(recording);
      updateRecording(recording.id, { status: 'playing' });
    }
  };

  const handleRecordingEnded = () => {
    if (playingRecording) {
      updateRecording(playingRecording.id, { status: 'downloaded' });
      setPlayingRecording(null);
    }
  };

  const getMockAudioUrl = (recording: AudioRecording): string => {
    // In a real app, this would be the actual audio file URL
    // For now, we'll use a placeholder or generate a mock URL
    return `data:audio/wav;base64,${btoa('mock-audio-data-' + recording.id)}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Recordings</h1>
          <p className="text-slate-400">
            Manage your HiDock audio recordings
          </p>
        </div>
        
        <div className="flex items-center space-x-3">
          <button
            onClick={handleSelectAll}
            className="btn-secondary"
          >
            {selectedRecordings.length === recordings.length ? 'Deselect All' : 'Select All'}
          </button>
          
          {selectedRecordings.length > 0 && (
            <>
              <button className="btn-primary flex items-center space-x-2">
                <Download className="w-4 h-4" />
                <span>Download ({selectedRecordings.length})</span>
              </button>
              
              <button className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg flex items-center space-x-2">
                <Trash2 className="w-4 h-4" />
                <span>Delete ({selectedRecordings.length})</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Recordings List */}
      <div className="card">
        {recordings.length === 0 ? (
          <div className="p-12 text-center">
            <Music className="w-16 h-16 text-slate-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-100 mb-2">No Recordings Found</h3>
            <p className="text-slate-400">
              Connect your HiDock device to see your recordings here.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden">
            {/* Table Header */}
            <div className="bg-slate-700/50 px-6 py-3 border-b border-slate-600">
              <div className="grid grid-cols-12 gap-4 items-center text-sm font-medium text-slate-300">
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    checked={selectedRecordings.length === recordings.length && recordings.length > 0}
                    onChange={handleSelectAll}
                    className="rounded border-slate-500 bg-slate-700 text-primary-600 focus:ring-primary-500"
                  />
                </div>
                <div className="col-span-4">Name</div>
                <div className="col-span-2">Duration</div>
                <div className="col-span-2">Size</div>
                <div className="col-span-2">Date</div>
                <div className="col-span-1">Status</div>
              </div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-slate-700">
              {recordings.map((recording) => (
                <div
                  key={recording.id}
                  className={`px-6 py-4 hover:bg-slate-700/30 transition-colors ${
                    selectedRecordings.includes(recording.id) ? 'bg-primary-600/10' : ''
                  }`}
                >
                  <div className="grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-1">
                      <input
                        type="checkbox"
                        checked={selectedRecordings.includes(recording.id)}
                        onChange={() => toggleRecordingSelection(recording.id)}
                        className="rounded border-slate-500 bg-slate-700 text-primary-600 focus:ring-primary-500"
                      />
                    </div>
                    
                    <div className="col-span-4">
                      <div className="flex items-center space-x-3">
                        <Music className="w-4 h-4 text-primary-400 flex-shrink-0" />
                        <div>
                          <p className="text-slate-100 font-medium">{recording.fileName}</p>
                          {recording.transcription && (
                            <p className="text-slate-400 text-sm flex items-center space-x-1">
                              <FileText className="w-3 h-3" />
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
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(recording.status)}`}>
                        {recording.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="mt-3 flex items-center space-x-2">
                    <button 
                      onClick={() => handlePlayRecording(recording)}
                      className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200"
                      title="Play/Stop"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <button 
                      className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    {recording.transcription && (
                      <button 
                        className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200"
                        title="View Transcription"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                    )}
                    <button 
                      className="p-1 hover:bg-slate-600 rounded text-red-400 hover:text-red-300"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Audio Player Modal */}
      {playingRecording && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-100">Now Playing</h3>
              <button
                onClick={() => setPlayingRecording(null)}
                className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <AudioPlayer
              src={getMockAudioUrl(playingRecording)}
              title={playingRecording.fileName}
              onEnded={handleRecordingEnded}
              onPause={() => updateRecording(playingRecording.id, { status: 'downloaded' })}
            />
          </div>
        </div>
      )}
    </div>
  );
};