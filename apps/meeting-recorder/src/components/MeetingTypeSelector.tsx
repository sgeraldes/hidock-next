interface MeetingTypeItem {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
}

interface MeetingTypeSelectorProps {
  meetingTypes: MeetingTypeItem[];
  selectedTypeId: string | null;
  onSelect: (typeId: string | null) => void;
}

export default function MeetingTypeSelector({
  meetingTypes,
  selectedTypeId,
  onSelect,
}: MeetingTypeSelectorProps) {
  return (
    <select
      value={selectedTypeId ?? ""}
      onChange={(e) => onSelect(e.target.value || null)}
      className="rounded border border-input bg-card px-2 py-1 text-sm text-card-foreground"
    >
      <option value="">None</option>
      {meetingTypes.map((mt) => (
        <option key={mt.id} value={mt.id}>
          {mt.name}
        </option>
      ))}
    </select>
  );
}
