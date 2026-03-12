# Root Cleanup Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move root-level clutter to `archive/`, relocate `conductor/` to `docs/conductor/`, and close any `.gitignore` gaps so the root stays clean permanently.

**Architecture:** Three sequential tasks: (1) move untracked files to local-only `archive/root-clutter/`, (2) `git mv conductor/` to `docs/conductor/` preserving history, (3) patch `.gitignore` with remaining gaps (`spec_writer.*`, `/*.png`). No code changes — all filesystem and git operations.

**Tech Stack:** Git, bash (Windows/bash shell)

**Spec:** `docs/superpowers/specs/2026-03-11-root-cleanup-phase1-design.md`

**Pre-existing `.gitignore` coverage** (no action needed for these — already present):
- `archive/` — line 42
- `audio/` — line 45
- `*.ics` — line 62
- `fix_*.py` — line 69
- `*.log` — line 118

---

## Chunk 1: Archive untracked clutter

### Task 1: Create archive directory and move untracked files

**Files:**
- Create: `archive/root-clutter/` (local-only, already gitignored via existing `archive/` rule)

- [ ] **Step 1: Verify archive/ is gitignored**

```bash
cd G:/Code/hidock-next
grep "^archive/" .gitignore
```

Expected output: `archive/`
(If not found, stop — something is wrong with the gitignore before we start.)

- [ ] **Step 2: Create archive directory**

```bash
mkdir -p archive/root-clutter
```

- [ ] **Step 3: Move personal and script files**

```bash
mv "Sebastian Geraldes Calendar.ics" archive/root-clutter/ 2>/dev/null || true
mv fix_library.py archive/root-clutter/ 2>/dev/null || true
mv spec_writer.py archive/root-clutter/ 2>/dev/null || true
mv spec_writer.js archive/root-clutter/ 2>/dev/null || true
mv electron_app.log archive/root-clutter/ 2>/dev/null || true
mv SPEC_AUDIT_REPORT.md archive/root-clutter/ 2>/dev/null || true
```

