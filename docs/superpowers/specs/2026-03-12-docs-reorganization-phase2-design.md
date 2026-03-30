# docs/ Reorganization — Phase 2 Design Spec

**Date:** 2026-03-12
**Status:** Approved
**Scope:** Phase 2 — docs/ directory only (root cleanup was Phase 1, dead code audit is Phase 3)

---

## Problem

The `docs/` directory has 33 loose files at root level, 3 duplicate index files, fragmented hardware documentation across 3 separate folders, tiny single-file directories, and stale session/cleanup docs. Navigation is difficult and related content is scattered.

---

## Target Structure

```
docs/
├── README.md              ← consolidated single index (replaces 3 duplicate indexes)
├── TROUBLESHOOTING.md     ← keep at root (quick reference)
├── conductor/             ← moved here in Phase 1
├── desktop/               ← +6 files from root
├── development/           ← +8 files from root, +1 from getting-started/
├── hardware/              ← NEW: merge analysis-reports/ + firmware-analysis/ + hardware-analysis/
├── implementation-guides/ ← unchanged
├── planning/              ← +3 files from root, absorb plans/ into completed/
├── qa/                    ← +2 from root, fold accessibility/ + performance/
├── specs/                 ← unchanged
├── superpowers/           ← unchanged
└── transcription-feature/ ← keep (active), +4 calendar docs from root
```

---

## Root Files → Subdirectories

### To `docs/development/`

| File | Reason |
|---|---|
| `DEVELOPMENT.md` | Dev setup guide |
| `SETUP.md` | Setup instructions |
| `DEPLOYMENT.md` | Deployment guide |
| `API.md` | API reference |
| `PRE-COMMIT.md` | Pre-commit hook config |
| `VENV.md` | Virtual environment docs |
| `VSCODE_CONFIGURATION.md` | IDE setup |
| `TESTING.md` | Test guide |
| `AGENT_DEFAULT.md` | Agent configuration |
| `TECHNICAL_SPECIFICATION.md` | Technical spec |
| `CONNECTION_LIFECYCLE.md` | Connection management |
| `SECURITY_RECOMMENDATIONS.md` | Security guide |

### To `docs/desktop/`

| File | Reason |
|---|---|
| `HIDOCK_DESKTOP_DEVELOPMENT.md` | Desktop app development |
| `HIDOCK_DESKTOP_TEST_COVERAGE.md` | Desktop test coverage |
| `SETTINGS_AND_TEST_IMPROVEMENTS.md` | Desktop settings/tests |
| `WINDOW_GEOMETRY_IMPLEMENTATION.md` | Desktop window management |
| `REFERENCE_HIDOCK.md` | HiDock reference |
| `hidock-desktop-app.png` | Desktop app screenshot |

### To `docs/planning/`

| File | Reason |
|---|---|
| `ROADMAP.md` | Project roadmap |
| `ACCEPTANCE_CRITERIA.md` | Acceptance criteria |
| `PROTOCOL_IMPLEMENTATION_PLAN.md` | Protocol implementation plan |

### To `docs/qa/`

| File | Reason |
|---|---|
| `QA_SESSION_20251228.md` | QA session report |
| `TEST_CONTAMINATION_AUDIT_REPORT.md` | Test audit report |

### To `docs/transcription-feature/`

| File | Reason |
|---|---|
| `CALENDAR_INTEGRATION_GUIDE.md` | Calendar integration guide |
| `CALENDAR_INTEGRATION_INDEX.md` | Calendar integration index |
| `CALENDAR_OAUTH_FLOWS.md` | Calendar OAuth docs |
| `CALENDAR_QUICK_START.md` | Calendar quick start |

---

## Folder Merges

### `analysis-reports/` + `firmware-analysis/` + `hardware-analysis/` → `hardware/`

Create `docs/hardware/` and move all files from the three source directories into it. All three cover the same topic (device hardware and firmware analysis). 18 files total.

### `accessibility/` → `qa/`

Move `accessibility/library-audit-report.md` into `docs/qa/`. Delete empty `accessibility/` dir.

### `performance/` → `qa/`

Move `performance/library-baseline.md` into `docs/qa/`. Delete empty `performance/` dir.

### `getting-started/` → `development/`

Move `getting-started/QUICK_START.md` into `docs/development/`. Delete empty `getting-started/` dir.

### `plans/` → `planning/completed/`

Move all 3 files from `docs/plans/` into `docs/planning/completed/`. Delete empty `plans/` dir.

---

## Archive

Move to `archive/docs/` (already gitignored from Phase 1):

| Source | Reason |
|---|---|
| `docs/cleanup/` (4 files) | Old cleanup plans — work is done |
| `docs/session-logs/` (3 files) | Dated session log .txt files |
| `docs/INDEX.md` | Replaced by consolidated README.md |
| `docs/DOCUMENTATION_INDEX.md` | Replaced by consolidated README.md |
| `docs/MASTER_DOCUMENTATION_INDEX.md` | Replaced by consolidated README.md |
| `docs/REPO_REVIEW.md` | Old repo review — served its purpose |

---

## Consolidate Indexes

Replace the 3 duplicate indexes (`INDEX.md`, `DOCUMENTATION_INDEX.md`, `MASTER_DOCUMENTATION_INDEX.md`) with an updated `docs/README.md` as the single entry point. The README.md should link to each subdirectory with a brief description of what it contains.

---

## Acceptance Criteria

- [ ] docs/ root contains only `README.md`, `TROUBLESHOOTING.md`, and subdirectories
- [ ] All 29 loose root files (excluding README.md and TROUBLESHOOTING.md) moved to appropriate subdirectories
- [ ] `hardware/` exists with merged content from `analysis-reports/`, `firmware-analysis/`, `hardware-analysis/`
- [ ] `analysis-reports/`, `firmware-analysis/`, `hardware-analysis/` no longer exist
- [ ] `accessibility/`, `performance/`, `getting-started/`, `plans/` no longer exist (contents merged elsewhere)
- [ ] `cleanup/` and `session-logs/` moved to `archive/docs/`
- [ ] 3 duplicate index files moved to `archive/docs/`
- [ ] `docs/README.md` is the single consolidated index with links to all subdirectories
- [ ] All `git mv` operations preserve history
- [ ] No stale cross-references to old paths remain
- [ ] All existing tests continue to pass

---

## Out of Scope

- Phase 3: Dead code audit (run `knip` on electron app, identify unused exports/components/hooks)
- Content changes to any documentation file (we only move files, not rewrite them)
- Updating CLAUDE.md references (already handled by Phase 1 conductor/ fix pattern)
