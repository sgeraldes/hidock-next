import React, { useState } from 'react';
import { 
  Settings as SettingsIcon, 
  Key, 
  Palette, 
  Download, 
  Bell,
  Save,
  Eye,
  EyeOff
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { geminiService } from '@/services/geminiService';

export const Settings: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  const [showApiKey, setShowApiKey] = useState(false);
  const [tempSettings, setTempSettings] = useState(settings);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    updateSettings(tempSettings);
    
    // Reinitialize Gemini service if API key changed
    if (tempSettings.geminiApiKey !== settings.geminiApiKey) {
      try {
        if (tempSettings.geminiApiKey) {
          geminiService.initialize(tempSettings.geminiApiKey);
        }
      } catch (error) {
        console.error('Failed to initialize Gemini service:', error);
      }
    }
    
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setTempSettings(settings);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
        <p className="text-slate-400">
          Configure your HiDock Community app preferences
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* AI Configuration */}
        <div className="card p-6">
          <div className="flex items-center mb-4">
            <Key className="w-5 h-5 text-primary-500 mr-3" />
            <h2 className="text-lg font-semibold text-slate-100">AI Configuration</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Gemini API Key
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={tempSettings.geminiApiKey}
                  onChange={(e) => setTempSettings({ ...tempSettings, geminiApiKey: e.target.value })}
                  placeholder="Enter your Gemini API key"
                  className="input-field w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Get your API key from{' '}
                <a 
                  href="https://makersuite.google.com/app/apikey" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary-400 hover:text-primary-300"
                >
                  Google AI Studio
                </a>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Transcription Language
              </label>
              <select
                value={tempSettings.transcriptionLanguage}
                onChange={(e) => setTempSettings({ ...tempSettings, transcriptionLanguage: e.target.value })}
                className="input-field w-full"
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="it">Italian</option>
                <option value="pt">Portuguese</option>
                <option value="auto">Auto-detect</option>
              </select>
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="card p-6">
          <div className="flex items-center mb-4">
            <Palette className="w-5 h-5 text-secondary-500 mr-3" />
            <h2 className="text-lg font-semibold text-slate-100">Appearance</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Theme
              </label>
              <select
                value={tempSettings.theme}
                onChange={(e) => setTempSettings({ ...tempSettings, theme: e.target.value as any })}
                className="input-field w-full"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>
          </div>
        </div>

        {/* Download Settings */}
        <div className="card p-6">
          <div className="flex items-center mb-4">
            <Download className="w-5 h-5 text-accent-500 mr-3" />
            <h2 className="text-lg font-semibold text-slate-100">Download Settings</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Download Directory
              </label>
              <input
                type="text"
                value={tempSettings.downloadDirectory}
                onChange={(e) => setTempSettings({ ...tempSettings, downloadDirectory: e.target.value })}
                placeholder="Downloads/HiDock"
                className="input-field w-full"
              />
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="autoDownload"
                checked={tempSettings.autoDownload}
                onChange={(e) => setTempSettings({ ...tempSettings, autoDownload: e.target.checked })}
                className="rounded border-slate-500 bg-slate-700 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="autoDownload" className="text-sm text-slate-300">
                Auto-download new recordings
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Audio Quality
              </label>
              <select
                value={tempSettings.audioQuality}
                onChange={(e) => setTempSettings({ ...tempSettings, audioQuality: e.target.value as any })}
                className="input-field w-full"
              >
                <option value="low">Low (Faster)</option>
                <option value="medium">Medium (Balanced)</option>
                <option value="high">High (Best Quality)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="card p-6">
          <div className="flex items-center mb-4">
            <Bell className="w-5 h-5 text-primary-500 mr-3" />
            <h2 className="text-lg font-semibold text-slate-100">Notifications</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="notifications"
                checked={tempSettings.notifications}
                onChange={(e) => setTempSettings({ ...tempSettings, notifications: e.target.checked })}
                className="rounded border-slate-500 bg-slate-700 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="notifications" className="text-sm text-slate-300">
                Enable notifications
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Device Information */}
      <div className="card p-6">
        <div className="flex items-center mb-4">
          <SettingsIcon className="w-5 h-5 text-slate-400 mr-3" />
          <h2 className="text-lg font-semibold text-slate-100">Device Information</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-slate-400">Browser</p>
            <p className="text-slate-100">{navigator.userAgent.split(' ')[0]}</p>
          </div>
          <div>
            <p className="text-slate-400">WebUSB Support</p>
            <p className="text-slate-100">{navigator.usb ? 'Yes' : 'No'}</p>
          </div>
          <div>
            <p className="text-slate-400">App Version</p>
            <p className="text-slate-100">1.0.0</p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleReset}
          className="btn-secondary"
        >
          Reset Changes
        </button>

        <button
          onClick={handleSave}
          className={`btn-primary flex items-center space-x-2 ${
            saved ? 'bg-green-600 hover:bg-green-700' : ''
          }`}
        >
          <Save className="w-4 h-4" />
          <span>{saved ? 'Saved!' : 'Save Settings'}</span>
        </button>
      </div>
    </div>
  );
};