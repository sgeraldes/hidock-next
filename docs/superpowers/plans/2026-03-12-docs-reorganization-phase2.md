# docs/ Reorganization Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `docs/` — move 29 loose root files into subdirectories, merge 3 fragmented hardware folders, fold tiny single-file dirs, archive stale content, and consolidate 3 duplicate indexes into one README.md.

**Architecture:** Six sequential tasks: (1) archive stale docs, (2) merge hardware folders, (3) fold tiny dirs, (4) move root files to subdirectories, (5) absorb `plans/` into `planning/completed/`, (6) consolidate indexes and update README.md. All `git mv` operations to preserve history. One commit per task.

**Tech Stack:** Git, bash

**Spec:** `docs/superpowers/specs/2026-03-12-docs-reorganization-phase2-design.md`

---

## Chunk 1: Archive stale docs and merge hardware folders

### Task 1: Archive stale docs

**Files:**
- Move to archive: `docs/cleanup/`, `docs/session-logs/`

- [ ] **Step 1: Create archive subdirectory**

```bash
cd G:/Code/hidock-next
mkdir -p archive/docs
```

- [ ] **Step 2: Move stale directories to archive**

```bash
cd G:/Code/hidock-next
# cleanup/ — 4 old cleanup plan files
cp -r docs/cleanup archive/docs/cleanup
git rm -r docs/cleanup

# session-logs/ — 3 dated session .txt files
cp -r docs/session-logs archive/docs/session-logs
git rm -r docs/session-logs
```

Note: `cp` then `git rm` because the archive is gitignored — `git mv` would lose them. We copy first to preserve, then `git rm` to remove from tracking.

- [ ] **Step 3: Verify**

```bash
ls archive/docs/cleanup/ && echo "cleanup archived"
ls archive/docs/session-logs/ && echo "session-logs archived"
git status --short | grep cleanup
git status --short | grep session-logs
```

Expected: archive dirs have content, git status shows `D` (deleted) for the tracked files.

- [ ] **Step 4: Commit**

```bash
cd G:/Code/hidock-next
git add -u docs/cleanup docs/session-logs
git commit -m "chore: archive stale docs — cleanup/ and session-logs/

Old cleanup plans and dated session logs moved to archive/.
These documents have served their purpose."
```

---

### Task 2: Merge hardware documentation folders

**Files:**
- `docs/analysis-reports/` (12 files) → `docs/hardware/`
- `docs/firmware-analysis/` (4 files) → `docs/hardware/`
- `docs/hardware-analysis/` (2 files) → `docs/hardware/`

- [ ] **Step 1: Create target directory**

```bash
mkdir -p G:/Code/hidock-next/docs/hardware
```

- [ ] **Step 2: Move all three source directories via git mv**

```bash
cd G:/Code/hidock-next

# Move analysis-reports/ contents
for f in docs/analysis-reports/*; do
  git mv "$f" docs/hardware/
done

# Move firmware-analysis/ contents
for f in docs/firmware-analysis/*; do
  git mv "$f" docs/hardware/
done

# Move hardware-analysis/ contents
for f in docs/hardware-analysis/*; do
  git mv "$f" docs/hardware/
done
```

- [ ] **Step 3: Remove empty source directories**

```bash
cd G:/Code/hidock-next
rmdir docs/analysis-reports docs/firmware-analysis docs/hardware-analysis 2>/dev/null || true
```

(git rm already removed tracked files; rmdir cleans up empty dirs)

- [ ] **Step 4: Verify**

```bash
ls docs/hardware/ | wc -l
ls docs/analysis-reports/ 2>/dev/null && echo "ERROR" || echo "OK: gone"
ls docs/firmware-analysis/ 2>/dev/null && echo "ERROR" || echo "OK: gone"
ls docs/hardware-analysis/ 2>/dev/null && echo "ERROR" || echo "OK: gone"
```

Expected: ~18 files in hardware/, three source dirs gone.

- [ ] **Step 5: Commit**

```bash
cd G:/Code/hidock-next
git commit -m "refactor: merge hardware docs — analysis-reports/ + firmware-analysis/ + hardware-analysis/ → hardware/

Three separate folders covering the same topic consolidated into docs/hardware/."
```

---

## Chunk 2: Fold tiny dirs and move root files

### Task 3: Fold single-file directories

**Files:**
- `docs/accessibility/library-audit-report.md` → `docs/qa/`
- `docs/performance/library-baseline.md` → `docs/qa/`
- `docs/getting-started/QUICK_START.md` → `docs/development/`

- [ ] **Step 1: Move files via git mv**

```bash
cd G:/Code/hidock-next
git mv docs/accessibility/library-audit-report.md docs/qa/library-audit-report.md
git mv docs/performance/library-baseline.md docs/qa/library-baseline.md
git mv docs/getting-started/QUICK_START.md docs/development/QUICK_START.md
```

