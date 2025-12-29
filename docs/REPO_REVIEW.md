# Repository Review & Architecture Report

**Date:** 2025-12-28
**Scope:** Full Repository Analysis

---

## 1. Directory Organization

The repository follows a **Monorepo** structure, housing multiple applications and shared resources.

### Root Level
*   `apps/`: Core application logic.
    *   `electron/`: The primary Desktop product (Electron + React + TypeScript).
    *   `web/`: A browser-based version (React + WebUSB).
    *   `desktop/`: A Python/CustomTkinter desktop application (likely legacy or alternative).
    *   `audio/` & `audio-insights/`: Service/Utility modules.
*   `conductor/`: Project management and AI context files.
*   `config/`: Shared configuration.
*   `docs/`: Extensive project documentation.
*   `firmware/`: Device firmware files.
*   `scripts/`: DevOps and utility scripts.
*   `tests/`: Integration/E2E tests.

### Key Sub-Structures
*   **Electron (`apps/electron`):** Follows `electron-vite` pattern.
    *   `electron/`: Main process code (`main`, `preload`).
    *   `src/`: Renderer process code (React).
*   **Web (`apps/web`):** Standard Vite+React structure.
*   **Desktop (`apps/desktop`):** Standard Python structure (`src`, `tests`, `.venv`).

---

## 2. File Naming & Consistency

**Status:** Mostly Consistent (B+)

*   **Directories:** `kebab-case` (e.g., `audio-insights`, `setup_support`).
*   **React Components:** `PascalCase` (e.g., `Recordings.tsx`, `Chat.tsx`).
*   **Configuration:** Standard names (`package.json`, `tsconfig.json`).
*   **Python:** `snake_case` (e.g., `hidock_bootstrap.py`).

**Anomalies:**
*   `apps/web/jensen.js`: Logic file in root. Should be moved to `src/lib/` or `src/services/`.
*   `apps/web/anillo.png`: Asset file in root. Should be moved to `src/assets/` or `public/`.
*   `apps/electron/nul`: Likely a zero-byte artifact from a Windows command redirection error.
*   Root `*.png` / `*.png.encrypted`: QA screenshots cluttering the root.

---

## 3. Architectural Patterns

### Electron App (`apps/electron`)
*   **Pattern:** **Multi-Process Model** with IPC Bridge.
*   **Main Process:** Handles system operations (USB, File I/O), AI Orchestration (`transcription`, `ollama`), and Database (`sql.js` wrapper).
*   **Renderer Process:** **Flux-like** state management via **Zustand**.
    *   UI: **Component-Based** (React + Radix UI + Tailwind).
    *   Routing: `react-router-dom`.
*   **Communication:** Context Isolation enabled. API exposed via `window.electronAPI`.

### Web App (`apps/web`)
*   **Pattern:** **SPA** (Single Page Application).
*   **Device Access:** Direct **WebUSB** (via `jensen.js` implementation).
*   **State:** **Zustand**.

### Python App (`apps/desktop`)
*   **Pattern:** **MVC** (likely, given `src` structure with UI logic).
*   **GUI:** **CustomTkinter**.

---

## 4. Key Module Dependencies

### Electron (`apps/electron`)
*   **Core:** `electron`, `react`, `typescript`, `vite`.
*   **State:** `zustand`.
*   **UI:** `tailwindcss`, `lucide-react`, `@radix-ui/*`, `@tanstack/react-virtual`.
*   **AI:** `ollama`, `@google/generative-ai`.
*   **Data:** `sql.js`, `ical.js` (Calendar).
*   **Utils:** `date-fns`, `uuid`, `zod`.

### Web (`apps/web`)
*   **Core:** `react`, `vite`.
*   **State:** `zustand`.
*   **UI:** `tailwindcss`, `lucide-react`.
*   **AI:** `@google/generative-ai`.

---

## 5. Cleanup Candidates & Maintenance

### Immediate Actions
1.  **Move QA Artifacts:** Create `qa-artifacts/` or `tests/results/` and move all root `*.png`, `*.png.encrypted` files there.
2.  **Delete Garbage Files:**
    *   `apps/electron/nul`
    *   `desktop.ini` (System files)
3.  **Refactor `apps/web`:**
    *   Move `jensen.js` -> `src/lib/jensen.js`.
    *   Move `anillo.png` -> `src/assets/anillo.png` or `public/`.
4.  **Ignore Logs:** Ensure root `*.log` files are covered by `.gitignore`.

### .gitignore Recommendations
Add the following if not present:
```gitignore
# QA Artifacts
*.png.encrypted
/qa-artifacts/
/docs/qa/screenshots/*.encrypted

# System
[Dd]esktop.ini

# Windows Redirection Artifacts
nul
```

---

## 6. Conclusion

The repository is well-structured for a complex monorepo. The separation of concerns between the Electron main process (Services) and renderer (UI) is clean. The primary technical debt lies in file organization at the root of `apps/web` and the accumulation of QA artifacts in the project root.
