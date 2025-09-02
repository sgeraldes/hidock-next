import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Music,
  MessageSquare,
  Settings,
  Usb,
  RefreshCw,
  Menu,
  X
} from 'lucide-react';
import { useDeviceConnection } from '@/hooks/useDeviceConnection';

const navigationItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/recordings', icon: Music, label: 'Recordings' },
  { to: '/transcription', icon: MessageSquare, label: 'Transcription' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export const Sidebar: React.FC = () => {
  const {
    isDeviceConnected,
    connectDevice,
    disconnectDevice,
    refreshRecordings
  } = useDeviceConnection();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isLargeScreen, setIsLargeScreen] = useState(false);

  // Detect screen size
  useEffect(() => {
    const checkScreenSize = () => {
      setIsLargeScreen(window.innerWidth >= 1280);
      // Close expanded sidebar when resizing to large screen
      if (window.innerWidth >= 1280) {
        setIsExpanded(false);
      }
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Close sidebar when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const sidebar = document.getElementById('expandable-sidebar');
      const hamburger = document.getElementById('sidebar-hamburger');
      if (isExpanded && sidebar && !sidebar.contains(e.target as Node) && 
          hamburger && !hamburger.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded]);

  // Icon-only sidebar for medium screens (768-1280px)
  const iconOnlySidebar = (
    <aside className="hidden md:flex xl:hidden fixed left-0 top-16 h-[calc(100vh-4rem)] w-16 bg-slate-800 border-r border-slate-700 flex-col z-30 overflow-hidden">
      {/* Hamburger Menu Button */}
      <button
        id="sidebar-hamburger"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 hover:bg-slate-700 transition-colors flex justify-center"
        title="Expand Menu"
      >
        <Menu className="w-5 h-5 text-slate-300" />
      </button>

      {/* Navigation Icons */}
      <nav className="flex-1 pt-2 px-3 pb-4 overflow-y-auto">
        <ul className="space-y-2">
          {navigationItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center justify-center p-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary-600 text-white'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`
                }
                title={item.label}
              >
                <item.icon className="w-5 h-5" />
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Device Controls Icons */}
      <div className="p-3 border-t border-slate-700 space-y-2">
        <button
          onClick={isDeviceConnected ? disconnectDevice : connectDevice}
          className={`w-full p-2 rounded-lg transition-colors flex justify-center ${
            isDeviceConnected
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-primary-600 hover:bg-primary-700 text-white'
          }`}
          title={isDeviceConnected ? 'Disconnect' : 'Connect Device'}
        >
          <Usb className="w-4 h-4" />
        </button>

        {isDeviceConnected && (
          <button
            onClick={refreshRecordings}
            className="w-full p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors flex justify-center"
            title="Refresh Recordings"
          >
            <RefreshCw className="w-4 h-4 text-slate-300" />
          </button>
        )}
      </div>
    </aside>
  );

  // Full sidebar for large screens (1280px+)
  const fullSidebar = (
    <aside className="hidden xl:flex fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 bg-slate-800 border-r border-slate-700 flex-col z-30 overflow-hidden">
      {/* Navigation */}
      <nav className="flex-1 pt-6 px-4 pb-4 overflow-y-auto">
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

          {isDeviceConnected && (
            <button
              onClick={refreshRecordings}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              title="Refresh Recordings"
            >
              <RefreshCw className="w-4 h-4 text-slate-300" />
              <span className="text-slate-300 text-sm">Refresh</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );

  // Expandable overlay sidebar for medium screens
  const expandedOverlay = isExpanded && !isLargeScreen && (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-[45] md:block xl:hidden"
        onClick={() => setIsExpanded(false)}
      />
      
      {/* Expanded Sidebar */}
      <aside 
        id="expandable-sidebar"
        className={`fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 bg-slate-800 border-r border-slate-700 flex flex-col z-50 overflow-hidden transition-transform duration-300 ease-out md:block xl:hidden ${
          isExpanded ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Close Button */}
        <div className="flex justify-between items-center p-4 border-b border-slate-700">
          <span className="text-slate-100 font-semibold">Menu</span>
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1 hover:bg-slate-700 rounded transition-colors"
          >
            <X className="w-5 h-5 text-slate-300" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 pt-4 px-4 pb-4 overflow-y-auto">
          <ul className="space-y-2">
            {navigationItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={() => setIsExpanded(false)}
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
            <button
              onClick={() => {
                isDeviceConnected ? disconnectDevice() : connectDevice();
                setIsExpanded(false);
              }}
              className={`w-full flex items-center justify-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                isDeviceConnected
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-primary-600 hover:bg-primary-700 text-white'
              }`}
            >
              <Usb className="w-4 h-4" />
              <span>{isDeviceConnected ? 'Disconnect' : 'Connect Device'}</span>
            </button>

            {isDeviceConnected && (
              <button
                onClick={() => {
                  refreshRecordings();
                  setIsExpanded(false);
                }}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                title="Refresh Recordings"
              >
                <RefreshCw className="w-4 h-4 text-slate-300" />
                <span className="text-slate-300 text-sm">Refresh</span>
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );

  return (
    <>
      {iconOnlySidebar}
      {fullSidebar}
      {expandedOverlay}
    </>
  );
};