- [ ] **Step 2: Remove empty directories**

```bash
rmdir docs/accessibility docs/performance docs/getting-started 2>/dev/null || true
```

- [ ] **Step 3: Verify**

```bash
ls docs/accessibility/ 2>/dev/null && echo "ERROR" || echo "OK: gone"
ls docs/performance/ 2>/dev/null && echo "ERROR" || echo "OK: gone"
ls docs/getting-started/ 2>/dev/null && echo "ERROR" || echo "OK: gone"
ls docs/qa/library-audit-report.md && echo "moved"
ls docs/qa/library-baseline.md && echo "moved"
ls docs/development/QUICK_START.md && echo "moved"
```

- [ ] **Step 4: Commit**

```bash
cd G:/Code/hidock-next
git commit -m "refactor: fold single-file dirs into parent categories

accessibility/ → qa/, performance/ → qa/, getting-started/ → development/"
```

---

### Task 4: Move root files to subdirectories

**Files:**
- 29 files from `docs/` root → various subdirectories

- [ ] **Step 1: Move development docs**

```bash
cd G:/Code/hidock-next
git mv docs/DEVELOPMENT.md docs/development/
git mv docs/SETUP.md docs/development/
git mv docs/DEPLOYMENT.md docs/development/
git mv docs/API.md docs/development/
git mv docs/PRE-COMMIT.md docs/development/
git mv docs/VENV.md docs/development/
git mv docs/VSCODE_CONFIGURATION.md docs/development/
git mv docs/TESTING.md docs/development/
git mv docs/AGENT_DEFAULT.md docs/development/
git mv docs/TECHNICAL_SPECIFICATION.md docs/development/
git mv docs/CONNECTION_LIFECYCLE.md docs/development/
git mv docs/SECURITY_RECOMMENDATIONS.md docs/development/
```

- [ ] **Step 2: Move desktop docs**

```bash
cd G:/Code/hidock-next
git mv docs/HIDOCK_DESKTOP_DEVELOPMENT.md docs/desktop/
git mv docs/HIDOCK_DESKTOP_TEST_COVERAGE.md docs/desktop/
git mv docs/SETTINGS_AND_TEST_IMPROVEMENTS.md docs/desktop/
git mv docs/WINDOW_GEOMETRY_IMPLEMENTATION.md docs/desktop/
git mv docs/REFERENCE_HIDOCK.md docs/desktop/
git mv docs/hidock-desktop-app.png docs/desktop/
```

- [ ] **Step 3: Move planning docs**

```bash
cd G:/Code/hidock-next
git mv docs/ROADMAP.md docs/planning/
git mv docs/ACCEPTANCE_CRITERIA.md docs/planning/
git mv docs/PROTOCOL_IMPLEMENTATION_PLAN.md docs/planning/
```

- [ ] **Step 4: Move QA docs**

```bash
cd G:/Code/hidock-next
git mv docs/QA_SESSION_20251228.md docs/qa/
git mv docs/TEST_CONTAMINATION_AUDIT_REPORT.md docs/qa/
```

- [ ] **Step 5: Move calendar docs**

```bash
cd G:/Code/hidock-next
git mv docs/CALENDAR_INTEGRATION_GUIDE.md docs/transcription-feature/
git mv docs/CALENDAR_INTEGRATION_INDEX.md docs/transcription-feature/
git mv docs/CALENDAR_OAUTH_FLOWS.md docs/transcription-feature/
git mv docs/CALENDAR_QUICK_START.md docs/transcription-feature/
```

- [ ] **Step 6: Verify root is clean**

```bash
ls docs/*.md docs/*.png 2>/dev/null
```

Expected: only `README.md` and `TROUBLESHOOTING.md` remain.

- [ ] **Step 7: Commit**

```bash
cd G:/Code/hidock-next
git commit -m "refactor: move 29 loose docs/ root files to subdirectories

development/ ← 12 files (setup, testing, API, security, etc.)
desktop/ ← 6 files (HiDock desktop app docs + screenshot)
planning/ ← 3 files (roadmap, acceptance criteria, protocol plan)
qa/ ← 2 files (QA session, test audit)
transcription-feature/ ← 4 files (calendar integration docs)"
```

---

### Task 5: Absorb plans/ into planning/completed/

**Files:**
- `docs/plans/` (3 files) → `docs/planning/completed/`

- [ ] **Step 1: Move files**

```bash
cd G:/Code/hidock-next
for f in docs/plans/*; do
  git mv "$f" docs/planning/completed/
done
```

- [ ] **Step 2: Remove empty dir**

```bash
rmdir docs/plans 2>/dev/null || true
```

- [ ] **Step 3: Verify**

```bash
ls docs/plans/ 2>/dev/null && echo "ERROR" || echo "OK: gone"
ls docs/planning/completed/ | wc -l
```

