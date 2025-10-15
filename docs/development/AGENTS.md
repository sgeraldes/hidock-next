# HiDock Next - Agent Guidelines

## Essential Commands

**Desktop App (Python):** `cd hidock-desktop-app && python3 main.py` | `pytest` (581 tests) | `pytest -k test_name` (single test) | `black . && isort . && flake8 . && mypy .`
**Web App (React/TS):** `cd hidock-web-app && npm run dev` | `npm test` | `npm run build` | `npx tsc --noEmit && npx eslint src --ext .ts,.tsx`
**Audio Insights (React):** `cd audio-insights-extractor && npm run dev` | `npm test` | `npm run build` | `npx tsc --noEmit`

## Architecture

Multi-platform project: **hidock-desktop-app/** (Python/CustomTkinter/PyUSB), **hidock-web-app/** (React 18/Zustand/WebUSB), **audio-insights-extractor/** (React 19/Vite/Gemini). Jensen USB protocol for HiDock device communication. 11 AI providers supported across components. Component-specific rules in each `AGENT.md` file.

## Code Standards

**Line Length:** 120 chars max | **Python:** Black, isort, flake8, mypy, TDD required | **TypeScript:** Strict mode, no `any` types | **React:** CustomTkinter for desktop GUI, Zustand for web state, functional components with hooks | **USB:** Background threads mandatory, never block GUI | **AI:** Multi-provider support, secure API key storage | **Testing:** 80% coverage minimum, comprehensive mocking

## Key Patterns

**Python Classes:** Private methods `_method()`, proper cleanup, exception handling | **React Components:** Props interfaces, useCallback for handlers, useEffect with cleanup | **Error Handling:** Custom exception classes, try/catch with logging | **Device Communication:** Thread-safe USB operations, reconnection support | **Performance:** Desktop <3s startup, Web <2s load, Audio <500ms processing

**Important:** Always check component-specific `AGENT.md` files for detailed rules. Use `python3` not `python`. Run validation commands before commits.
