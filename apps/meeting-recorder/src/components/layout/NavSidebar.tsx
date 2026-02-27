import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Home, Clock, Settings, Moon, Sun } from "lucide-react";

const NAV_SECTIONS = [
  {
    title: "Recording & Sessions",
    items: [
      { to: "/", label: "Dashboard", icon: Home, end: true },
      { to: "/history", label: "History", icon: Clock, end: false },
    ],
  },
  {
    title: "Configuration",
    items: [
      { to: "/settings", label: "Settings", icon: Settings, end: false },
    ],
  },
] as const;

interface NavSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function NavSidebar({ collapsed }: NavSidebarProps) {
  const [darkMode, setDarkMode] = useState(false);

  const toggleTheme = () => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle('dark');
  };

  return (
    <nav
      className={`h-full flex flex-col bg-sidebar border-r border-sidebar-border shrink-0 transition-all duration-300 ${
        collapsed ? "w-12" : "w-60"
      }`}
      aria-label="Main navigation"
    >

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-6">
            <div className="pl-4 pr-2 mb-1 overflow-hidden transition-opacity duration-300" style={{ height: collapsed ? '20px' : 'auto', opacity: collapsed ? 0 : 1 }}>
              <span className="text-xs font-semibold text-sidebar-foreground/80 whitespace-nowrap">
                {section.title}
              </span>
            </div>
            <div className="space-y-0.5">
              {section.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  aria-label={label}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    `flex items-center gap-3 pl-4 pr-3 py-2 rounded-md text-sm transition-colors ${
                      isActive
                        ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                        : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                    }`
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className={`transition-opacity duration-300 ${collapsed ? "opacity-0" : "opacity-100"}`}>{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Theme Toggle */}
      <div className="border-t border-sidebar-border p-2">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-3 w-full pl-4 pr-3 py-2 rounded-md text-sm transition-colors text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
          title={collapsed ? (darkMode ? "Light Mode" : "Dark Mode") : undefined}
        >
          {darkMode ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
          <span className={`transition-opacity duration-300 ${collapsed ? "opacity-0" : "opacity-100"}`}>{darkMode ? "Light Mode" : "Dark Mode"}</span>
        </button>
      </div>
    </nav>
  );
}
