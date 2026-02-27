interface TranslationToggleProps {
  enabled: boolean;
  targetLanguage: string;
  onToggle: (enabled: boolean) => void;
  onLanguageChange: (language: string) => void;
}

const LANGUAGES = [
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "ru", label: "Russian" },
  { code: "it", label: "Italian" },
];

export default function TranslationToggle({
  enabled,
  targetLanguage,
  onToggle,
  onLanguageChange,
}: TranslationToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded"
        />
        Translate
      </label>
      {enabled && (
        <select
          value={targetLanguage}
          onChange={(e) => onLanguageChange(e.target.value)}
          className="rounded border border-input bg-card px-1 py-0.5 text-xs text-card-foreground"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
