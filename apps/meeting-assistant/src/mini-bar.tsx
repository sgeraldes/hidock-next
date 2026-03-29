import React from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";

function MiniBar() {
  return (
    <div className="flex items-center justify-center h-full w-full bg-sidebar text-sidebar-foreground text-sm px-3 py-2 rounded-lg">
      <span>Meeting Assistant</span>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MiniBar />
  </React.StrictMode>,
);
