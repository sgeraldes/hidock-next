import React, { useState } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import {
  Headphones,
  Wifi,
  WifiOff,
  Settings,
  HardDrive,
  Clock,
  Menu,
  X,
  LayoutDashboard,
  Music,
  MessageSquare
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { formatDuration as _formatDuration, formatBytesToDecimalGB } from '@/utils/formatters'; // _formatDuration: Future use - duration display

export const Header: React.FC = () => {
  const { device, isDeviceConnected, recordings, selectedRecordings } = useAppStore();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const selectedCount = selectedRecordings.length;
  const totalRecordings = recordings.length;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-slate-800 border-b border-slate-700 px-3 sm:px-6 py-3 sm:py-4">
      <div className="flex items-center justify-between">
        {/* Logo and Title */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Mobile Menu Button - Only show on small screens */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 hover:bg-slate-700 rounded-lg transition-colors"
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5 text-slate-300" />
            ) : (
              <Menu className="w-5 h-5 text-slate-300" />
            )}
          </button>
          
          <div className="bg-primary-600 p-1.5 sm:p-2 rounded-lg">
            <Headphones className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-100">HiDock Community</h1>
            <p className="text-xs sm:text-sm text-slate-400 hidden sm:block">Audio Management & AI Transcription</p>
          </div>
        </div>

        {/* Device Status and Info */}
        <div className="flex items-center space-x-2 sm:space-x-4 lg:space-x-6">
          {/* Connection Status */}
          <div className="flex items-center space-x-1 sm:space-x-2">
            {isDeviceConnected ? (
              <>
                <Wifi className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />
                <span className="text-xs sm:text-sm text-green-400 hidden sm:inline">Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 sm:w-5 sm:h-5 text-red-400" />
                <span className="text-xs sm:text-sm text-red-400 hidden sm:inline">Disconnected</span>
              </>
            )}
          </div>

          {/* Device Info - Hidden on mobile */}
          {device && device.storageInfo && (
            <>
              <div className="hidden md:flex items-center space-x-2 text-sm text-slate-300">
                <HardDrive className="w-4 h-4" />
                <span>
                  {formatBytesToDecimalGB(device.storageInfo.usedSpace)} / {formatBytesToDecimalGB(device.storageInfo.totalCapacity)}
                </span>
              </div>

              <div className="hidden lg:flex items-center space-x-2 text-sm text-slate-300">
                <Clock className="w-4 h-4" />
                <span>{device.storageInfo.fileCount} files</span>
              </div>
            </>
          )}

          {/* Selection Info - Hidden on mobile */}
          {selectedCount > 0 && (
            <div className="hidden sm:block bg-primary-600/20 px-2 sm:px-3 py-1 rounded-full">
              <span className="text-xs sm:text-sm text-primary-300">
                {selectedCount} of {totalRecordings} selected
              </span>
            </div>
          )}

          {/* Settings Button */}
          <button
            onClick={() => navigate('/settings')}
            className="p-1.5 sm:p-2 hover:bg-slate-700 rounded-lg transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
          </button>
        </div>
      </div>
      
      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-slate-800 border-b border-slate-700 shadow-lg z-40">
          <nav className="p-4">
            <NavLink
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center space-x-3 px-3 py-2 rounded-lg mb-2 transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`
              }
            >
              <LayoutDashboard className="w-5 h-5" />
              <span>Dashboard</span>
            </NavLink>
            <NavLink
              to="/recordings"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center space-x-3 px-3 py-2 rounded-lg mb-2 transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`
              }
            >
              <Music className="w-5 h-5" />
              <span>Recordings</span>
            </NavLink>
            <NavLink
              to="/transcription"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center space-x-3 px-3 py-2 rounded-lg mb-2 transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`
              }
            >
              <MessageSquare className="w-5 h-5" />
              <span>Transcription</span>
            </NavLink>
          </nav>
        </div>
      )}
    </header>
  );
};
