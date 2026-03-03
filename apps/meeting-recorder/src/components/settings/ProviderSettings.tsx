// NOTE: This component is currently unused (dead code per ST-005 audit finding).
// Settings.tsx does not render ProviderSettings. The hardcoded PROVIDERS metadata
// (especially audioCapable) may diverge from the canonical config in the main process.
// If this component is revived, PROVIDERS should be fetched from models:getConfig IPC
// instead of being hardcoded here.

import { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { ModelSelector } from "./ModelSelector";
import { ContextModelSettings } from "./ContextModelSettings";

interface ProviderSettingsProps {
  provider: string;
  model: string;
  apiKey: string;
  ollamaBaseUrl: string;
  bedrockRegion: string;
  bedrockAccessKeyId: string;
  bedrockSecretAccessKey: string;
  bedrockSessionToken: string;
  transcriptionProvider?: string;
  transcriptionApiKey?: string;
  onFieldChange: (key: string, value: string) => void;
  onTestConnection: () => void;
  testResult: { valid: boolean; error?: string } | null;
  testing: boolean;
}

const PROVIDERS = [
  {
    value: "google",
    label: "Google Gemini",
    audioCapable: true,
    description: "Best for audio transcription • Supports streaming • Real-time processing",
    getKeyUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    value: "openai",
    label: "OpenAI",
    audioCapable: false,
    description: "GPT-4 and GPT-3.5 models • Text processing only",
    getKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    audioCapable: false,
    description: "Claude models • Advanced reasoning • Text processing only",
    getKeyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    value: "bedrock",
    label: "Amazon Bedrock",
    audioCapable: false,
    description: "AWS-managed AI models • Requires AWS credentials",
    getKeyUrl: "https://console.aws.amazon.com/bedrock",
  },
  {
    value: "ollama",
    label: "Ollama (Local)",
    audioCapable: false,
    description: "Run models locally • No API key needed • Privacy-focused",
    getKeyUrl: "https://ollama.ai/download",
  },
];

function isMaskedValue(value: string): boolean {
  return value.startsWith("****") && value.length > 4;
}

export default function ProviderSettings({
  provider,
  model,
  apiKey,
  ollamaBaseUrl,
  bedrockRegion,
  bedrockAccessKeyId,
  bedrockSecretAccessKey,
  bedrockSessionToken,
  transcriptionProvider = "",
  transcriptionApiKey = "",
  onFieldChange,
  onTestConnection,
  testResult,
  testing,
}: ProviderSettingsProps) {
  const [editingApiKey, setEditingApiKey] = useState(false);
  const [editingBedrockKeys, setEditingBedrockKeys] = useState(false);

  // Load default models from config via IPC (replaces hardcoded DEFAULT_MODELS)
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({});
  useEffect(() => {
    window.electronAPI.models
      .getConfig()
      .then((config) => {
        const defaults: Record<string, string> = {};
        for (const [key, prov] of Object.entries(config.providers)) {
          defaults[key] = prov.defaultModel;
        }
        setDefaultModels(defaults);
      })
      .catch(() => {
        // Fallback: empty map - model field won't auto-populate on provider change
      });
  }, []);

  const currentProvider = PROVIDERS.find((p) => p.value === provider);
  const needsApiKey = provider !== "ollama";
  const isBedrock = provider === "bedrock";
  const isOllama = provider === "ollama";
  const isTextOnly = currentProvider?.audioCapable === false;

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <div className="py-3">
        <label htmlFor="ai-provider" className="text-sm font-medium text-foreground block mb-1">
          AI provider
        </label>
        <p className="text-sm text-muted-foreground mb-3">
          {currentProvider?.description || "Select the AI service for transcription and analysis"}
        </p>
        <select
          id="ai-provider"
          value={provider}
          onChange={(e) => {
            onFieldChange("provider", e.target.value);
            const defaultModel = defaultModels[e.target.value];
            if (defaultModel) {
              onFieldChange("model", defaultModel);
            }
          }}
          className="w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label} {p.audioCapable ? "🎤" : ""}
            </option>
          ))}
        </select>
        <a
          href={currentProvider?.getKeyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Get API key
        </a>
      </div>

      {/* Audio Transcription for Text-Only Providers */}
      {isTextOnly && (
        <div className="py-3">
          <div className="flex items-start gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground mb-1">
                Audio transcription required
              </p>
              <p className="text-sm text-muted-foreground">
                {currentProvider?.label} doesn't support audio input. Add a separate provider for real-time transcription.
              </p>
            </div>
          </div>
          <label htmlFor="transcription-provider" className="text-sm font-medium text-foreground block mb-1">
            Transcription provider
          </label>
          <select
            id="transcription-provider"
            value={transcriptionProvider}
            onChange={(e) => onFieldChange("transcriptionProvider", e.target.value)}
            className="w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary mb-3"
          >
            <option value="">None (audio transcription disabled)</option>
            <option value="google">Google Gemini 🎤</option>
          </select>

          {transcriptionProvider === "google" && (
            <div>
              <label htmlFor="transcription-api-key" className="text-sm font-medium text-foreground block mb-1">
                Google API key (for transcription)
              </label>
              <input
                id="transcription-api-key"
                type="password"
                value={transcriptionApiKey}
                onChange={(e) => onFieldChange("transcriptionApiKey", e.target.value)}
                className="w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Enter Google API key"
              />
            </div>
          )}
        </div>
      )}

      {/* Model Selection */}
      <div className="py-3">
        <label className="text-sm font-medium text-foreground block mb-1">
          Model
        </label>
        <ModelSelector
          provider={provider}
          value={model}
          onChange={(newModel) => onFieldChange("model", newModel)}
        />
      </div>

      {/* Context-Specific Model Overrides */}
      <div className="py-3">
        <ContextModelSettings provider={provider} />
      </div>

      {/* API Key (non-Bedrock providers) */}
      {needsApiKey && !isBedrock && (
        <div className="py-3">
          <label htmlFor="api-key" className="text-sm font-medium text-foreground block mb-1">
            API key
          </label>
          <p className="text-sm text-muted-foreground mb-3">
            Stored securely on your device • Never shared
          </p>
          {!editingApiKey && isMaskedValue(apiKey) ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 bg-muted text-muted-foreground border border-input rounded-md px-3 py-2 text-sm font-mono">
                {apiKey}
              </span>
              <button
                type="button"
                onClick={() => setEditingApiKey(true)}
                className="px-3 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-md text-sm font-medium transition-colors"
              >
                Change
              </button>
            </div>
          ) : (
            <input
              id="api-key"
              type="password"
              value={editingApiKey ? "" : apiKey}
              onChange={(e) => onFieldChange("apiKey", e.target.value)}
              onBlur={() => setEditingApiKey(false)}
              className="w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Paste your API key here"
              autoFocus={editingApiKey}
            />
          )}
        </div>
      )}

      {/* AWS Bedrock Configuration */}
      {isBedrock && (
        <>
          <div className="py-3">
            <label htmlFor="bedrock-region" className="text-sm font-medium text-foreground block mb-1">
              AWS region
            </label>
            <p className="text-sm text-muted-foreground mb-3">
              The AWS region where Bedrock is available
            </p>
            <input
              id="bedrock-region"
              type="text"
              value={bedrockRegion}
              onChange={(e) => onFieldChange("bedrockRegion", e.target.value)}
              className="w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="us-east-1"
            />
          </div>

          <div className="py-3">
            <label htmlFor="bedrock-access-key" className="text-sm font-medium text-foreground block mb-1">
              Access key ID
            </label>
            <p className="text-sm text-muted-foreground mb-3">
              Your AWS access key for Bedrock
            </p>
            {!editingBedrockKeys && isMaskedValue(bedrockAccessKeyId) ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 bg-muted text-muted-foreground border border-input rounded-md px-3 py-2 text-sm font-mono">
                  {bedrockAccessKeyId}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingBedrockKeys(true)}
                  className="px-3 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-md text-sm font-medium transition-colors"
                >
                  Change
                </button>
              </div>
            ) : (
              <input
                id="bedrock-access-key"
                type="password"
                value={editingBedrockKeys ? "" : bedrockAccessKeyId}
                onChange={(e) => onFieldChange("bedrockAccessKeyId", e.target.value)}
                className="w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="AWS Access Key ID"
              />
            )}
          </div>

          <div className="py-3">
            <label htmlFor="bedrock-secret-key" className="text-sm font-medium text-foreground block mb-1">
              Secret access key
            </label>
            <p className="text-sm text-muted-foreground mb-3">
              Your AWS secret access key for Bedrock
            </p>
            {!editingBedrockKeys && isMaskedValue(bedrockSecretAccessKey) ? (
              <span className="block bg-muted text-muted-foreground border border-input rounded-md px-3 py-2 text-sm font-mono">
                {bedrockSecretAccessKey}
              </span>
            ) : (
              <input
                id="bedrock-secret-key"
                type="password"
                value={editingBedrockKeys ? "" : bedrockSecretAccessKey}
                onChange={(e) => onFieldChange("bedrockSecretAccessKey", e.target.value)}
                className="w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="AWS Secret Access Key"
              />
            )}
          </div>

          <div className="py-3">
            <label htmlFor="bedrock-session-token" className="text-sm font-medium text-foreground block mb-1">
              Session token (optional)
            </label>
            <p className="text-sm text-muted-foreground mb-3">
              Leave blank unless using temporary credentials
            </p>
            <input
              id="bedrock-session-token"
              type="password"
              value={bedrockSessionToken}
              onChange={(e) => onFieldChange("bedrockSessionToken", e.target.value)}
              className="w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Session token"
            />
          </div>
        </>
      )}

      {/* Ollama Base URL */}
      {isOllama && (
        <div className="py-3">
          <label htmlFor="ollama-url" className="text-sm font-medium text-foreground block mb-1">
            Ollama server URL
          </label>
          <p className="text-sm text-muted-foreground mb-3">
            Default: http://localhost:11434/api if running locally
          </p>
          <input
            id="ollama-url"
            type="text"
            value={ollamaBaseUrl}
            onChange={(e) => onFieldChange("ollamaBaseUrl", e.target.value)}
            className="w-full bg-background text-foreground border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="http://localhost:11434/api"
          />
        </div>
      )}

      {/* Test Connection */}
      <div className="py-3 border-t border-border">
        <button
          onClick={onTestConnection}
          disabled={testing}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? "Testing..." : "Test connection"}
        </button>

        {testResult && (
          <div className={`mt-3 p-3 rounded-md flex items-start gap-2 ${
            testResult.valid
              ? "bg-green-50 dark:bg-green-950/30 text-green-900 dark:text-green-100"
              : "bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-100"
          }`}>
            {testResult.valid ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="text-sm font-medium">
                {testResult.valid ? "Connection successful" : "Connection failed"}
              </p>
              {testResult.error && (
                <p className="text-sm mt-1">
                  {testResult.error}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
