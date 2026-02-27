
interface RecordingSettingsProps {
  autoRecord: boolean;
  pollInterval: number;
  gracePeriod: number;
  chunkInterval: number;
  onFieldChange: (key: string, value: string | number | boolean) => void;
}

export default function RecordingSettings({
  autoRecord,
  pollInterval,
  gracePeriod,
  chunkInterval,
  onFieldChange,
}: RecordingSettingsProps) {
  return (
    <div className="space-y-6">
      {/* Auto-Record Toggle */}
      <div className="flex items-start justify-between py-3">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-foreground mb-1">Auto-Record</h3>
          <p className="text-sm text-muted-foreground">
            Automatically start recording when microphone activity is detected.
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-6">
          <input
            type="checkbox"
            checked={autoRecord}
            onChange={(e) => onFieldChange("autoRecord", e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Detection Settings */}
      <div className="space-y-6">
        {/* Poll Interval */}
        <div className="py-3">
          <label htmlFor="poll-interval" className="text-sm font-medium text-foreground block mb-1">
            Microphone poll interval
          </label>
          <p className="text-sm text-muted-foreground mb-4">
            How often the app checks for microphone activity.
          </p>
          <div className="flex items-center gap-3">
            <input
              id="poll-interval"
              type="range"
              min={1}
              max={10}
              step={1}
              value={pollInterval}
              onChange={(e) => onFieldChange("pollInterval", parseInt(e.target.value, 10))}
              className="flex-1 h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
            />
            <span className="text-sm font-medium text-foreground min-w-[64px] text-right">
              {pollInterval} seconds
            </span>
          </div>
        </div>

        {/* Grace Period */}
        <div className="py-3">
          <label htmlFor="grace-period" className="text-sm font-medium text-foreground block mb-1">
            Grace period
          </label>
          <p className="text-sm text-muted-foreground mb-4">
            Wait time after audio stops before ending the recording.
          </p>
          <div className="flex items-center gap-3">
            <input
              id="grace-period"
              type="range"
              min={5}
              max={60}
              step={5}
              value={gracePeriod}
              onChange={(e) => onFieldChange("gracePeriod", parseInt(e.target.value, 10))}
              className="flex-1 h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
            />
            <span className="text-sm font-medium text-foreground min-w-[64px] text-right">
              {gracePeriod} seconds
            </span>
          </div>
        </div>

        {/* Chunk Interval */}
        <div className="py-3">
          <label htmlFor="chunk-interval" className="text-sm font-medium text-foreground block mb-1">
            Transcription chunk size
          </label>
          <p className="text-sm text-muted-foreground mb-4">
            How often audio is sent to AI for transcription.
          </p>
          <div className="flex items-center gap-3">
            <input
              id="chunk-interval"
              type="range"
              min={10}
              max={30}
              step={5}
              value={chunkInterval}
              onChange={(e) => onFieldChange("chunkInterval", parseInt(e.target.value, 10))}
              className="flex-1 h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
            />
            <span className="text-sm font-medium text-foreground min-w-[64px] text-right">
              {chunkInterval} seconds
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
