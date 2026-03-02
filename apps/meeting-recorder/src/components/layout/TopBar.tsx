import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy, Mic, Menu } from 'lucide-react';
import { useRecordingContext } from '../../contexts/RecordingContext';

interface TopBarProps {
  onToggleSidebar: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function TopBar({ onToggleSidebar }: TopBarProps) {
  const recordingContext = useRecordingContext();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Check initial maximized state
    window.electronAPI.window.isMaximized().then(setIsMaximized);
  }, []);

  const handleMinimize = () => {
    window.electronAPI.window.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI.window.maximize();
    setIsMaximized(!isMaximized);
  };

  const handleClose = () => {
    window.electronAPI.window.close();
  };

  return (
    <div
      className="h-8 bg-background flex items-center justify-between select-none relative"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left Side - Hamburger and Title */}
      <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="w-12 flex items-center justify-center">
          <button
            onClick={onToggleSidebar}
            className="w-6 h-6 flex items-center justify-center hover:bg-accent rounded transition-colors text-foreground"
            title="Toggle sidebar"
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>
        <span className="text-sm font-medium text-foreground">
          Meeting Recorder
        </span>
      </div>

      {/* Center - Recording Controls */}
      {recordingContext && (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Record/Stop Button */}
          {recordingContext.isRecording ? (
            <button
              onClick={recordingContext.onStopRecording}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                <rect x="1" y="1" width="6" height="6" rx="0.5" />
              </svg>
              Stop
            </button>
          ) : (
            <button
              onClick={() => {
                console.log('[TopBar] Record button clicked!');
                console.log('[TopBar] recordingContext:', recordingContext);
                recordingContext.onStartRecording();
              }}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
            >
              <Mic className="w-3 h-3" />
              Record
            </button>
          )}

          {/* Elapsed Time */}
          {recordingContext.isRecording && (
            <span className="text-xs font-mono tabular-nums text-foreground">
              {formatTime(recordingContext.elapsedTime)}
            </span>
          )}

          {/* Mic Indicator */}
          <div
            className={`w-2 h-2 rounded-full ${recordingContext.micActive ? "bg-green-500" : "bg-muted-foreground/30"}`}
            title={recordingContext.micActive ? "Mic active" : "Mic inactive"}
          />

          {/* Auto-record Toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <span className="text-xs text-muted-foreground">Auto-record</span>
            <button
              onClick={recordingContext.onToggleAutoRecord}
              className={`relative w-7 h-3.5 rounded-full transition-colors ${recordingContext.autoRecord ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"}`}
              role="switch"
              aria-checked={recordingContext.autoRecord}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${recordingContext.autoRecord ? "translate-x-3.5" : ""}`}
              />
            </button>
          </label>
        </div>
      )}

      {/* Right Side - Window Controls */}
      <div
        className="flex items-center -mr-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleMinimize}
          className="w-11 h-8 flex items-center justify-center hover:bg-accent transition-colors text-foreground"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-11 h-8 flex items-center justify-center hover:bg-accent transition-colors text-foreground"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
        </button>
        <button
          onClick={handleClose}
          className="w-11 h-8 flex items-center justify-center hover:bg-red-500 transition-colors text-foreground hover:text-white"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
// HMR trigger
