interface AttachmentInfo {
  id: string;
  filename: string;
  type: "file" | "screenshot" | "note";
}

interface NotesPanelProps {
  notes: string;
  attachments: AttachmentInfo[];
  onNotesChange: (notes: string) => void;
  onAddAttachment: () => void;
  onRemoveAttachment: (id: string) => void;
}

export function NotesPanel({
  notes,
  attachments,
  onNotesChange,
  onAddAttachment,
  onRemoveAttachment,
}: NotesPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Notes
        </h3>
        <button
          data-testid="add-attachment-btn"
          onClick={onAddAttachment}
          className="text-xs text-primary hover:text-primary/80"
        >
          + Attach
        </button>
      </div>

      <div className="flex-1 flex flex-col p-3 gap-3">
        <textarea
          className="flex-1 min-h-[120px] w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground resize-none"
          placeholder="Add meeting notes..."
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
        />

        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-2">
            Attachments
          </h4>
          {attachments.length === 0 ? (
            <p className="text-xs text-muted-foreground">No attachments yet.</p>
          ) : (
            <div className="space-y-1">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded bg-accent text-sm"
                >
                  <span className="truncate">{attachment.filename}</span>
                  <button
                    data-testid="remove-attachment"
                    onClick={() => onRemoveAttachment(attachment.id)}
                    className="text-xs text-muted-foreground hover:text-destructive ml-2 shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
