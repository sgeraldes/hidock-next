import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Music, 
  MessageSquare, 
  Settings,
  Usb,
  Download,
  Trash2,
  RefreshCw
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useDeviceConnection } from '@/hooks/useDeviceConnection';

const navigationItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/recordings', icon: Music, label: 'Recordings' },
  { to: '/transcription', icon: MessageSquare, label: 'Transcription' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export const Sidebar: React.FC = () => {
  const { selectedRecordings } = useAppStore();
  const { 
    isDeviceConnected, 
    connectDevice, 
    disconnectDevice, 
    refreshRecordings 
  } = useDeviceConnection();

  return (
    <aside className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {navigationItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary-600 text-white'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`
                }
              >
                <item.icon className="w-5 h-5" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Device Controls */}
      <div className="p-4 border-t border-slate-700">
        <div className="space-y-3">
          {/* Connect/Disconnect Button */}
          <button
            onClick={isDeviceConnected ? disconnectDevice : connectDevice}
            className={`w-full flex items-center justify-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              isDeviceConnected
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-primary-600 hover:bg-primary-700 text-white'
            }`}
          >
            <Usb className="w-4 h-4" />
            <span>{isDeviceConnected ? 'Disconnect' : 'Connect Device'}</span>
          </button>

          {/* Quick Actions */}
          {isDeviceConnected && (
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={refreshRecordings}
                className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4 text-slate-300" />
              </button>
              
              <button
                className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                title="Download Selected"
                disabled={selectedRecordings.length === 0}
              >
                <Download className="w-4 h-4 text-slate-300" />
              </button>
              
              <button
                className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                title="Delete Selected"
                disabled={selectedRecordings.length === 0}
              >
                <Trash2 className="w-4 h-4 text-slate-300" />
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};