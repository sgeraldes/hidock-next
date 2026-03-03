import { useEffect, useState, useCallback } from "react";
import {
  AudioLines,
  CloudCog,
  Key,
  FileText,
  Globe,
  Languages,
  SlidersHorizontal,
  Loader2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { SettingRow } from "./SettingRow";

const INPUT_CLASS =
  "w-56 bg-background text-foreground border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary";

type AuthType = "api-key" | "service-account";

interface ConnectionTestResult {
  status: "idle" | "testing" | "success" | "error";
  message?: string;
}

export default function TranscriptionBackendSettings() {
  const [backend, setBackend] = useState("gemini-multimodal");
  const [authType, setAuthType] = useState<AuthType>("api-key");
  const [gcpApiKey, setGcpApiKey] = useState("");
  const [serviceAccountJson, setServiceAccountJson] = useState("");
  const [projectId, setProjectId] = useState("");
  const [location, setLocation] = useState("global");
  const [languageCode, setLanguageCode] = useState("en-US");
  const [confidenceThreshold, setConfidenceThreshold] = useState("0.7");
  const [testResult, setTestResult] = useState<ConnectionTestResult>({ status: "idle" });

  useEffect(() => {
    window.electronAPI.settings.getChirp3Config().then((config) => {
      setBackend(config.backend || "gemini-multimodal");
      setAuthType((config.authType as AuthType) || "api-key");
      setProjectId(config.projectId || "");
      setLocation(config.location || "global");
      setLanguageCode(config.languageCode || "en-US");
      setConfidenceThreshold(String(config.confidenceThreshold ?? 0.7));
      if (config.hasApiKey) setGcpApiKey("****");
      if (config.hasServiceAccount) setServiceAccountJson("****");
    }).catch(() => {
      /* settings not yet available */
    });
  }, []);

  const saveSetting = useCallback((key: string, value: string) => {
    window.electronAPI.settings.set(key, value).catch((err: unknown) => {
      console.warn("[TranscriptionBackendSettings] Failed to save:", key, err);
    });
  }, []);

  const handleBackendChange = useCallback(
    (value: string) => {
      setBackend(value);
      saveSetting("ai.transcriptionBackend", value);
    },
    [saveSetting],
  );

  const handleAuthTypeChange = useCallback(
    (value: string) => {
      setAuthType(value as AuthType);
      saveSetting("ai.gcp.authType", value);
    },
    [saveSetting],
  );

  const handleTestConnection = useCallback(async () => {
    setTestResult({ status: "testing" });
    try {
      const result = await window.electronAPI.settings.testChirp3Connection();
      if (result.valid) {
        setTestResult({ status: "success", message: "Connection successful" });
      } else {
        setTestResult({ status: "error", message: result.error || "Connection failed" });
      }
    } catch (err) {
      setTestResult({
        status: "error",
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    }
  }, []);

  const isChirp3 = backend === "chirp3+gemini";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground mb-1">
          Speech recognition backend
        </h3>
        <p className="text-sm text-muted-foreground">
          Choose how audio is transcribed into text
        </p>
      </div>

      <div className="space-y-1">
        <SettingRow
          icon={AudioLines}
          label="Transcription backend"
          description="Chirp 3 offers higher accuracy; Gemini multimodal is simpler to set up"
          control={
            <select
              value={backend}
              onChange={(e) => handleBackendChange(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="gemini-multimodal">Gemini Multimodal (default)</option>
              <option value="chirp3+gemini">Chirp 3 STT + Gemini Analysis</option>
            </select>
          }
        />
      </div>

      {isChirp3 && (
        <div className="space-y-1 border-t border-border pt-4">
          <div className="mb-3">
            <p className="text-sm font-medium text-foreground">
              Google Cloud Speech-to-Text (Chirp 3)
            </p>
            <p className="text-xs text-muted-foreground">
              Requires a Google Cloud project with the Speech-to-Text API enabled
            </p>
          </div>

          <SettingRow
            icon={CloudCog}
            label="GCP Project ID"
            description="Your Google Cloud project identifier"
            control={
              <input
                type="text"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  saveSetting("ai.gcp.projectId", e.target.value);
                }}
                className={INPUT_CLASS}
                placeholder="my-project-id"
              />
            }
          />

          <SettingRow
            icon={Key}
            label="Authentication method"
            description="How to authenticate with Google Cloud"
            control={
              <select
                value={authType}
                onChange={(e) => handleAuthTypeChange(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="api-key">API Key</option>
                <option value="service-account">Service Account JSON</option>
              </select>
            }
          />

          {authType === "api-key" && (
            <SettingRow
              icon={Key}
              label="GCP API Key"
              description="Google Cloud API key with Speech-to-Text access"
              control={
                <input
                  type="password"
                  value={gcpApiKey}
                  onChange={(e) => {
                    setGcpApiKey(e.target.value);
                    if (e.target.value !== "****") {
                      saveSetting("ai.gcp.apiKey", e.target.value);
                    }
                  }}
                  onFocus={() => {
                    if (gcpApiKey === "****") setGcpApiKey("");
                  }}
                  className={INPUT_CLASS}
                  placeholder="Enter GCP API key"
                />
              }
            />
          )}

          {authType === "service-account" && (
            <SettingRow
              icon={FileText}
              label="Service Account JSON"
              description="Paste the entire JSON key file contents"
              control={
                <textarea
                  value={serviceAccountJson}
                  onChange={(e) => {
                    setServiceAccountJson(e.target.value);
                    if (e.target.value !== "****") {
                      saveSetting("ai.gcp.serviceAccountJson", e.target.value);
                    }
                  }}
                  onFocus={() => {
                    if (serviceAccountJson === "****") setServiceAccountJson("");
                  }}
                  className={`${INPUT_CLASS} h-20 text-xs font-mono resize-none`}
                  placeholder='{"type":"service_account",...}'
                />
              }
            />
          )}

          <SettingRow
            icon={Globe}
            label="Location"
            description="GCP region for the Speech API (affects latency)"
            control={
              <select
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  saveSetting("ai.gcp.location", e.target.value);
                }}
                className={INPUT_CLASS}
              >
                <option value="global">Global (default)</option>
                <option value="us">US</option>
                <option value="eu">EU</option>
                <option value="us-central1">us-central1</option>
                <option value="europe-west4">europe-west4</option>
                <option value="asia-southeast1">asia-southeast1</option>
              </select>
            }
          />

          <SettingRow
            icon={Languages}
            label="Speech language"
            description="Language code for Chirp 3 recognition"
            control={
              <input
                type="text"
                value={languageCode}
                onChange={(e) => {
                  setLanguageCode(e.target.value);
                  saveSetting("ai.chirp3.languageCode", e.target.value);
                }}
                className={INPUT_CLASS}
                placeholder="en-US"
              />
            }
          />

          <SettingRow
            icon={SlidersHorizontal}
            label="Confidence threshold"
            description="Lower thresholds include more words (even with lower confidence); higher thresholds only include highly confident words"
            control={
              <div className="flex items-center gap-4 w-full max-w-sm">
                <div className="flex-1">
                  <input
                    type="range"
                    min="50"
                    max="100"
                    step="5"
                    value={Math.round(parseFloat(confidenceThreshold) * 100)}
                    onChange={(e) => {
                      const percentValue = parseInt(e.target.value, 10);
                      const decimalValue = (percentValue / 100).toFixed(2);
                      setConfidenceThreshold(decimalValue);
                      saveSetting("ai.chirp3.confidenceThreshold", decimalValue);
                    }}
                    aria-label="Confidence threshold percentage"
                    aria-valuenow={Math.round(parseFloat(confidenceThreshold) * 100)}
                    aria-valuemin={50}
                    aria-valuemax={100}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                  />
                </div>
                <div className="text-sm font-semibold text-foreground min-w-[3rem] text-right">
                  {Math.round(parseFloat(confidenceThreshold) * 100)}%
                </div>
              </div>
            }
          />

          {/* Test Connection */}
          <div className="pt-3 flex items-center gap-3">
            <button
              onClick={handleTestConnection}
              disabled={testResult.status === "testing"}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors flex items-center gap-2"
            >
              {testResult.status === "testing" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Chirp 3 Connection"
              )}
            </button>

            {testResult.status === "success" && (
              <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="w-4 h-4" />
                {testResult.message}
              </span>
            )}

            {testResult.status === "error" && (
              <span className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                <XCircle className="w-4 h-4" />
                {testResult.message}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
