import { useState } from "react";

interface SpeakerInfo {
  id: string;
  name: string;
  displayName: string | null;
  segmentCount: number;
}

interface SpeakerListProps {
  speakers: SpeakerInfo[];
  onRenameSpeaker: (speakerId: string, newName: string) => void;
}

export function SpeakerList({ speakers, onRenameSpeaker }: SpeakerListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  function startEditing(speaker: SpeakerInfo) {
    setEditingId(speaker.id);
    setEditValue(speaker.displayName ?? speaker.name);
  }

  function confirmEdit(speakerId: string) {
    if (editValue.trim()) {
      onRenameSpeaker(speakerId, editValue.trim());
    }
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  if (speakers.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        No speakers detected yet.
      </div>
    );
  }

  return (
    <div className="space-y-1 p-2">
      {speakers.map((speaker) => (
        <div
          key={speaker.id}
          className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-accent"
        >
          {editingId === speaker.id ? (
            <input
              className="text-sm bg-transparent border-b border-primary outline-none w-full"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmEdit(speaker.id);
                if (e.key === "Escape") cancelEdit();
              }}
              onBlur={() => cancelEdit()}
              autoFocus
            />
          ) : (
            <button
              className="text-sm font-medium text-foreground text-left"
              onClick={() => startEditing(speaker)}
            >
              {speaker.displayName ?? speaker.name}
            </button>
          )}
          <span className="text-xs text-muted-foreground ml-2 shrink-0">
            {speaker.segmentCount} segments
          </span>
        </div>
      ))}
    </div>
  );
}
