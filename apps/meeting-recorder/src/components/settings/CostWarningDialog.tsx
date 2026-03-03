import { useState, useEffect, useCallback } from "react";
import { AlertTriangle } from "lucide-react";
import type { ModelDefinition } from "../../types/model-config";

interface CostWarningDialogProps {
  open: boolean;
  model: ModelDefinition;
  baselineModel: ModelDefinition | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CostWarningDialog({
  open,
  model,
  baselineModel,
  onConfirm,
  onCancel,
}: CostWarningDialogProps) {
  const [understood, setUnderstood] = useState(false);

  // Reset checkbox when dialog opens/closes
  useEffect(() => {
    if (open) {
      setUnderstood(false);
    }
  }, [open]);

  // Handle Escape key to close dialog
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setUnderstood(false);
        onCancel();
      }
    },
    [onCancel],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  // Compute cost comparison from config data
  const baselineCostPerHour = 0.02; // Baseline estimate for 1x costMultiplier
  const baseCost = baselineModel
    ? baselineCostPerHour * baselineModel.costMultiplier
    : baselineCostPerHour;
  const newCost = baselineCostPerHour * model.costMultiplier;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cost-warning-title"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          <h2
            id="cost-warning-title"
            className="text-lg font-semibold text-foreground"
          >
            Higher Costs - {model.name}
          </h2>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            <strong>{model.name}</strong> costs approximately{" "}
            <strong>{model.costMultiplier}x more</strong> than{" "}
            {baselineModel?.name ?? "the baseline model"}.
          </p>

          <div className="bg-muted p-3 rounded-md space-y-2 text-sm">
            {baselineModel && (
              <div className="flex justify-between">
                <span>1-hour meeting with {baselineModel.name}:</span>
                <span className="font-semibold">~${baseCost.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>1-hour meeting with {model.name}:</span>
              <span className="font-semibold text-orange-600">
                ~${newCost.toFixed(2)}
              </span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {model.description}. Use selectively for important meetings.
          </p>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-1"
              aria-describedby="cost-acknowledgment-label"
            />
            <span id="cost-acknowledgment-label" className="text-sm">
              I understand that {model.name} costs {model.costMultiplier}x more
              and want to proceed
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={() => {
              setUnderstood(false);
              onCancel();
            }}
            className={
              "px-4 py-2 bg-muted hover:bg-muted/80 text-foreground " +
              "rounded-md text-sm font-medium transition-colors"
            }
          >
            {baselineModel ? `Use ${baselineModel.name} Instead` : "Cancel"}
          </button>
          <button
            type="button"
            onClick={() => {
              setUnderstood(false);
              onConfirm();
            }}
            disabled={!understood}
            className={
              "px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white " +
              "rounded-md text-sm font-medium transition-colors " +
              "disabled:opacity-50 disabled:cursor-not-allowed"
            }
          >
            Confirm {model.name}
          </button>
        </div>
      </div>
    </div>
  );
}