(The `|| true` prevents failure if a file doesn't exist on this machine.)

- [ ] **Step 4: Move audio directory**

```bash
mv audio archive/root-clutter/ 2>/dev/null || true
```

- [ ] **Step 5: Move root screenshot PNGs**

```bash
for f in app-after-npm-install.png app-running.png discovery-01-library-initial.png \
  library-after-changes.png library-desktop-wide.png library-initial.png \
  library-narrow-500px.png library-narrow-600px.png library-working.png \
  phase1-test-home.png phase1-test-library.png; do
  mv "$f" archive/root-clutter/ 2>/dev/null || true
done
```

- [ ] **Step 6: Verify archive contents look right**

```bash
ls archive/root-clutter/
```

Expected: the moved files/directories listed. No error.

- [ ] **Step 7: Verify archive is not tracked by git**

```bash
git status --short | grep archive
```

Expected: no output (archive/ is gitignored, nothing appears in status).

- [ ] **Step 8: Verify root PNG/log/ICS files are gone**

```bash
ls *.png 2>/dev/null || echo "No PNGs at root"
ls *.log 2>/dev/null || echo "No logs at root"
ls *.ics 2>/dev/null || echo "No ICS at root"
```

Expected: all three print the "No X at root" message.

---

## Chunk 2: Relocate conductor/ to docs/conductor/

### Task 2: Move conductor/ into docs/ with git history

**Files:**
- Move: `conductor/` → `docs/conductor/` (via `git mv`)

- [ ] **Step 1: Verify conductor/ is tracked**

```bash
git ls-files conductor/ | head -5
```

Expected: several tracked files listed (styleguides, product docs, etc.).

- [ ] **Step 2: Move using git mv to preserve history**

```bash
git mv conductor docs/conductor
```

- [ ] **Step 3: Verify the move looks correct in git status**

```bash
git status --short | grep conductor
```

Expected: lines starting with `R ` showing renames like:
```
R  conductor/code_styleguides/general.md -> docs/conductor/code_styleguides/general.md
R  conductor/product.md -> docs/conductor/product.md
...
```

- [ ] **Step 4: Verify conductor/ is gone from root and docs/conductor/ exists**

```bash
ls conductor/ 2>/dev/null && echo "ERROR: conductor still at root" || echo "OK: conductor gone from root"
ls docs/conductor/
```

Expected: first command prints "OK: conductor gone from root". Second lists the moved files.

- [ ] **Step 5: Preview staged changes before committing**

```bash
git diff --cached --stat
```

Expected: only renames within conductor/ → docs/conductor/. No unrelated files staged.

- [ ] **Step 6: Commit**

```bash
git add docs/conductor/
git commit -m "refactor: move conductor/ to docs/conductor/

Code styleguides and AI workflow guidelines are documentation,
not runtime code — relocated to docs/ for clarity."
```

---

## Chunk 3: Close gitignore gaps

### Task 3: Add spec_writer.* and /*.png patterns to .gitignore

**Files:**
- Modify: `.gitignore`

Two patterns are missing:
- `spec_writer.*` — covers one-off AI spec generation scripts at root
- `/*.png` — prevents root-level screenshot PNGs from being accidentally committed again (note the leading `/` so it only matches the root, not `docs/` or other subdirs that legitimately have PNGs)

- [ ] **Step 1: Verify these gaps exist**

```bash
grep "spec_writer" .gitignore || echo "spec_writer: gap confirmed"
grep "^\*\.png" .gitignore || echo "*.png: gap confirmed"
grep "^/\*\.png" .gitignore || echo "/*.png: gap confirmed"
```

Expected: all three print "X: gap confirmed".

- [ ] **Step 2: Add spec_writer.* pattern**

Open `.gitignore`. Find the section `# Temporary fix/utility scripts` (around line 68). Add `spec_writer.*` after `fix_*.py`:

```
# Temporary fix/utility scripts
fix_*.py
temp_*.py
spec_writer.*
*.sqlite3
```

- [ ] **Step 3: Add /*.png pattern**

In the same `.gitignore`, find the section `# QA & Automation Artifacts` near the bottom. Add `/*.png` there:

```
# QA & Automation Artifacts
qa-artifacts/
/*.png
*.png.encrypted
/docs/qa/screenshots/*.encrypted
```

The leading `/` means only root-level PNGs are ignored — PNGs in `.github/`, `.playwright-mcp/`, `.wave/`, etc. remain tracked normally.

- [ ] **Step 4: Verify the new patterns work**

```bash
git check-ignore -v --non-matching spec_writer.py spec_writer.js dummy.png 2>/dev/null || true
echo "spec_writer.py" | git check-ignore --stdin -v
echo "screenshot.png" | git check-ignore --stdin -v
```

Expected: `.gitignore` listed as the matching rule for each.

- [ ] **Step 5: Verify existing tracked PNGs are not affected**

```bash
git ls-files "*.png" | head -5
```

Expected: still shows `.github/social_preview.png`, `.playwright-mcp/*.png` etc. — the `/*.png` rule only blocks root-level files and does not remove already-tracked files.

- [ ] **Step 6: Commit**

```bash
git add .gitignore
git commit -m "chore: close gitignore gaps — spec_writer.* and root /*.png

Prevents one-off AI-generated spec scripts and QA screenshots
from being accidentally committed at repo root."
```

---

## Final Verification

- [ ] **Verify root has no loose clutter files**

```bash
# Check for untracked loose files at root (not dirs, not dotfiles, not known config)
git status --short | grep "^??" | grep -v "archive/" | grep -v "apps/" | grep -v "docs/" | grep -v "firmware/" | grep -v "research/"
```

Expected: no output (all clutter is either archived or gitignored).

- [ ] **Verify conductor is gone from root**

```bash
ls conductor/ 2>/dev/null && echo "FAIL" || echo "PASS: no conductor at root"
```

Expected: `PASS: no conductor at root`

- [ ] **Verify docs/conductor exists with content**

```bash
ls docs/conductor/
```

Expected: `code_styleguides/  product-guidelines.md  product.md  setup_state.json  tech-stack.md  tracks/  tracks.md  workflow.md`

- [ ] **Verify git log shows history follows the move**

```bash
git log --oneline --follow docs/conductor/product.md | head -3
```

Expected: at least one commit (the rename commit, and ideally original history if git follows renames).

- [ ] **Run electron tests to confirm no regressions**

```bash
cd apps/electron && npm run test:run
```

Expected: all tests pass (this cleanup touches no source code).
