import { useState, useEffect, useCallback } from "react";
import type { ModelDefinition } from "../../types/model-config";
import { ModelBadge } from "./ModelBadge";
import { CostWarningDialog } from "./CostWarningDialog";

const COST_ACK_EXPIRY_DAYS = 30;

interface ModelSelectorProps {
  provider: string;
  value: string;
  onChange: (modelId: string) => void;
}

export function ModelSelector({ provider, value, onChange }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customModel, setCustomModel] = useState("");
  const [costWarningModel, setCostWarningModel] = useState<ModelDefinition | null>(null);
  const [baselineModel, setBaselineModel] = useState<ModelDefinition | null>(null);

  // Load models from config via IPC
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    window.electronAPI.models
      .getActiveForProvider(provider)
      .then((result: ModelDefinition[]) => {
        if (cancelled) return;
        setModels(result);
        setLoading(false);

        // If current value is not in the model list, show custom input
        const isKnownModel = result.some((m) => m.id === value);
        if (!isKnownModel && value) {
          setShowCustomInput(true);
          setCustomModel(value);
        } else {
          setShowCustomInput(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setModels([]);
        setLoading(false);
        // No config models available -- fall back to free-text input
        setShowCustomInput(true);
        setCustomModel(value);
      });

    return () => {
      cancelled = true;
    };
  }, [provider, value]);

  const checkCostAcknowledgment = useCallback(
    async (modelId: string): Promise<boolean> => {
      const ackKey = `ai.costAck.${modelId}`;
      const ack = await window.electronAPI.settings.get(ackKey);
      if (!ack) return false;

      // Check if acknowledgment has expired (older than 30 days)
      const ackDate = new Date(ack);
      const now = new Date();
      const diffDays = (now.getTime() - ackDate.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays < COST_ACK_EXPIRY_DAYS;
    },
    [],
  );

  const handleModelSelect = useCallback(
    async (modelId: string) => {
      if (modelId === "__custom__") {
        setShowCustomInput(true);
        return;
      }

      const model = models.find((m) => m.id === modelId);
      if (!model) {
        onChange(modelId);
        return;
      }

      // Block deprecated models
      if (model.deprecated) {
        return;
      }

      // Show cost warning if costMultiplier > 5 and not acknowledged
      if (model.costMultiplier > 5) {
        const acknowledged = await checkCostAcknowledgment(modelId);
        if (!acknowledged) {
          const baseline = models.find((m) => m.recommended) ?? models[0] ?? null;
          setBaselineModel(baseline);
          setCostWarningModel(model);
          return;
        }
      }

      onChange(modelId);
    },
    [models, onChange, checkCostAcknowledgment],
  );

  const handleCostConfirm = useCallback(async () => {
    if (!costWarningModel) return;

    // Store acknowledgment timestamp
    const ackKey = `ai.costAck.${costWarningModel.id}`;
    await window.electronAPI.settings.set(ackKey, new Date().toISOString());

    onChange(costWarningModel.id);
    setCostWarningModel(null);
    setBaselineModel(null);
  }, [costWarningModel, onChange]);

  const handleCostCancel = useCallback(() => {
    setCostWarningModel(null);
    setBaselineModel(null);
  }, []);

  const handleCustomModelSubmit = useCallback(() => {
    if (customModel.trim()) {
      onChange(customModel.trim());
    }
  }, [customModel, onChange]);

  // Loading state
  if (loading) {
    return (
      <div className="w-full bg-background text-muted-foreground border border-input rounded-md px-3 py-2 text-sm">
        Loading models...
      </div>
    );
  }

  // If no config models, show free-text input
  if (models.length === 0) {
    return (
      <div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={
            "w-full bg-background text-foreground border border-input " +
            "rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          }
          placeholder="Enter model identifier"
        />
      </div>
    );
  }

  // Active (non-deprecated) models for the dropdown
  const activeModels = models.filter((m) => !m.deprecated);

  return (
    <div className="space-y-2">
      {!showCustomInput ? (
        <>
          <select
            value={value}
            onChange={(e) => handleModelSelect(e.target.value)}
            className={
              "w-full bg-background text-foreground border border-input " +
              "rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            }
            aria-label="Select AI model"
          >
            {activeModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
                {model.costMultiplier > 1 ? ` (${model.costMultiplier}x cost)` : ""}
                {model.recommended ? " - Recommended" : ""}
              </option>
            ))}
            <option value="__custom__">Custom model...</option>
          </select>

          {/* Badge and description for selected model */}
          {(() => {
            const selected = models.find((m) => m.id === value);
            return selected ? (
              <div className="flex items-center gap-2">
                <ModelBadge model={selected} />
                <span className="text-xs text-muted-foreground">
                  {selected.description}
                </span>
              </div>
            ) : null;
          })()}
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onBlur={handleCustomModelSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomModelSubmit();
              }}
              className={
                "flex-1 bg-background text-foreground border border-input " +
                "rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              }
              placeholder="Enter custom model identifier"
              autoFocus
            />
            {activeModels.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowCustomInput(false);
                  setCustomModel("");
                }}
                className={
                  "px-3 py-2 bg-muted hover:bg-muted/80 text-foreground " +
                  "rounded-md text-sm transition-colors"
                }
              >
                Back to list
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Enter any valid model identifier for {provider}. Cost warnings only
            apply to models defined in the configuration.
          </p>
        </div>
      )}

      {/* Cost Warning Dialog */}
      {costWarningModel && (
        <CostWarningDialog
          open={true}
          model={costWarningModel}
          baselineModel={baselineModel}
          onConfirm={handleCostConfirm}
          onCancel={handleCostCancel}
        />
      )}
    </div>
  );
}
