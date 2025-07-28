import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { 
  AppState, 
  AppSettings, 
  HiDockDevice, 
  AudioRecording 
} from '@/types';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '@/constants';
import { mockRecordings } from '@/utils/mockData';

interface AppStore extends AppState {
  // Device state
  device: HiDockDevice | null;
  recordings: AudioRecording[];
  
  // Settings
  settings: AppSettings;
  
  // Actions
  setCurrentView: (view: AppState['currentView']) => void;
  setSelectedRecordings: (ids: string[]) => void;
  toggleRecordingSelection: (id: string) => void;
  setDevice: (device: HiDockDevice | null) => void;
  setRecordings: (recordings: AudioRecording[]) => void;
  updateRecording: (id: string, updates: Partial<AudioRecording>) => void;
  addRecording: (recording: AudioRecording) => void;
  removeRecording: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  resetApp: () => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // Initial state
      currentView: 'dashboard',
      selectedRecordings: [],
      isDeviceConnected: false,
      isLoading: false,
      error: null,
      device: null,
      recordings: mockRecordings, // Start with mock data for demonstration
      settings: DEFAULT_SETTINGS,

      // Actions
      setCurrentView: (view) => set({ currentView: view }),
      
      setSelectedRecordings: (ids) => set({ selectedRecordings: ids }),
      
      toggleRecordingSelection: (id) => set((state) => ({
        selectedRecordings: state.selectedRecordings.includes(id)
          ? state.selectedRecordings.filter(recordingId => recordingId !== id)
          : [...state.selectedRecordings, id]
      })),
      
      setDevice: (device) => set({ 
        device, 
        isDeviceConnected: device !== null 
      }),
      
      setRecordings: (recordings) => set({ recordings }),
      
      updateRecording: (id, updates) => set((state) => ({
        recordings: state.recordings.map(recording =>
          recording.id === id ? { ...recording, ...updates } : recording
        )
      })),
      
      addRecording: (recording) => set((state) => ({
        recordings: [...state.recordings, recording]
      })),
      
      removeRecording: (id) => set((state) => ({
        recordings: state.recordings.filter(recording => recording.id !== id),
        selectedRecordings: state.selectedRecordings.filter(recordingId => recordingId !== id)
      })),
      
      setLoading: (loading) => set({ isLoading: loading }),
      
      setError: (error) => set({ error }),
      
      updateSettings: (newSettings) => set((state) => ({
        settings: { ...state.settings, ...newSettings }
      })),
      
      resetApp: () => set({
        currentView: 'dashboard',
        selectedRecordings: [],
        isDeviceConnected: false,
        isLoading: false,
        error: null,
        device: null,
        recordings: [],
      }),
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      partialize: (state) => ({
        settings: state.settings,
        recordings: state.recordings,
      }),
    }
  )
);