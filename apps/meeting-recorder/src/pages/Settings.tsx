import { useEffect, useState, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Search,
  Brain,
  Cpu,
  Key,
  Globe,
  Mic,
  Clock,
  Hourglass,
  Scissors,
  Languages,
  Palette,
  Minimize2,
  X,
  Calendar
} from "lucide-react";
import { useSettingsStore, type SettingsField } from "../store/useSettingsStore";
import TranscriptionBackendSettings from "../components/settings/TranscriptionBackendSettings";
import { SettingRow } from "../components/settings/SettingRow";

const SETTING_KEY_MAP: Record<string, string> = {
  provider: "ai.provider",
  model: "ai.model.default",
  apiKey: "ai.apiKey",
  ollamaBaseUrl: "ai.ollamaBaseUrl",
  bedrockRegion: "ai.bedrockRegion",
  bedrockAccessKeyId: "ai.bedrockAccessKeyId",
  bedrockSecretAccessKey: "ai.bedrockSecretAccessKey",
  bedrockSessionToken: "ai.bedrockSessionToken",
  autoRecord: "recording.autoRecord",
  pollInterval: "recording.pollInterval",
  gracePeriod: "recording.gracePeriod",
  chunkInterval: "recording.chunkInterval",
  transcriptionLanguage: "general.transcriptionLanguage",
  translationLanguage: "general.translationLanguage",
  theme: "general.theme",
  startMinimized: "general.startMinimized",
  closeToTray: "general.closeToTray",
};

interface MeetingTypeItem {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  prompt_template: string | null;
  is_default: number;
  created_at: string;
}

/** Detect masked values returned from IPC (e.g. "****abcd") to prevent overwriting real keys */
function isMaskedValue(value: string): boolean {
  return value.startsWith("****") || value === "••••••••";
}

/** Sensitive field keys that receive masked values from IPC */
const SENSITIVE_FIELDS = new Set([
  "apiKey",
  "bedrockAccessKeyId",
  "bedrockSecretAccessKey",
  "bedrockSessionToken",
]);

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
}

