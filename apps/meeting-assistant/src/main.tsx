import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./globals.css";
import { ThemeProvider } from "./components/providers/ThemeProvider";
import { ToastProvider } from "./components/providers/ToastProvider";
import { initAppStore } from "./stores";

const appStoreCleanup = initAppStore();
window.addEventListener("beforeunload", () => appStoreCleanup());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider />
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
