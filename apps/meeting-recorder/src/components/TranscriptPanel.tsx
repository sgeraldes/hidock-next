import { useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Mic, Settings as SettingsIcon } from "lucide-react";

interface TranscriptSegment {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
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
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);

  const speakers = Array.from(new Set(segments.map((s) => s.speaker)));

  const hasInterim = interimResult != null && interimResult.text.length > 0;
  const totalCount = segments.length + (hasInterim ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => 72, []),
    overscan: 5,
  });

  useEffect(() => {
    if (isAutoScrolling.current && totalCount > 0) {
      virtualizer.scrollToIndex(totalCount - 1, { align: "end" });
    }
  }, [totalCount, virtualizer]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    isAutoScrolling.current = isAtBottom;
  }

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
                className={`flex gap-3 p-2 rounded mb-3 ${SENTIMENT_ICONS[segment.sentiment] ?? ""}`}
              >
                <span className="text-xs text-muted-foreground font-mono w-10 shrink-0 pt-0.5">
                  {segment.timestamp}
                </span>
                <div className="flex-1">
                  <span
                    className={`text-sm font-semibold ${getSpeakerColor(segment.speaker, speakers)}`}
                  >
                    {segment.speaker}
                  </span>
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
  );
}
