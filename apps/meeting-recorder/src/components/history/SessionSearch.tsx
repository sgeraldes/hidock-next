interface SessionSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
}

export default function SessionSearch({
  query,
  onQueryChange,
}: SessionSearchProps) {
  return (
    <div className="px-4 py-2">
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search sessions..."
        className="w-full rounded border border-input bg-card px-3 py-1.5 text-sm text-card-foreground placeholder:text-muted-foreground"
      />
    </div>
  );
}
