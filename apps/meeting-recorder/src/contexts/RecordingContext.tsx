import { createContext, useContext } from 'react';

interface RecordingContextType {
  isRecording: boolean;
  elapsedTime: number;
  micActive: boolean;
  autoRecord: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onToggleAutoRecord: () => void;
}

const RecordingContext = createContext<RecordingContextType | null>(null);

export function useRecordingContext() {
  const context = useContext(RecordingContext);
  return context; // Returns null if not in Dashboard
}

export const RecordingProvider = RecordingContext.Provider;
