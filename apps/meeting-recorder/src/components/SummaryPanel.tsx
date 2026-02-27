interface SummaryPanelProps {
  summary: string | null;
  isGenerating: boolean;
  onGenerate?: () => void;
}

export default function SummaryPanel({
  summary,
  isGenerating,
  onGenerate,
}: SummaryPanelProps) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {isGenerating && (
        <div className="text-sm text-accent-foreground">Generating summary...</div>
      )}

      {summary && (
        <div className="whitespace-pre-wrap text-sm text-card-foreground">
          {summary}
        </div>
      )}

      {!summary && !isGenerating && (
        <div className="text-center text-sm text-muted-foreground">
          No summary generated yet.
        </div>
      )}

      {onGenerate && (
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          className="rounded bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {summary ? "Regenerate Summary" : "Generate Summary"}
        </button>
      )}
    </div>
  );
}
