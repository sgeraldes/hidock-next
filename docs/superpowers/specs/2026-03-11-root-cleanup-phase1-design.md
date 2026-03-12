# Root Cleanup — Phase 1 Design Spec

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Phase 1 — root-level clutter only (docs/ reorganization is Phase 2, dead code audit is Phase 3)

---

## Problem

The repository root contains a mix of committed source directories and accumulated local clutter: personal files, one-off scripts, development-session screenshots, log files, and audio recordings. This makes the root harder to navigate and risks personal data being accidentally committed in the future.

---

## Design

### What moves to `archive/`

Create `archive/root-clutter/` as a local-only holding area. The following files are moved there (none are tracked in git):

| File/Dir | Type |
|---|---|
| `Sebastian Geraldes Calendar.ics` | Personal calendar export |
| `fix_library.py` | One-off dev script |
| `spec_writer.py` | One-off dev script |
| `spec_writer.js` | One-off dev script |
| `electron_app.log` | Runtime log |
| `audio/` | WAV recording files |
| `app-after-npm-install.png` | QA screenshot |
| `app-running.png` | QA screenshot |
| `discovery-01-library-initial.png` | QA screenshot |
| `library-after-changes.png` | QA screenshot |
| `library-desktop-wide.png` | QA screenshot |
| `library-initial.png` | QA screenshot |
| `library-narrow-500px.png` | QA screenshot |
| `library-narrow-600px.png` | QA screenshot |
| `library-working.png` | QA screenshot |
| `phase1-test-home.png` | QA screenshot |
| `phase1-test-library.png` | QA screenshot |

`archive/` is added to `.gitignore` so its contents are never committed.

---

### What moves via `git mv`

`conductor/` is moved to `docs/conductor/`. It contains AI workflow configuration and code style guidelines — documentation, not runtime code.

```
conductor/  →  docs/conductor/
```

This preserves full git history via `git mv`.

---

### What stays at root

| Dir | Reason |
|---|---|
| `firmware/` | Device firmware binaries and metadata — hardware artifacts, correctly at root level alongside `apps/` |
| `research/` | USB protocol reverse-engineering and command-discovery tools — active hardware research |

---

### `.gitignore` additions

Add to root `.gitignore` to prevent future accidental commits of these file types:

```
archive/
*.log
*.ics
audio/
```

---

## Files Changed

| File/Dir | Type | Change |
|---|---|---|
| `.gitignore` | Modify | Add `archive/`, `*.log`, `*.ics`, `audio/` |
| `conductor/` | Move | `git mv conductor/ docs/conductor/` |
| `archive/root-clutter/` | Create | Move 17 untracked files here |

---

## Acceptance Criteria

- [ ] `archive/` exists locally and contains the 17 clutter files
- [ ] `archive/` is listed in `.gitignore` and does not appear in `git status` output
- [ ] `conductor/` no longer exists at root; `docs/conductor/` exists with all original files and git history intact
- [ ] `firmware/` and `research/` remain at root, unchanged
- [ ] `*.log`, `*.ics`, `audio/` patterns added to `.gitignore`
- [ ] Root directory is clean: only `apps/`, `docs/`, `firmware/`, `research/`, config files, and standard dotfiles remain
- [ ] All existing tests continue to pass

---

## Out of Scope

- Phase 2: `docs/` reorganization (flatten 28-file root, consolidate indexes, archive dated session docs)
- Phase 3: Dead code audit (run `knip` on electron app, identify unused exports/components/hooks)
