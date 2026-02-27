interface SentimentBadgeProps {
  sentiment: string | null;
}

const COLORS: Record<string, string> = {
  positive: "bg-green-600 text-green-100",
  negative: "bg-red-600 text-red-100",
  neutral: "bg-accent text-accent-foreground",
  mixed: "bg-orange-600 text-orange-100",
};

export default function SentimentBadge({ sentiment }: SentimentBadgeProps) {
  if (!sentiment) return null;

  const colorClass = COLORS[sentiment] ?? "bg-muted text-muted-foreground";

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs ${colorClass}`}
    >
      {sentiment}
    </span>
  );
}
