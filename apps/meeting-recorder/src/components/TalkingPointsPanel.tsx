interface TalkingPoint {
  topic: string;
  firstMentionedMs: number;
}

interface TalkingPointsPanelProps {
  topics: TalkingPoint[];
  onTopicClick: (timestampMs: number) => void;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function TalkingPointsPanel({
  topics,
  onTopicClick,
}: TalkingPointsPanelProps) {
  if (topics.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No topics detected yet
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {topics.map((tp, i) => (
        <button
          key={i}
          onClick={() => onTopicClick(tp.firstMentionedMs)}
          className="flex items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-muted"
        >
          <span className="text-card-foreground">{tp.topic}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {formatTimestamp(tp.firstMentionedMs)}
          </span>
        </button>
      ))}
    </div>
  );
}
