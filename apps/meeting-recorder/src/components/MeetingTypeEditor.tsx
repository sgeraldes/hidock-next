import { useState } from "react";
import { Pencil, Trash2, Plus, X } from "lucide-react";

interface MeetingTypeItem {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  prompt_template: string | null;
  is_default: number;
  created_at: string;
}

interface MeetingTypeEditorProps {
  meetingTypes: MeetingTypeItem[];
  onCreate: (params: {
    name: string;
    description?: string;
    prompt_template?: string;
  }) => Promise<unknown>;
}

export default function MeetingTypeEditor({
  meetingTypes,
  onCreate,
}: MeetingTypeEditorProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) return;

    await onCreate({
      name: name.trim(),
      description: description.trim() || undefined,
      prompt_template: promptTemplate.trim() || undefined,
    });

    setName("");
    setDescription("");
    setPromptTemplate("");
    setShowCreateForm(false);
  };

  const handleEdit = (mt: MeetingTypeItem) => {
    setEditingId(mt.id);
    setName(mt.name);
    setDescription(mt.description || "");
    setPromptTemplate(mt.prompt_template || "");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setPromptTemplate("");
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this meeting type?")) return;
    // TODO: Wire up delete handler when available
    console.log("Delete meeting type:", id);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Existing types list */}
      <div className="space-y-2">
        {meetingTypes.map((mt) => (
          <div
            key={mt.id}
            className={`rounded-md border bg-card ${
              editingId === mt.id
                ? "border-primary"
                : "border-border"
            }`}
          >
            {editingId === mt.id ? (
              /* Edit Form */
              <div className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-foreground">Edit meeting type</h4>
                  <button
                    onClick={handleCancelEdit}
                    className="p-1 hover:bg-accent rounded transition-colors"
                    title="Cancel"
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <input
                  type="text"
                  placeholder="Description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    AI prompt template (optional)
                  </label>
                  <textarea
                    placeholder="Focus on action items and decisions..."
                    value={promptTemplate}
                    onChange={(e) => setPromptTemplate(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreate}
                    className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    Save changes
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="px-3 py-2 bg-muted text-foreground rounded-md text-sm font-medium hover:bg-muted/80 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* Display Mode */
              <div className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-medium text-foreground">
                        {mt.name}
                      </h4>
                      {mt.is_default === 1 && (
                        <span className="rounded bg-blue-100 dark:bg-blue-950 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                          Default
                        </span>
                      )}
                    </div>
                    {mt.description && (
                      <p className="text-sm text-muted-foreground">{mt.description}</p>
                    )}
                    {mt.prompt_template && (
                      <details className="mt-2">
                        <summary className="text-xs text-primary hover:text-primary/80 cursor-pointer">
                          View prompt template
                        </summary>
                        <div className="mt-2 p-2 bg-muted rounded text-xs text-muted-foreground font-mono whitespace-pre-wrap">
                          {mt.prompt_template}
                        </div>
                      </details>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleEdit(mt)}
                      className="p-1.5 hover:bg-accent rounded transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4 text-muted-foreground" />
                    </button>
                    {mt.is_default !== 1 && (
                      <button
                        onClick={() => handleDelete(mt.id)}
                        className="p-1.5 hover:bg-destructive/10 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create new button and form */}
      {!showCreateForm && !editingId && (
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 px-3 py-2 border border-dashed border-border hover:border-primary/50 hover:bg-accent/50 rounded-md transition-colors text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-4 h-4" />
          Create custom meeting type
        </button>
      )}

      {showCreateForm && (
        <div className="rounded-md border border-primary bg-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-foreground">Create new meeting type</h4>
            <button
              onClick={() => {
                setShowCreateForm(false);
                setName("");
                setDescription("");
                setPromptTemplate("");
              }}
              className="p-1 hover:bg-accent rounded transition-colors"
              title="Cancel"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="text"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              AI prompt template (optional)
            </label>
            <textarea
              placeholder="Focus on sprint goals, capacity planning, and task breakdown..."
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!name.trim()}
              className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create meeting type
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false);
                setName("");
                setDescription("");
                setPromptTemplate("");
              }}
              className="px-3 py-2 bg-muted text-foreground rounded-md text-sm font-medium hover:bg-muted/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
