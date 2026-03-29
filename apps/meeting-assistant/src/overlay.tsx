import React from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";

function Overlay() {
  return (
    <div className="flex items-center justify-center h-full w-full text-foreground text-sm p-4">
      <span>Overlay</span>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>,
);
