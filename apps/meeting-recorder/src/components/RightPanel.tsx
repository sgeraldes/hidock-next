import { useCallback, useEffect, useState } from "react";
import { useSessionStore } from "../store/useSessionStore";
import { useTranscriptStore } from "../store/useTranscriptStore";
import SummaryPanel from "./SummaryPanel";
import { Hash, CheckSquare, FileText } from "lucide-react";

const EMPTY_TOPICS: string[] = [];
const EMPTY_ACTIONS: Array<{ text: string; assignee?: string }> = [];

export function RightPanel() {
  const [tab, setTab] = useState<"topics" | "actions" | "summary">("topics");
  const viewingSessionId = useSessionStore((s) => s.viewingSessionId);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const topicsMap = useTranscriptStore((s) => s.topics);
  const actionItemsMap = useTranscriptStore((s) => s.actionItems);
  const summariesMap = useTranscriptStore((s) => s.summaries);
  const summaryLoadingMap = useTranscriptStore((s) => s.summaryLoading);
  const appendSummaryChunk = useTranscriptStore((s) => s.appendSummaryChunk);
  const setSummaryLoading = useTranscriptStore((s) => s.setSummaryLoading);

  const topics = viewingSessionId
    ? (topicsMap.get(viewingSessionId) ?? EMPTY_TOPICS)
    : EMPTY_TOPICS;
  const actionItems = viewingSessionId
    ? (actionItemsMap.get(viewingSessionId) ?? EMPTY_ACTIONS)
    : EMPTY_ACTIONS;
  const summary = viewingSessionId
    ? (summariesMap.get(viewingSessionId) ?? null)
    : null;
  const isGenerating = viewingSessionId
    ? (summaryLoadingMap.get(viewingSessionId) ?? false)
    : false;

  const viewingSession = viewingSessionId
    ? sessions.get(viewingSessionId)
    : undefined;
  const isSessionActive =
    viewingSessionId === activeSessionId ||
    viewingSession?.status === "active";

  useEffect(() => {
    const cleanup = window.electronAPI.summarization.onChunk(
      (data: { sessionId: string; text: string }) => {
        appendSummaryChunk(data.sessionId, data.text);
      },
    );
    return () => {
      cleanup?.();
    };
  }, [appendSummaryChunk]);

  const handleGenerate = useCallback(() => {
    if (!viewingSessionId) return;
    setSummaryLoading(viewingSessionId, true);
    useTranscriptStore.getState().setSummary(viewingSessionId, "");
    window.electronAPI.summarization
      .generate(viewingSessionId)
      .then(() => {
        setSummaryLoading(viewingSessionId, false);
      })
      .catch(() => {
        setSummaryLoading(viewingSessionId, false);
      });
  }, [viewingSessionId, setSummaryLoading]);

  const tabs = [
    { id: "topics" as const, label: "Topics", icon: Hash },
    { id: "actions" as const, label: "Actions", icon: CheckSquare },
    { id: "summary" as const, label: "Summary", icon: FileText },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">
          Meeting Intelligence
        </h2>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-muted/30">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              tab === id
                ? "border-b-2 border-primary text-foreground bg-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "topics" && (
          <div className="space-y-2">
            {topics.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <Hash className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  No topics yet
                </p>
                <p className="text-xs text-muted-foreground">
                  Topics will appear as the conversation develops
                </p>
              </div>
            )}
            {topics.map((topic, i) => (
              <div
                key={i}
                className="px-3 py-2 text-sm bg-accent/50 hover:bg-accent border border-border rounded-lg transition-colors"
              >
                {topic}
              </div>
            ))}
          </div>
        )}
        {tab === "actions" && (
          <div className="space-y-2">
            {actionItems.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <CheckSquare className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  No action items yet
                </p>
                <p className="text-xs text-muted-foreground">
                  Action items will be extracted during the meeting
                </p>
              </div>
            )}
            {actionItems.map((item, i) => (
              <div
                key={i}
                className="px-3 py-2 text-sm bg-accent/50 hover:bg-accent border border-border rounded-lg transition-colors"
              >
                <div className="flex items-start gap-2">
                  <CheckSquare className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground">{item.text}</p>
                    {item.assignee && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Assigned to: {item.assignee}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === "summary" && (
          <SummaryPanel
            summary={summary}
            isGenerating={isGenerating}
            onGenerate={isSessionActive ? undefined : handleGenerate}
          />
        )}
      </div>
    </div>
  );
}
