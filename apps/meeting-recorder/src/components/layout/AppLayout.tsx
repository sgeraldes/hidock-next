import { type ReactNode, useState, useCallback, useRef } from "react";

interface AppLayoutProps {
  sidebar?: ReactNode;
  main: ReactNode;
  rightPanel?: ReactNode;
}

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 400;
const DEFAULT_SIDEBAR = 256;

const MIN_RIGHT = 240;
const MAX_RIGHT = 480;
const DEFAULT_RIGHT = 320;

function ResizeHandle({
  onDrag,
}: {
  onDrag: (deltaX: number) => void;
}) {
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      lastXRef.current = e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return;
        const delta = ev.clientX - lastXRef.current;
        lastXRef.current = ev.clientX;
        onDrag(delta);
      };

      const onMouseUp = () => {
        draggingRef.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onDrag],
  );

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
    />
  );
}

export function AppLayout({ sidebar, main, rightPanel }: AppLayoutProps) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT);

  const handleSidebarDrag = useCallback((deltaX: number) => {
    setSidebarWidth((w) => Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, w + deltaX)));
  }, []);

  const handleRightDrag = useCallback((deltaX: number) => {
    // Dragging right makes the panel smaller, dragging left makes it larger
    setRightWidth((w) => Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, w - deltaX)));
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
      {sidebar && (
        <>
          <div className="shrink-0 overflow-hidden" style={{ width: sidebarWidth }}>
            {sidebar}
          </div>
          <ResizeHandle onDrag={handleSidebarDrag} />
        </>
      )}

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        {main}
      </main>

      {rightPanel && (
        <>
          <ResizeHandle onDrag={handleRightDrag} />
          <aside
            className="border-l border-border flex flex-col shrink-0 overflow-hidden bg-card"
            style={{ width: rightWidth }}
          >
            {rightPanel}
          </aside>
        </>
      )}
    </div>
  );
}
