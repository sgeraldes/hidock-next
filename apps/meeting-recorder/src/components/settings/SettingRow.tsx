interface SettingRowProps {
  icon: React.ElementType;
  label: string;
  description: string;
  control: React.ReactNode;
}

export function SettingRow({ icon: Icon, label, description, control }: SettingRowProps) {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="w-8 h-8 rounded-full bg-accent/50 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