function ToggleSwitch({ checked, onChange }: ToggleSwitchProps) {
  return (
    <button
      onClick={onChange}
      className={`relative w-10 h-5 rounded-full transition-colors ${checked ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"}`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

export default function Settings() {
  const store = useSettingsStore(
    useShallow((s) => ({
      provider: s.provider,
      model: s.model,
      apiKey: s.apiKey,
      ollamaBaseUrl: s.ollamaBaseUrl,
      bedrockRegion: s.bedrockRegion,
      bedrockAccessKeyId: s.bedrockAccessKeyId,
      bedrockSecretAccessKey: s.bedrockSecretAccessKey,
      bedrockSessionToken: s.bedrockSessionToken,
      autoRecord: s.autoRecord,
      pollInterval: s.pollInterval,
      gracePeriod: s.gracePeriod,
      chunkInterval: s.chunkInterval,
      transcriptionLanguage: s.transcriptionLanguage,
      translationLanguage: s.translationLanguage,
      theme: s.theme,
      startMinimized: s.startMinimized,
      closeToTray: s.closeToTray,
      setField: s.setField,
      loadFromIPC: s.loadFromIPC,
      saveToIPC: s.saveToIPC,
    })),
  );
  const loadFromIPC = store.loadFromIPC;

  const [meetingTypes, setMeetingTypes] = useState<MeetingTypeItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadFromIPC();
    window.electronAPI.meetingType
      .list()
      .then((types) => {
        setMeetingTypes(types as MeetingTypeItem[]);
      })
      .catch(() => {
        /* ignore */
      });
  }, [loadFromIPC]);

  const handleFieldChange = useCallback(
    (key: string, value: string | number | boolean) => {
      // Block saving masked values — they'd overwrite the real encrypted credential
      if (SENSITIVE_FIELDS.has(key) && typeof value === "string" && isMaskedValue(value)) {
        return;
      }
      store.setField(key as SettingsField, value);
      const ipcKey = SETTING_KEY_MAP[key];
      if (ipcKey) {
        store.saveToIPC(ipcKey, String(value));
      }
    },
    [store],
  );

  const handleCreateMeetingType = useCallback(
    async (params: {
      name: string;
      description?: string;
      prompt_template?: string;
    }) => {
      const created = await window.electronAPI.meetingType.create(params);
      const updated = await window.electronAPI.meetingType.list();
      setMeetingTypes(updated as MeetingTypeItem[]);
      return created;
    },
    [],
  );

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Header with Search */}
      <div className="border-b border-border bg-card px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure AI providers, recording behavior, and meeting intelligence
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search for settings"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64 pl-9 pr-3 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">

          {/* General Section */}
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-4">General</h2>

            {/* Appearance & Behavior */}
            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-foreground mb-1">Appearance & behavior</h3>
                <p className="text-sm text-muted-foreground">
                  Customize the look and behavior of Meeting Recorder
                </p>
              </div>

              <div className="space-y-1">
                <SettingRow
                  icon={Palette}
                  label="Theme"
                  description="Choose your color scheme"
                  control={
                    <select
                      value={store.theme}
                      onChange={(e) => handleFieldChange("theme", e.target.value)}
                      className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  }
                />

                <SettingRow
                  icon={Minimize2}
                  label="Start minimized"
                  description="Launch the app minimized to system tray"
                  control={
                    <ToggleSwitch
                      checked={store.startMinimized}
                      onChange={() => handleFieldChange("startMinimized", !store.startMinimized)}
                    />
                  }
                />

                <SettingRow
                  icon={X}
                  label="Close to tray"
                  description="Minimize to tray instead of closing"
                  control={
                    <ToggleSwitch
                      checked={store.closeToTray}
                      onChange={() => handleFieldChange("closeToTray", !store.closeToTray)}
                    />
                  }
                />
              </div>
            </div>
          </div>

          {/* AI Configuration Section */}
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-4">AI Configuration</h2>

            {/* Provider Settings */}
            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-foreground mb-1">Transcription provider</h3>
                <p className="text-sm text-muted-foreground">
                  Configure your AI transcription service
                </p>
              </div>

              <div className="space-y-1">
                <SettingRow
                  icon={Brain}
                  label="AI provider"
                  description="Select the AI service for transcription"
                  control={
                    <select
                      value={store.provider}
                      onChange={(e) => handleFieldChange("provider", e.target.value)}
                      className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="google">Google Gemini</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="bedrock">Amazon Bedrock</option>
                      <option value="ollama">Ollama (Local)</option>
                    </select>
                  }
                />

                <SettingRow
                  icon={Cpu}
                  label="Model"
                  description="AI model to use for transcription"
                  control={
                    <input
                      type="text"
                      value={store.model}
                      onChange={(e) => handleFieldChange("model", e.target.value)}
                      className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="e.g. gemini-2.5-flash"
                    />
                  }
                />

                {store.provider !== "ollama" && (
                  <SettingRow
                    icon={Key}
                    label="API key"
                    description="Your API key (stored securely)"
                    control={
                      <input
                        type="password"
                        value={store.apiKey}
                        onChange={(e) => handleFieldChange("apiKey", e.target.value)}
                        onFocus={(e) => { if (isMaskedValue(e.target.value)) { store.setField("apiKey", ""); } }}
                        className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder={isMaskedValue(store.apiKey) ? "Key configured — click to change" : "Enter API key"}
                      />
                    }
                  />
                )}

                {store.provider === "ollama" && (
                  <SettingRow
                    icon={Globe}
                    label="Ollama base URL"
                    description="Local Ollama server address"
                    control={
                      <input
                        type="text"
                        value={store.ollamaBaseUrl}
                        onChange={(e) => handleFieldChange("ollamaBaseUrl", e.target.value)}
                        className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="http://localhost:11434"
                      />
                    }
                  />
                )}

                {store.provider === "bedrock" && (
                  <>
                    <SettingRow
                      icon={Globe}
                      label="Bedrock region"
                      description="AWS region for Bedrock service"
                      control={
                        <input
                          type="text"
                          value={store.bedrockRegion}
                          onChange={(e) => handleFieldChange("bedrockRegion", e.target.value)}
                          className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                          placeholder="us-east-1"
                        />
                      }
                    />

                    <SettingRow
                      icon={Key}
                      label="Access key ID"
                      description="AWS access key"
                      control={
                        <input
                          type="password"
                          value={store.bedrockAccessKeyId}
                          onChange={(e) => handleFieldChange("bedrockAccessKeyId", e.target.value)}
                          onFocus={(e) => { if (isMaskedValue(e.target.value)) { store.setField("bedrockAccessKeyId", ""); } }}
                          className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                          placeholder={isMaskedValue(store.bedrockAccessKeyId) ? "Configured — click to change" : "Enter access key"}
                        />
                      }
                    />

                    <SettingRow
                      icon={Key}
                      label="Secret access key"
                      description="AWS secret key"
                      control={
                        <input
                          type="password"
                          value={store.bedrockSecretAccessKey}
                          onChange={(e) => handleFieldChange("bedrockSecretAccessKey", e.target.value)}
                          onFocus={(e) => { if (isMaskedValue(e.target.value)) { store.setField("bedrockSecretAccessKey", ""); } }}
                          className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                          placeholder={isMaskedValue(store.bedrockSecretAccessKey) ? "Configured — click to change" : "Enter secret key"}
                        />
                      }
                    />

                    <SettingRow
                      icon={Key}
                      label="Session token"
                      description="Optional AWS session token"
                      control={
                        <input
                          type="password"
                          value={store.bedrockSessionToken}
                          onChange={(e) => handleFieldChange("bedrockSessionToken", e.target.value)}
                          onFocus={(e) => { if (isMaskedValue(e.target.value)) { store.setField("bedrockSessionToken", ""); } }}
                          className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                          placeholder={isMaskedValue(store.bedrockSessionToken) ? "Configured — click to change" : "Optional"}
                        />
                      }
                    />
                  </>
                )}

                <SettingRow
                  icon={Languages}
                  label="Transcription language"
                  description="Primary language for speech recognition"
                  control={
                    <input
                      type="text"
                      value={store.transcriptionLanguage}
                      onChange={(e) => handleFieldChange("transcriptionLanguage", e.target.value)}
                      className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="en"
                    />
                  }
                />

                <SettingRow
                  icon={Languages}
                  label="Translation language"
                  description="Target language for translation"
                  control={
                    <input
                      type="text"
                      value={store.translationLanguage}
                      onChange={(e) => handleFieldChange("translationLanguage", e.target.value)}
                      className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="en"
                    />
                  }
                />
              </div>
            </div>
          </div>

          {/* Transcription Backend Section */}
          <div className="bg-card border border-border rounded-lg p-6">
            <TranscriptionBackendSettings />
          </div>

          {/* Recording Section */}
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-4">Recording</h2>

            {/* Recording Behavior */}
            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-foreground mb-1">Recording behavior</h3>
                <p className="text-sm text-muted-foreground">
                  Configure automatic recording and timing settings
                </p>
              </div>

              <div className="space-y-1">
                <SettingRow
                  icon={Mic}
                  label="Auto-record"
                  description="Start recording when microphone is active"
                  control={
                    <ToggleSwitch
                      checked={store.autoRecord}
                      onChange={() => handleFieldChange("autoRecord", !store.autoRecord)}
                    />
                  }
                />

                <SettingRow
                  icon={Clock}
                  label="Poll interval"
                  description="Microphone check interval (seconds)"
                  control={
                    <input
                      type="number"
                      value={store.pollInterval}
                      onChange={(e) => handleFieldChange("pollInterval", Number(e.target.value))}
                      className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      min="1"
                      max="10"
                      step="1"
                    />
                  }
                />

                <SettingRow
                  icon={Hourglass}
                  label="Grace period"
                  description="Silence duration before stopping (seconds)"
                  control={
                    <input
                      type="number"
                      value={store.gracePeriod}
                      onChange={(e) => handleFieldChange("gracePeriod", Number(e.target.value))}
                      className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      min="5"
                      max="60"
                      step="5"
                    />
                  }
                />

                <SettingRow
                  icon={Scissors}
                  label="Chunk interval"
                  description="Audio chunk duration (seconds)"
                  control={
                    <input
                      type="number"
                      value={store.chunkInterval}
                      onChange={(e) => handleFieldChange("chunkInterval", Number(e.target.value))}
                      className="w-48 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      min="10"
                      max="30"
                      step="1000"
                    />
                  }
                />
              </div>
            </div>
          </div>

          {/* Meeting Types Section */}
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-4">Meeting Types</h2>

            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-foreground mb-1">Custom meeting templates</h3>
                <p className="text-sm text-muted-foreground">
                  Create meeting types with specialized AI prompts
                </p>
              </div>

              <div className="space-y-2">
                {meetingTypes.map((type) => (
                  <div key={type.id} className="flex items-center gap-3 p-3 bg-accent/30 rounded-lg">
                    <div className="w-8 h-8 rounded-full bg-background flex items-center justify-center shrink-0">
                      <Calendar className="w-4 h-4 text-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground">{type.name}</div>
                      {type.description && (
                        <div className="text-xs text-muted-foreground">{type.description}</div>
                      )}
                    </div>
                    {type.is_default === 1 && (
                      <span className="text-xs px-2 py-1 bg-primary/20 text-primary rounded">Default</span>
                    )}
                  </div>
                ))}

                <button
                  onClick={() => {
                    const name = prompt("Meeting type name:");
                    if (name) {
                      const description = prompt("Description (optional):");
                      const promptTemplate = prompt("AI prompt template (optional):");
                      handleCreateMeetingType({
                        name,
                        description: description || undefined,
                        prompt_template: promptTemplate || undefined,
                      });
                    }
                  }}
                  className="w-full py-2.5 px-4 text-sm font-medium text-foreground bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors border border-primary/20"
                >
                  + Add meeting type
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
