import { useState } from "react";

interface ActionItem {
  id: string;
  text: string;
  assignee: string | null;
  status: "open" | "done";
}

interface ActionItemsPanelProps {
  items: ActionItem[];
  onToggle: (id: string, newStatus: "open" | "done") => void;
  onAdd: (text: string) => void;
}

export default function ActionItemsPanel({
  items,
  onToggle,
  onAdd,
}: ActionItemsPanelProps) {
  const [newText, setNewText] = useState("");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && newText.trim()) {
      onAdd(newText.trim());
      setNewText("");
    }
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="flex gap-2 px-1 pb-2">
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add action item..."
          className="flex-1 rounded border border-input bg-card px-2 py-1 text-sm text-card-foreground placeholder:text-muted-foreground"
        />
      </div>

      {items.length === 0 && !newText && (
        <div className="p-4 text-center text-sm text-muted-foreground">
          No action items yet
        </div>
      )}

      {items.map((item) => (
        <label
          key={item.id}
          className="flex items-start gap-2 rounded px-3 py-2 hover:bg-muted"
        >
          <input
            type="checkbox"
            checked={item.status === "done"}
            onChange={() =>
              onToggle(item.id, item.status === "done" ? "open" : "done")
            }
            className="mt-0.5"
          />
          <div className="flex-1">
            <span
              className={`text-sm ${item.status === "done" ? "text-muted-foreground line-through" : "text-card-foreground"}`}
            >
              {item.text}
            </span>
            {item.assignee && (
              <span className="ml-2 text-xs text-primary">
                {item.assignee}
              </span>
            )}
          </div>
        </label>
      ))}
    </div>
  );
}
