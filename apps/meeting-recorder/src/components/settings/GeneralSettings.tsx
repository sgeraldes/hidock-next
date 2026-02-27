
interface GeneralSettingsProps {
  transcriptionLanguage: string;
  translationLanguage: string;
  theme: "light" | "dark" | "system";
  startMinimized: boolean;
  closeToTray: boolean;
  onFieldChange: (key: string, value: string | boolean) => void;
}

const LANGUAGES = [
  { value: "en", label: "English", flag: "🇺🇸" },
  { value: "es", label: "Spanish", flag: "🇪🇸" },
  { value: "fr", label: "French", flag: "🇫🇷" },
  { value: "de", label: "German", flag: "🇩🇪" },
  { value: "pt", label: "Portuguese", flag: "🇵🇹" },
  { value: "ja", label: "Japanese", flag: "🇯🇵" },
  { value: "ko", label: "Korean", flag: "🇰🇷" },
  { value: "zh", label: "Chinese", flag: "🇨🇳" },
  { value: "ar", label: "Arabic", flag: "🇸🇦" },
  { value: "ru", label: "Russian", flag: "🇷🇺" },
  { value: "it", label: "Italian", flag: "🇮🇹" },
];

export default function GeneralSettings({
  transcriptionLanguage,
  translationLanguage,
  theme,
  startMinimized,
  closeToTray,
  onFieldChange,
}: GeneralSettingsProps) {
  return (
    <div className="space-y-6">
      {/* Language Settings */}
      <div className="space-y-6">

        <div className="py-3">
          <label htmlFor="transcription-lang" className="text-sm font-medium text-foreground block mb-1">
            Transcription language
          </label>
          <p className="text-sm text-muted-foreground mb-3">
            The primary language spoken in your meetings.
          </p>
          <select
            id="transcription-lang"
            value={transcriptionLanguage}
            onChange={(e) => onFieldChange("transcriptionLanguage", e.target.value)}
            className="w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.flag} {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="py-3">
          <label htmlFor="translation-lang" className="text-sm font-medium text-foreground block mb-1">
            Translation language (optional)
          </label>
          <p className="text-sm text-muted-foreground mb-3">
            Translate transcripts to another language in real-time.
          </p>
          <select
            id="translation-lang"
            value={translationLanguage}
            onChange={(e) => onFieldChange("translationLanguage", e.target.value)}
            className="w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.flag} {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="py-3">
          <label htmlFor="theme-select" className="text-sm font-medium text-foreground block mb-1">
            Theme
          </label>
          <p className="text-sm text-muted-foreground mb-3">
            Choose your preferred color scheme.
          </p>
          <select
            id="theme-select"
            value={theme}
            onChange={(e) => onFieldChange("theme", e.target.value)}
            className="w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="system">🖥️ System</option>
            <option value="light">☀️ Light</option>
            <option value="dark">🌙 Dark</option>
          </select>
        </div>

        <div className="py-3">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <label htmlFor="start-minimized" className="text-sm font-medium text-foreground block mb-1">
                Start minimized to tray
              </label>
              <p className="text-sm text-muted-foreground">
                Launch in the system tray without showing the main window.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
              <input
                id="start-minimized"
                type="checkbox"
                checked={startMinimized}
                onChange={(e) => onFieldChange("startMinimized", e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>
        </div>

        <div className="py-3">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <label htmlFor="close-to-tray" className="text-sm font-medium text-foreground block mb-1">
                Close to tray
              </label>
              <p className="text-sm text-muted-foreground">
                Minimize to tray instead of quitting. Keeps auto-record running.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
              <input
                id="close-to-tray"
                type="checkbox"
                checked={closeToTray}
                onChange={(e) => onFieldChange("closeToTray", e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
