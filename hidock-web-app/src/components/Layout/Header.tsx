import React from 'react';
import { 
  Headphones, 
  Wifi, 
  WifiOff, 
  Settings, 
  HardDrive,
  Clock
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { formatBytes, formatDuration } from '@/utils/formatters';

export const Header: React.FC = () => {
  const { device, isDeviceConnected, recordings, selectedRecordings } = useAppStore();

  const selectedCount = selectedRecordings.length;
  const totalRecordings = recordings.length;

  return (
    <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Logo and Title */}
        <div className="flex items-center space-x-3">
          <div className="bg-primary-600 p-2 rounded-lg">
            <Headphones className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">HiDock Community</h1>
            <p className="text-sm text-slate-400">Audio Management & AI Transcription</p>
          </div>
        </div>

        {/* Device Status and Info */}
        <div className="flex items-center space-x-6">
          {/* Connection Status */}
          <div className="flex items-center space-x-2">
            {isDeviceConnected ? (
              <>
                <Wifi className="w-5 h-5 text-green-400" />
                <span className="text-sm text-green-400">Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-5 h-5 text-red-400" />
                <span className="text-sm text-red-400">Disconnected</span>
              </>
            )}
          </div>

          {/* Device Info */}
          {device && (
            <>
              <div className="flex items-center space-x-2 text-sm text-slate-300">
                <HardDrive className="w-4 h-4" />
                <span>
                  {formatBytes(device.storageInfo.usedSpace)} / {formatBytes(device.storageInfo.totalCapacity)}
                </span>
              </div>
              
              <div className="flex items-center space-x-2 text-sm text-slate-300">
                <Clock className="w-4 h-4" />
                <span>{device.storageInfo.fileCount} files</span>
              </div>
            </>
          )}

          {/* Selection Info */}
          {selectedCount > 0 && (
            <div className="bg-primary-600/20 px-3 py-1 rounded-full">
              <span className="text-sm text-primary-300">
                {selectedCount} of {totalRecordings} selected
              </span>
            </div>
          )}

          {/* Settings Button */}
          <button
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
            title="Settings"
          >
            <Settings className="w-5 h-5 text-slate-400" />
          </button>
        </div>
      </div>
    </header>
  );
};