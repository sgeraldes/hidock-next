# Dead Code Audit Phase 3 - Design Spec

**Date:** 2026-03-12
**Status:** Approved
**Scope:** Phase 3 - Remove dead code, duplicate files, and build artifacts identified by comprehensive audit

---

## Problem

A full codebase audit identified tracked build artifacts, duplicate firmware binaries, duplicated research utility files, and minor gitignore gaps. These waste repository space, confuse contributors, and pollute `git status`.

---

## Findings

### 1. Electron build artifacts tracked in git

Three compiled files in `apps/electron/out/` are tracked despite `out/` being in both the root `.gitignore` (`**/out/`) and `apps/electron/.gitignore`. They were committed before the ignore rules existed.

| File | Size |
|------|------|
| `apps/electron/out/main/index.js` | 387 KB |
| `apps/electron/out/preload/index.js` | (build artifact) |
| `apps/electron/out/preload/splash.js` | (build artifact) |

Additionally, `apps/electron/tsconfig.web.tsbuildinfo` is tracked — this is a TypeScript incremental build cache file that should be gitignored.

**Action:** `git rm --cached` to untrack without deleting local copies. Add `*.tsbuildinfo` to root `.gitignore`.

### 2. Duplicate firmware directories

`firmware/h1/` and `firmware/h1e/` are legacy paths superseded by the properly named `firmware/hidock-h1/` and `firmware/hidock-h1e/` directories:

| Legacy | Canonical | Relationship |
|--------|-----------|-------------|
| `firmware/h1/5.2.4/35a48a6c1a7b4909abf51ca48275da55.bin` (4.1 MB) | `firmware/hidock-h1/5.2.4/firmware-metadata.json` | Legacy has raw binary, canonical has metadata pointing to it |
| `firmware/h1e/6.2.5/20ec7c710a9945428a5d3f0d904876c2.bin` (3.5 MB) | `firmware/hidock-h1e/6.2.5/20ec7c710a9945428a5d3f0d904876c2.bin` | **Identical file** (confirmed by binary diff) |

No code or documentation references `firmware/h1/` or `firmware/h1e/`.

**Action:** Archive `firmware/h1/` and `firmware/h1e/` (copy to archive, then `git rm`). These are binary blobs that shouldn't be in git long-term, but the canonical `hidock-*` dirs already have them or their metadata.

### 3. Duplicated research utility files

Three research directories contain copied utility modules:

| File | Locations | Status |
|------|-----------|--------|
| `safe_testing_framework.py` | `command-10-discovery/`, `command-14-15-discovery/` (identical), `command-tester-gui/` (6 lines different) | 2 of 3 identical |
| `parameter_generators.py` | `command-10-discovery/`, `command-14-15-discovery/`, `command-tester-gui/` (all identical) | 3 of 3 identical |

**Action:** Extract shared modules to `research/_shared/`, replace duplicates with imports. This is a low-priority cleanup — research code is not production.

### 4. Electron dead code assessment

| Item | Status | Action |
|------|--------|--------|
| `quality-handlers.ts` | Registered IPC handler, exposed in preload, but no UI consumer yet | **KEEP** — planned P2 feature |
| `quality-assessment.ts` | Used by quality-handlers and storage-policy | **KEEP** — active service |
| `useAppStore.ts` | Deprecated but still imported by 13+ components | **KEEP** — migration is separate work |

No electron code needs deletion.

### 5. Root setup scripts

| File | Status |
|------|--------|
| `setup-windows.bat` | Convenience wrapper calling `python setup.py` — still useful for Windows users |
| `setup-unix.sh` | Convenience wrapper calling `python setup.py` — still useful for Unix users |

**Action:** KEEP both. User explicitly stated scripts are for convenience.

---

## Scope of Changes

### In scope
1. Untrack electron build artifacts (`git rm --cached`)
2. Add `*.tsbuildinfo` to `.gitignore`
3. Archive duplicate firmware directories (`firmware/h1/`, `firmware/h1e/`)
4. Deduplicate research utility files into `research/_shared/`

### Out of scope
- Electron quality-handlers / quality-assessment (planned features, keep)
- useAppStore migration (separate task, tracked elsewhere)
- Root setup scripts (convenience scripts, keep)
- Desktop/web/meeting-recorder code (no dead code found)

---

## Acceptance Criteria

- [ ] `git ls-files apps/electron/out/` returns empty
- [ ] `git ls-files apps/electron/tsconfig.web.tsbuildinfo` returns empty
- [ ] `*.tsbuildinfo` is in `.gitignore`
- [ ] `firmware/h1/` and `firmware/h1e/` no longer tracked in git
- [ ] `archive/firmware/` contains the archived firmware binaries
- [ ] `research/_shared/safe_testing_framework.py` exists
- [ ] `research/_shared/parameter_generators.py` exists
- [ ] Duplicate copies in research subdirectories replaced with imports
- [ ] All existing tests pass (`cd apps/electron && npm run test:run`)
