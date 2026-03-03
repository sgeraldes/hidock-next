import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import type { ModelDefinition } from "../../types/model-config";

interface ModelBadgeProps {
  model: ModelDefinition;
}

export function ModelBadge({ model }: ModelBadgeProps) {
  if (model.deprecated) {
    return (
      <span
        className={
          "inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full " +
          "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400"
        }
      >
        <Clock className="h-3 w-3" />
        Deprecated{model.sunset ? ` (until ${model.sunset})` : ""}
      </span>
    );
  }

  if (model.recommended) {
    return (
      <span
        className={
          "inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full " +
          "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400"
        }
      >
        <CheckCircle2 className="h-3 w-3" />
        Recommended
      </span>
    );
  }

  if (model.costMultiplier > 5) {
    return (
      <span
        className={
          "inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full " +
          "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400"
        }
      >
        <AlertTriangle className="h-3 w-3" />
        {model.costMultiplier}x Cost
      </span>
    );
  }

  if (model.costMultiplier > 1) {
    return (
      <span
        className={
          "inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full " +
          "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
        }
      >
        {model.costMultiplier}x Cost
      </span>
    );
  }

  return null;
}