Expected: plans/ gone, completed/ has 4+ files.

- [ ] **Step 4: Commit**

```bash
cd G:/Code/hidock-next
git commit -m "refactor: absorb docs/plans/ into docs/planning/completed/

Three executed implementation plans moved to their natural home."
```

---

## Chunk 3: Consolidate indexes and update README

### Task 6: Archive duplicate indexes and update README.md

**Files:**
- Archive: `docs/INDEX.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/MASTER_DOCUMENTATION_INDEX.md`, `docs/REPO_REVIEW.md`
- Rewrite: `docs/README.md`

- [ ] **Step 1: Archive the 4 files**

```bash
cd G:/Code/hidock-next
cp docs/INDEX.md archive/docs/INDEX.md
cp docs/DOCUMENTATION_INDEX.md archive/docs/DOCUMENTATION_INDEX.md
cp docs/MASTER_DOCUMENTATION_INDEX.md archive/docs/MASTER_DOCUMENTATION_INDEX.md
cp docs/REPO_REVIEW.md archive/docs/REPO_REVIEW.md

git rm docs/INDEX.md docs/DOCUMENTATION_INDEX.md docs/MASTER_DOCUMENTATION_INDEX.md docs/REPO_REVIEW.md
```

- [ ] **Step 2: Rewrite docs/README.md**

Replace the current README.md with an updated index reflecting the new structure:

```markdown
# Documentation

Documentation for the HiDock Next project.

## Directories

| Directory | Contents |
|-----------|----------|
| [conductor/](conductor/) | AI workflow configuration, code styleguides, product guidelines |
| [desktop/](desktop/) | Desktop app (Python/CustomTkinter) — development, testing, features |
| [development/](development/) | Developer guides — setup, API, testing, security, IDE config |
| [hardware/](hardware/) | Hardware and firmware analysis — protocol research, device specs |
| [implementation-guides/](implementation-guides/) | Technical implementation guides — Jensen protocol, USB access |
| [planning/](planning/) | Roadmap, acceptance criteria, backlog, completed plans |
| [qa/](qa/) | QA protocols, test plans, accessibility and performance audits |
| [specs/](specs/) | Product specifications — Library, Assistant, Calendar, Sync, etc. |
| [superpowers/](superpowers/) | Active development specs and plans |
| [transcription-feature/](transcription-feature/) | Calendar integration, OAuth flows, HiNotes authentication |

## Quick Links

- [Troubleshooting](TROUBLESHOOTING.md) — common issues and solutions
- [Quick Start](development/QUICK_START.md) — get up and running
- [Setup Guide](development/SETUP.md) — detailed installation
- [Development Guide](development/DEVELOPMENT.md) — developer workflow
- [Testing Guide](development/TESTING.md) — test framework and markers
- [Contributing](../CONTRIBUTING.md) — contribution guidelines
```

- [ ] **Step 3: Verify docs/ root has only 2 files + subdirs**

```bash
ls docs/*.md docs/*.png 2>/dev/null
```

Expected: `docs/README.md` and `docs/TROUBLESHOOTING.md` only.

- [ ] **Step 4: Commit**

```bash
cd G:/Code/hidock-next
git add docs/README.md
git add -u docs/INDEX.md docs/DOCUMENTATION_INDEX.md docs/MASTER_DOCUMENTATION_INDEX.md docs/REPO_REVIEW.md
git commit -m "chore: consolidate 3 duplicate indexes into single README.md

Archived INDEX.md, DOCUMENTATION_INDEX.md, MASTER_DOCUMENTATION_INDEX.md,
and REPO_REVIEW.md. Updated README.md as the single docs entry point
reflecting the reorganized directory structure."
```

---

## Final Verification

- [ ] **docs/ root has only README.md, TROUBLESHOOTING.md, and subdirectories**

```bash
ls docs/*.md docs/*.png 2>/dev/null
```

Expected: only `README.md` and `TROUBLESHOOTING.md`.

- [ ] **Old folders are gone**

```bash
for d in analysis-reports firmware-analysis hardware-analysis accessibility performance getting-started plans cleanup session-logs; do
  ls docs/$d/ 2>/dev/null && echo "FAIL: $d still exists" || echo "PASS: $d gone"
done
```

- [ ] **New hardware/ folder has merged content**

```bash
ls docs/hardware/ | wc -l
```

Expected: ~18 files.

- [ ] **No stale cross-references**

```bash
cd G:/Code/hidock-next
grep -r "analysis-reports/\|firmware-analysis/\|hardware-analysis/\|getting-started/\|docs/plans/" docs/ --include="*.md" -l 2>/dev/null | grep -v archive/
```

Expected: only the spec/plan files (which document the move itself). Fix any others.

- [ ] **Run electron tests**

```bash
cd G:/Code/hidock-next/apps/electron && npm run test:run
```

Expected: all tests pass (no source code was modified).
