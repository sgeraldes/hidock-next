# Scaffold apps/meeting-assistant Electron app
## Current State
Nothing exists. Pattern: apps/meeting-recorder
## What to Create
Full electron-vite scaffold:
- package.json (electron, react 18, radix, tailwind, zustand, zod, lucide, sql.js)
- electron.vite.config.ts (main/preload/renderer, 3 HTML entries)
- tsconfig*.json, postcss.config.js, tailwind.config.js
- electron/main/index.ts entry point
- electron/preload/index.ts minimal preload
- src/index.html, mini-bar.html, overlay.html
- src/main.tsx, mini-bar.tsx, overlay.tsx
- src/App.tsx with router (Dashboard, Sessions, Notes, KB, Settings)
- src/globals.css with Tailwind
- Placeholder pages
## Dependencies
None
## Acceptance Criteria
- npm install succeeds
- npm run dev launches Electron app
- All 3 HTML entries exist
- Router navigates between pages
- TypeScript compiles
