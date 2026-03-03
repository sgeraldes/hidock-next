import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { ModelSelector } from "./ModelSelector";
import { useSettingsStore } from "../../store/useSettingsStore";
import type { ContextDefinition } from "../../types/model-config";

interface ContextModelSettingsProps {
  provider: string;
}

export function ContextModelSettings({ provider }: ContextModelSettingsProps) {
  const [expanded, setExpanded] = useState(false);
  const [contexts, setContexts] = useState<Record<string, ContextDefinition>>({});
  const [loading, setLoading] = useState(true);

  const defaultModel = useSettingsStore((s) => s.model);
  const contextModels = useSettingsStore((s) => s.contextModels);
  const updateModelForContext = useSettingsStore((s) => s.updateModelForContext);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    window.electronAPI.models
      .getContexts()
      .then((result) => {
        if (cancelled) return;
        setContexts(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setContexts({});
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const contextEntries = Object.entries(contexts);

  // Don't render if no contexts available or still loading with nothing to show
  if (!loading && contextEntries.length === 0) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={
          "w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-foreground " +
          "hover:bg-accent/50 transition-colors text-left"
        }
        aria-expanded={expanded}
        aria-controls="context-model-settings"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0" />
        )}
        Advanced: Per-context models
        <span className="text-xs text-muted-foreground ml-2">
          Use different models for different tasks
        </span>
      </button>

      {expanded && (
        <div id="context-model-settings" className="px-4 pb-4 space-y-4">
          {loading ? (
            <div className="text-sm text-muted-foreground animate-pulse py-2">
              Loading contexts...
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Override the default model for specific contexts. Leave unchanged to use the default
                model ({defaultModel || "not set"}).
              </p>

              {contextEntries.map(([contextKey, contextDef]) => {
                const currentModel = contextModels[contextKey] || "";
                const isOverridden = currentModel !== "" && currentModel !== defaultModel;

                return (
                  <div key={contextKey} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`context-model-${contextKey}`}
                        className="text-sm font-medium text-foreground"
                      >
                        {contextDef.name}
                      </label>
                      {isOverridden && (
                        <button
                          type="button"
                          onClick={() => updateModelForContext(contextKey, "")}
                          className={
                            "inline-flex items-center gap-1 text-xs text-muted-foreground " +
                            "hover:text-foreground transition-colors"
                          }
                          aria-label={`Reset ${contextDef.name} to default model`}
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reset to default
                        </button>
                      )}
                    </div>
                    <p
                      className="text-xs text-muted-foreground"
                      id={`context-desc-${contextKey}`}
                    >
                      {contextDef.description} (Priority: {contextDef.priority})
                    </p>
                    <ModelSelector
                      provider={provider}
                      value={currentModel || defaultModel}
                      onChange={(modelId) => updateModelForContext(contextKey, modelId)}
                    />
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
