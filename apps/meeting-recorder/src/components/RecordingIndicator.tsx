interface RecordingIndicatorProps {
  isRecording: boolean;
}

export function RecordingIndicator({ isRecording }: RecordingIndicatorProps) {
  if (!isRecording) return null;

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      <span className="text-xs font-medium text-red-500 uppercase tracking-wider">
        REC
      </span>
    </div>
  );
}
