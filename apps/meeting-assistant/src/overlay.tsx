import React from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";
import { ThemeProvider } from "./components/providers/ThemeProvider";
import { ToastProvider } from "./components/providers/ToastProvider";

function Overlay() {
  return (
    <div className="flex items-center justify-center h-full w-full text-foreground text-sm p-4">
      <span>Overlay</span>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider />
      <Overlay />
    </ThemeProvider>
  </React.StrictMode>,
);
