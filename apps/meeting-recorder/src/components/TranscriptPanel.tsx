import { useRef, useEffect, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Mic, Settings as SettingsIcon, Copy, Check } from "lucide-react";
import { useTranscriptStore } from "../store/useTranscriptStore";

interface TranscriptSegment {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  startMs: number;
  sentiment: "positive" | "negative" | "neutral";
}

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  providerConfigured?: boolean;
  translations?: Map<string, string>;
  interimResult?: {
    text: string;
    speaker: string;
    timestamp: string;
  } | null;
  sessionId?: string;
  onRenameSpeaker?: (oldName: string, newName: string) => void;
}

const SPEAKER_COLORS = [
  "text-sky-400",
  "text-green-400",
  "text-purple-400",
  "text-orange-400",
  "text-pink-400",
  "text-cyan-400",
  "text-amber-400",
  "text-red-400",
];

function getSpeakerColor(speaker: string, speakers: string[]): string {
  const index = speakers.indexOf(speaker);
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

const SENTIMENT_ICONS: Record<string, string> = {
  positive: "bg-green-500/20",
  negative: "bg-red-500/20",
  neutral: "",
};

export function TranscriptPanel({
  segments,
  providerConfigured = true,
  translations,
  interimResult,
  sessionId,
  onRenameSpeaker,
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);
  const [copied, setCopied] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [speakerRenames, setSpeakerRenames] = useState<Map<string, string>>(new Map());
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(-1);

  const playbackTimeMs = useTranscriptStore((s) => s.playbackTimeMs);

  const speakers = Array.from(new Set(segments.map((s) => s.speaker)));

  const hasInterim = interimResult != null && interimResult.text.length > 0;
  const totalCount = segments.length + (hasInterim ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => 72, []),
    overscan: 5,
  });

  // Auto-scroll to bottom only when new segments arrive (totalCount increases)
  const prevTotalCount = useRef(totalCount);
  useEffect(() => {
    if (isAutoScrolling.current && totalCount > prevTotalCount.current) {
      virtualizer.scrollToIndex(totalCount - 1, { align: "end" });
    }
    prevTotalCount.current = totalCount;
  }, [totalCount, virtualizer]);

  // Throttled audio-text sync highlighting
  useEffect(() => {
    if (playbackTimeMs === 0 || segments.length === 0) {
      setActiveSegmentIndex(-1);
      return;
    }

    // Throttle to 250ms (4 updates/sec)
    const interval = setInterval(() => {
      // Binary search for active segment
      let index = -1;
      for (let i = 0; i < segments.length; i++) {
        if (segments[i].startMs <= playbackTimeMs) {
          index = i;
        } else {
          break;
        }
      }
      setActiveSegmentIndex(index);
    }, 250);

    return () => clearInterval(interval);
  }, [playbackTimeMs, segments]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    isAutoScrolling.current = isAtBottom;
  }

  const handleCopyToClipboard = async () => {
    const formatted = segments
      .map((seg) => {
        const displayName = speakerRenames.get(seg.speaker) || seg.speaker;
        return `[${seg.timestamp}] ${displayName}: ${seg.text}`;
      })
      .join("\n");

    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  const handleSpeakerClick = (speaker: string) => {
    setEditingSpeaker(speaker);
  };

  const handleSpeakerRename = (oldName: string, newName: string) => {
    if (newName.trim() && newName !== oldName) {
      // Update local renames
      const newRenames = new Map(speakerRenames);
      newRenames.set(oldName, newName);
      setSpeakerRenames(newRenames);

      // Call IPC if available
      if (onRenameSpeaker && sessionId) {
        onRenameSpeaker(oldName, newName);
      }
    }
    setEditingSpeaker(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, oldName: string) => {
    if (e.key === "Enter") {
      handleSpeakerRename(oldName, e.currentTarget.value);
    } else if (e.key === "Escape") {
      setEditingSpeaker(null);
    }
  };

  if (!providerConfigured) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <div className="w-16 h-16 rounded-full bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center mx-auto mb-4">
            <SettingsIcon className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-2">
            Configure AI Provider
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            Set up your preferred AI provider in Settings to enable real-time transcription.
          </p>
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
          >
            <SettingsIcon className="w-4 h-4" />
            Open Settings
          </Link>
        </div>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Mic className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-2">
            Ready to Record
          </p>
          <p className="text-sm text-muted-foreground">
            Start recording to see real-time transcription. Your conversation will appear here as it happens.
          </p>
        </div>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex-1 min-h-0 relative flex flex-col">
      {/* Copy button - only show when segments exist */}
      {segments.length > 0 && (
        <div className="absolute top-2 right-2 z-10">
          <button
            onClick={handleCopyToClipboard}
            title={copied ? "Copied!" : "Copy transcript to clipboard"}
            className="w-8 h-8 flex items-center justify-center rounded bg-card hover:bg-accent border border-border transition-colors"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-600" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4"
        onScroll={handleScroll}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
        {virtualItems.map((virtualItem) => {
          const isInterimRow = hasInterim && virtualItem.index === segments.length;
          const segment = isInterimRow ? null : segments[virtualItem.index];

          if (isInterimRow && interimResult) {
            return (
              <div
                key="interim"
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div className="flex gap-3 p-2 rounded mb-3">
                  <span className="text-xs text-muted-foreground font-mono w-10 shrink-0 pt-0.5">
                    {interimResult.timestamp}
                  </span>
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-muted-foreground/60">
                      {interimResult.speaker}
                    </span>
                    <p className="text-sm text-muted-foreground italic mt-0.5 transition-opacity duration-150">
                      {interimResult.text}
                      <span className="inline-block w-0.5 h-3.5 bg-muted-foreground/40 ml-0.5 animate-pulse align-text-bottom" />
                    </p>
                  </div>
                </div>
              </div>
            );
          }

          if (!segment) return null;

          const isActive = virtualItem.index === activeSegmentIndex && playbackTimeMs > 0;
          const displayName = speakerRenames.get(segment.speaker) || segment.speaker;

          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <div
                data-active={isActive ? "true" : undefined}
                className={`flex gap-3 p-2 rounded mb-3 ${SENTIMENT_ICONS[segment.sentiment] ?? ""} ${
                  isActive ? "bg-primary/10 ring-1 ring-primary/30" : ""
                }`}
              >
                <span className="text-xs text-muted-foreground font-mono w-10 shrink-0 pt-0.5">
                  {segment.timestamp}
                </span>
                <div className="flex-1">
                  {editingSpeaker === segment.speaker ? (
                    <input
                      type="text"
                      defaultValue={displayName}
                      autoFocus
                      onKeyDown={(e) => handleKeyDown(e, segment.speaker)}
                      onBlur={(e) => handleSpeakerRename(segment.speaker, e.target.value)}
                      className="text-sm font-semibold bg-background text-foreground border-2 border-primary rounded px-2 py-1 mb-1 outline-none ring-2 ring-primary/50 w-40"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      onClick={() => handleSpeakerClick(segment.speaker)}
                      className={`text-sm font-semibold cursor-pointer hover:underline ${getSpeakerColor(segment.speaker, speakers)}`}
                    >
                      {displayName}
                    </span>
                  )}
                  <p className="text-sm text-foreground mt-0.5">
                    {segment.text}
                  </p>
                  {translations?.get(segment.id) && (
                    <p className="text-sm text-muted-foreground mt-0.5 italic">
                      {translations.get(segment.id)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
