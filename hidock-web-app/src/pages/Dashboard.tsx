import React from 'react';
import { 
  Headphones, 
  Music, 
  MessageSquare, 
  HardDrive,
  TrendingUp,
  Clock,
  Download
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { formatBytes, formatDuration } from '@/utils/formatters';

export const Dashboard: React.FC = () => {
  const { device, recordings, isDeviceConnected } = useAppStore();

  const stats = {
    totalRecordings: recordings.length,
    totalDuration: recordings.reduce((acc, rec) => acc + rec.duration, 0),
    downloadedCount: recordings.filter(rec => rec.status === 'downloaded').length,
    transcribedCount: recordings.filter(rec => rec.transcription).length,
  };

  const recentRecordings = recordings
    .sort((a, b) => b.dateCreated.getTime() - a.dateCreated.getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl p-6 text-white">
        <div className="flex items-center space-x-4">
          <div className="bg-white/20 p-3 rounded-lg">
            <Headphones className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Welcome to HiDock Community</h1>
            <p className="text-white/80">
              {isDeviceConnected 
                ? `Connected to ${device?.name || 'HiDock Device'}` 
                : 'Connect your HiDock device to get started'
              }
            </p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Total Recordings</p>
              <p className="text-2xl font-bold text-slate-100">{stats.totalRecordings}</p>
            </div>
            <Music className="w-8 h-8 text-primary-500" />
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Total Duration</p>
              <p className="text-2xl font-bold text-slate-100">{formatDuration(stats.totalDuration)}</p>
            </div>
            <Clock className="w-8 h-8 text-accent-500" />
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Downloaded</p>
              <p className="text-2xl font-bold text-slate-100">{stats.downloadedCount}</p>
            </div>
            <Download className="w-8 h-8 text-secondary-500" />
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Transcribed</p>
              <p className="text-2xl font-bold text-slate-100">{stats.transcribedCount}</p>
            </div>
            <MessageSquare className="w-8 h-8 text-primary-500" />
          </div>
        </div>
      </div>

      {/* Device Status */}
      {device && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-slate-100 mb-4 flex items-center space-x-2">
            <HardDrive className="w-5 h-5" />
            <span>Device Status</span>
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p className="text-slate-400 text-sm">Device Model</p>
              <p className="text-slate-100 font-medium">{device.model}</p>
            </div>
            
            <div>
              <p className="text-slate-400 text-sm">Serial Number</p>
              <p className="text-slate-100 font-medium">{device.serialNumber}</p>
            </div>
            
            <div>
              <p className="text-slate-400 text-sm">Firmware</p>
              <p className="text-slate-100 font-medium">{device.firmwareVersion}</p>
            </div>
          </div>

          {/* Storage Usage */}
          <div className="mt-6">
            <div className="flex justify-between items-center mb-2">
              <p className="text-slate-400 text-sm">Storage Usage</p>
              <p className="text-slate-300 text-sm">
                {formatBytes(device.storageInfo.usedSpace)} / {formatBytes(device.storageInfo.totalCapacity)}
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
        </div>
      )}

      {/* Recent Recordings */}
      {recentRecordings.length > 0 && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-slate-100 mb-4 flex items-center space-x-2">
            <TrendingUp className="w-5 h-5" />
            <span>Recent Recordings</span>
          </h2>
          
          <div className="space-y-3">
            {recentRecordings.map((recording) => (
              <div 
                key={recording.id}
                className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <Music className="w-4 h-4 text-primary-400" />
                  <div>
                    <p className="text-slate-100 font-medium">{recording.fileName}</p>
                    <p className="text-slate-400 text-sm">
                      {formatDuration(recording.duration)} • {recording.dateCreated.toLocaleDateString()}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    recording.status === 'downloaded' 
                      ? 'bg-green-600/20 text-green-400'
                      : recording.status === 'transcribed'
                      ? 'bg-blue-600/20 text-blue-400'
                      : 'bg-slate-600/20 text-slate-400'
                  }`}>
                    {recording.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      {!isDeviceConnected && (
        <div className="card p-6 text-center">
          <Headphones className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-100 mb-2">No Device Connected</h3>
          <p className="text-slate-400 mb-4">
            Connect your HiDock device to start managing your recordings and using AI transcription features.
          </p>
          <button className="btn-primary">
            Connect HiDock Device
          </button>
        </div>
      )}
    </div>
  );
};