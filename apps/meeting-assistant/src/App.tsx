import { Routes, Route, NavLink, Outlet } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Sessions from "./pages/Sessions";
import Notes from "./pages/Notes";
import KnowledgeBase from "./pages/KnowledgeBase";
import Settings from "./pages/Settings";

function Sidebar() {
  const navItems = [
    { to: "/", label: "Dashboard", end: true },
    { to: "/sessions", label: "Sessions" },
    { to: "/notes", label: "Notes" },
    { to: "/knowledge-base", label: "Knowledge Base" },
    { to: "/settings", label: "Settings" },
  ];

  return (
    <nav className="flex flex-col w-56 shrink-0 h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="px-4 py-5 border-b border-sidebar-border">
        <h1 className="text-base font-semibold tracking-tight">Meeting Assistant</h1>
      </div>
      <ul className="flex flex-col gap-1 p-2 flex-1">
        {navItems.map(({ to, label, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                ].join(" ")
              }
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ShellLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 min-w-0 min-h-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<ShellLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/knowledge-base" element={<KnowledgeBase />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
