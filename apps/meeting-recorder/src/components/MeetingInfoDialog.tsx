import { useState } from "react";

interface MeetingInfoDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (subject: string, attendees: string[]) => void;
  initialSubject?: string;
  initialAttendees?: string[];
}

export function MeetingInfoDialog({
  open,
  onClose,
  onSave,
  initialSubject = "",
  initialAttendees = [],
}: MeetingInfoDialogProps) {
  const [subject, setSubject] = useState(initialSubject);
  const [attendeesText, setAttendeesText] = useState(
    initialAttendees.join(", "),
  );

  if (!open) return null;

  function handleSave() {
    const attendees = attendeesText
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    onSave(subject, attendees);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Meeting Info
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Subject
            </label>
            <input
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground"
              placeholder="Meeting subject..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Attendees
            </label>
            <input
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground"
              placeholder="Comma-separated names..."
              value={attendeesText}
              onChange={(e) => setAttendeesText(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Names help the AI identify speakers in the transcript.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
