import type { ReactNode } from "react";

interface AppLayoutProps {
  sidebar?: ReactNode;
  main: ReactNode;
  rightPanel?: ReactNode;
}

export function AppLayout({ sidebar, main, rightPanel }: AppLayoutProps) {
  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
      {sidebar && <div className="shrink-0">{sidebar}</div>}

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        {main}
      </main>

      {rightPanel && (
        <aside className="w-80 border-l border-border flex flex-col shrink-0 overflow-hidden bg-card">
          {rightPanel}
        </aside>
      )}
    </div>
  );
}
