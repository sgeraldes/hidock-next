import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Headphones,
  Music,
  MessageSquare,
  HardDrive,
  TrendingUp,
  Clock,
  Download,
  Server,
  Cpu,
  Database
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useDeviceConnection } from '@/hooks/useDeviceConnection';
import { formatDuration, formatBytesToDecimalGB } from '@/utils/formatters';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { device, recordings, isDeviceConnected, setSelectedRecordings } = useAppStore();
  const { connectDevice } = useDeviceConnection();

  const stats = {
    totalRecordings: recordings.length,
    totalDuration: recordings.reduce((acc, rec) => acc + rec.duration, 0),
    downloadedCount: recordings.filter(rec => rec.status === 'downloaded').length,
    transcribedCount: recordings.filter(rec => rec.transcription).length,
  };

  // Navigation handlers
  const navigateToRecordings = (sortBy?: string, filter?: string) => {
    // Store sort/filter preferences in sessionStorage for the Recordings page to read
    if (sortBy) sessionStorage.setItem('recordings-sort', sortBy);
    if (filter) sessionStorage.setItem('recordings-filter', filter);
    navigate('/recordings');
  };

  const navigateToRecordingWithSelection = (recordingId: string) => {
    setSelectedRecordings([recordingId]);
    sessionStorage.setItem('recordings-sort', 'date-desc');
    navigate('/recordings');
  };

  const recentRecordings = recordings
    .sort((a, b) => {
      const dateA = a.dateCreated instanceof Date ? a.dateCreated : new Date(a.dateCreated);
      const dateB = b.dateCreated instanceof Date ? b.dateCreated : new Date(b.dateCreated);
      return dateB.getTime() - dateA.getTime();
    })
    .slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Welcome Header */}
      <div className="bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl p-4 lg:p-5 text-white">
        <div className="flex items-center space-x-3 lg:space-x-4">
          <div className="bg-white/20 p-2 lg:p-3 rounded-lg">
            <Headphones className="w-6 h-6 lg:w-8 lg:h-8" />
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-bold">Welcome to HiDock Community</h1>
            <p className="text-sm lg:text-base text-white/80">
              {isDeviceConnected
                ? `Connected to ${device?.name || 'HiDock Device'}`
                : 'Connect your HiDock device to get started'
              }
            </p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <button 
          onClick={() => navigateToRecordings()}
          className="card p-3 lg:p-4 hover:bg-slate-700/50 transition-colors cursor-pointer text-left"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs lg:text-sm">Total Recordings</p>
              <p className="text-xl lg:text-2xl font-bold text-slate-100">{stats.totalRecordings}</p>
            </div>
            <Music className="w-6 h-6 lg:w-8 lg:h-8 text-primary-500" />
          </div>
        </button>

        <button 
          onClick={() => navigateToRecordings('duration-desc')}
          className="card p-3 lg:p-4 hover:bg-slate-700/50 transition-colors cursor-pointer text-left"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs lg:text-sm">Total Duration</p>
              <p className="text-xl lg:text-2xl font-bold text-slate-100">{formatDuration(stats.totalDuration)}</p>
            </div>
            <Clock className="w-6 h-6 lg:w-8 lg:h-8 text-accent-500" />
          </div>
        </button>

        <button 
          onClick={() => navigateToRecordings(undefined, 'downloaded')}
          className="card p-3 lg:p-4 hover:bg-slate-700/50 transition-colors cursor-pointer text-left"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs lg:text-sm">Downloaded</p>
              <p className="text-xl lg:text-2xl font-bold text-slate-100">{stats.downloadedCount}</p>
            </div>
            <Download className="w-6 h-6 lg:w-8 lg:h-8 text-secondary-500" />
          </div>
        </button>

        <button 
          onClick={() => navigate('/transcription')}
          className="card p-3 lg:p-4 hover:bg-slate-700/50 transition-colors cursor-pointer text-left"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs lg:text-sm">Transcribed</p>
              <p className="text-xl lg:text-2xl font-bold text-slate-100">{stats.transcribedCount}</p>
            </div>
            <MessageSquare className="w-6 h-6 lg:w-8 lg:h-8 text-primary-500" />
          </div>
        </button>
      </div>

      {/* Device Status */}
      {device && (
        <button 
          onClick={() => navigate('/settings')}
          className="card p-4 lg:p-5 hover:bg-slate-700/50 transition-colors cursor-pointer text-left block w-full"
        >
          <h2 className="text-lg lg:text-xl font-semibold text-slate-100 mb-3 lg:mb-4 flex items-center space-x-2">
            <HardDrive className="w-4 h-4 lg:w-5 lg:h-5" />
            <span>Device Status</span>
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 lg:gap-4">
            <div>
              <p className="text-slate-400 text-xs lg:text-sm">Model</p>
              <p className="text-slate-100 text-sm lg:text-base font-medium flex items-center space-x-1">
                <Server className="w-3 h-3 lg:w-4 lg:h-4" />
                <span>{device.model || device.name || 'HiDock Device'}</span>
              </p>
            </div>

            <div>
              <p className="text-slate-400 text-xs lg:text-sm">Serial</p>
              <p className="text-slate-100 text-sm lg:text-base font-medium">{device.serialNumber || 'Unknown'}</p>
            </div>

            <div>
              <p className="text-slate-400 text-xs lg:text-sm">Firmware</p>
              <p className="text-slate-100 text-sm lg:text-base font-medium flex items-center space-x-1">
                <Cpu className="w-3 h-3 lg:w-4 lg:h-4" />
                <span>{device.firmwareVersion || 'Unknown'}</span>
              </p>
            </div>
          </div>

          {/* Storage Information */}
          {device.storageInfo ? (
            <>
              <div className="grid grid-cols-3 gap-3 lg:gap-4 mt-4">
                <div>
                  <p className="text-slate-400 text-xs lg:text-sm">Total Space</p>
                  <p className="text-slate-100 text-sm lg:text-base font-medium flex items-center space-x-1">
                    <Database className="w-3 h-3 lg:w-4 lg:h-4" />
                    <span>{formatBytesToDecimalGB(device.storageInfo.totalCapacity)}</span>
                  </p>
                </div>
                
                <div>
                  <p className="text-slate-400 text-xs lg:text-sm">Used Space</p>
                  <p className="text-slate-100 text-sm lg:text-base font-medium">
                    {formatBytesToDecimalGB(device.storageInfo.usedSpace)}
                  </p>
                </div>
                
                <div>
                  <p className="text-slate-400 text-xs lg:text-sm">Free Space</p>
                  <p className="text-green-400 text-sm lg:text-base font-medium">
                    {formatBytesToDecimalGB(device.storageInfo.totalCapacity - device.storageInfo.usedSpace)}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-slate-400 text-xs lg:text-sm">Storage Usage</p>
                  <p className="text-slate-300 text-xs lg:text-sm">
                    {Math.round((device.storageInfo.usedSpace / device.storageInfo.totalCapacity) * 100)}%
                  </p>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-2">
                  <div
                    className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${(device.storageInfo.usedSpace / device.storageInfo.totalCapacity) * 100}%`
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="mt-4 p-3 bg-slate-700/30 rounded-lg">
              <p className="text-slate-400 text-xs lg:text-sm">Storage information not available</p>
              <p className="text-slate-500 text-xs mt-1">Connect to device to view storage details</p>
            </div>
          )}
        </button>
      )}

      {/* Recent Recordings */}
      {recentRecordings.length > 0 && (
        <div className="card p-4 lg:p-5">
          <h2 className="text-lg lg:text-xl font-semibold text-slate-100 mb-3 lg:mb-4 flex items-center space-x-2">
            <TrendingUp className="w-4 h-4 lg:w-5 lg:h-5" />
            <span>Recent Recordings</span>
          </h2>

          <div className="space-y-2 lg:space-y-3">
            {recentRecordings.slice(0, 4).map((recording) => (
              <button
                key={recording.id}
                onClick={() => navigateToRecordingWithSelection(recording.id)}
                className="w-full flex items-center justify-between p-2 lg:p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors text-left"
              >
                <div className="flex items-center space-x-2 lg:space-x-3 min-w-0">
                  <Music className="w-3 h-3 lg:w-4 lg:h-4 text-primary-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-100 text-sm lg:text-base font-medium truncate">{recording.fileName}</p>
                    <p className="text-slate-400 text-xs lg:text-sm">
                      {formatDuration(recording.duration)} • {(recording.dateCreated instanceof Date ? recording.dateCreated : new Date(recording.dateCreated)).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2 flex-shrink-0">
                  <span className={`px-1.5 lg:px-2 py-0.5 lg:py-1 rounded-full text-xs font-medium ${
                    recording.status === 'downloaded'
                      ? 'bg-green-600/20 text-green-400'
                      : recording.status === 'transcribed'
                      ? 'bg-blue-600/20 text-blue-400'
                      : 'bg-slate-600/20 text-slate-400'
                  }`}>
                    {recording.status.replace('_', ' ')}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      {!isDeviceConnected && (
        <div className="card p-4 lg:p-5 text-center">
          <Headphones className="w-10 h-10 lg:w-12 lg:h-12 text-slate-500 mx-auto mb-3 lg:mb-4" />
          <h3 className="text-base lg:text-lg font-semibold text-slate-100 mb-2">No Device Connected</h3>
          <p className="text-sm lg:text-base text-slate-400 mb-3 lg:mb-4">
            Connect your HiDock device to start managing your recordings and using AI transcription features.
          </p>
          <button onClick={connectDevice} className="btn-primary text-sm lg:text-base">
            Connect HiDock Device
          </button>
        </div>
      )}
    </div>
  );
};
