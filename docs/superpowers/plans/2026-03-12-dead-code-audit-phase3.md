# Dead Code Audit Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove tracked build artifacts, archive duplicate firmware binaries, deduplicate research utilities, and close gitignore gaps identified by the Phase 3 dead code audit.

**Architecture:** Four sequential tasks: (1) untrack electron build artifacts + fix gitignore, (2) archive duplicate firmware directories, (3) deduplicate research shared modules, (4) verify everything. All `git rm --cached` for build artifacts, `cp` + `git rm` for firmware (archive is gitignored). One commit per task.

**Tech Stack:** Git, bash, Python (research imports)

**Spec:** `docs/superpowers/specs/2026-03-12-dead-code-audit-phase3-design.md`

---

## Chunk 1: Untrack build artifacts and archive firmware

### Task 1: Untrack electron build artifacts and fix gitignore

**Files:**
- Modify: `.gitignore` (add `*.tsbuildinfo`)
- Untrack: `apps/electron/out/main/index.js`, `apps/electron/out/preload/index.js`, `apps/electron/out/preload/splash.js`, `apps/electron/tsconfig.web.tsbuildinfo`

- [ ] **Step 1: Add tsbuildinfo to root gitignore**

Add `*.tsbuildinfo` after the existing `*.egg` line in the Build & dependency section of `.gitignore`:

```
*.tsbuildinfo
```

- [ ] **Step 2: Untrack electron build artifacts**

```bash
cd G:/Code/hidock-next
git rm --cached apps/electron/out/main/index.js apps/electron/out/preload/index.js apps/electron/out/preload/splash.js
git rm --cached apps/electron/tsconfig.web.tsbuildinfo
```

- [ ] **Step 3: Verify**

```bash
git ls-files apps/electron/out/
git ls-files apps/electron/tsconfig.web.tsbuildinfo
```

Expected: both commands return empty.

- [ ] **Step 4: Commit**

```bash
cd G:/Code/hidock-next
git add .gitignore
git commit -m "chore: untrack electron build artifacts and add *.tsbuildinfo to gitignore

out/main/index.js, out/preload/index.js, out/preload/splash.js were committed
before the out/ gitignore rule existed. tsconfig.web.tsbuildinfo is an
incremental build cache that should never be tracked."
```

---

### Task 2: Archive duplicate firmware directories

**Files:**
- Archive: `firmware/h1/` (1 binary, 4.1 MB)
- Archive: `firmware/h1e/` (1 binary, 3.5 MB — identical to `firmware/hidock-h1e/` copy)

- [ ] **Step 1: Create archive target**

```bash
cd G:/Code/hidock-next
mkdir -p archive/firmware
```

- [ ] **Step 2: Copy to archive then git rm**

```bash
cd G:/Code/hidock-next
cp -r firmware/h1 archive/firmware/h1
cp -r firmware/h1e archive/firmware/h1e
git rm -r firmware/h1 firmware/h1e
```

- [ ] **Step 3: Remove empty directories if needed**

```bash
rmdir firmware/h1 firmware/h1e 2>/dev/null || true
```

- [ ] **Step 4: Verify**

```bash
ls archive/firmware/h1/5.2.4/ && echo "h1 archived"
ls archive/firmware/h1e/6.2.5/ && echo "h1e archived"
git ls-files firmware/h1/ firmware/h1e/
```

Expected: archive dirs have files, `git ls-files` returns empty.

- [ ] **Step 5: Commit**

```bash
cd G:/Code/hidock-next
git commit -m "chore: archive duplicate firmware directories h1/ and h1e/

These legacy paths are superseded by hidock-h1/ and hidock-h1e/.
h1e binary was byte-identical to the hidock-h1e copy.
h1 binary is referenced by hidock-h1 metadata (same hash)."
```

---

## Chunk 2: Deduplicate research utilities and verify

### Task 3: Deduplicate research shared modules

**Files:**
- Create: `research/_shared/__init__.py`
- Create: `research/_shared/safe_testing_framework.py` (copy from `command-10-discovery/`)
- Create: `research/_shared/parameter_generators.py` (copy from `command-10-discovery/`)
- Modify: `research/command-10-discovery/safe_testing_framework.py` (replace with import shim)
- Modify: `research/command-10-discovery/parameter_generators.py` (replace with import shim)
- Modify: `research/command-14-15-discovery/safe_testing_framework.py` (replace with import shim)
- Modify: `research/command-14-15-discovery/parameter_generators.py` (replace with import shim)
- Modify: `research/command-tester-gui/safe_testing_framework.py` (keep as-is — slightly different version)
- Modify: `research/command-tester-gui/parameter_generators.py` (replace with import shim)

- [ ] **Step 1: Create shared directory**

```bash
cd G:/Code/hidock-next
mkdir -p research/_shared
```

- [ ] **Step 2: Copy canonical versions to shared**

```bash
cd G:/Code/hidock-next
cp research/command-10-discovery/safe_testing_framework.py research/_shared/safe_testing_framework.py
cp research/command-10-discovery/parameter_generators.py research/_shared/parameter_generators.py
touch research/_shared/__init__.py
```

- [ ] **Step 3: Replace identical copies with import shims**

For each identical copy, replace the file content with a re-export shim:

`research/command-10-discovery/safe_testing_framework.py`:
```python
"""Re-export from shared module. Original moved to research/_shared/."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from safe_testing_framework import *  # noqa: F401,F403,E402
```

`research/command-10-discovery/parameter_generators.py`:
```python
"""Re-export from shared module. Original moved to research/_shared/."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from parameter_generators import *  # noqa: F401,F403,E402
```

`research/command-14-15-discovery/safe_testing_framework.py`: same shim as above.

`research/command-14-15-discovery/parameter_generators.py`: same shim as above.

`research/command-tester-gui/parameter_generators.py`: same shim as above.

**Note:** `research/command-tester-gui/safe_testing_framework.py` is slightly different (387 vs 381 lines). Keep it as-is — it's a diverged fork specific to the tester GUI.

- [ ] **Step 4: Verify shims work**

```bash
cd G:/Code/hidock-next/research/command-10-discovery
python -c "from safe_testing_framework import *; print('OK')"
python -c "from parameter_generators import *; print('OK')"
```

Expected: both print `OK`.

- [ ] **Step 5: Commit**

```bash
cd G:/Code/hidock-next
git add research/_shared/ research/command-10-discovery/safe_testing_framework.py research/command-10-discovery/parameter_generators.py research/command-14-15-discovery/safe_testing_framework.py research/command-14-15-discovery/parameter_generators.py research/command-tester-gui/parameter_generators.py
git commit -m "refactor: deduplicate research utilities into research/_shared/

safe_testing_framework.py and parameter_generators.py were copied across
3 research directories. Canonical versions now live in _shared/, duplicates
replaced with import shims. command-tester-gui/safe_testing_framework.py
kept as-is (diverged fork, 6 lines different)."
```

---

### Task 4: Final verification

- [ ] **Step 1: Verify electron build artifacts untracked**

```bash
cd G:/Code/hidock-next
git ls-files apps/electron/out/ apps/electron/tsconfig.web.tsbuildinfo
```

Expected: empty output.

- [ ] **Step 2: Verify firmware duplicates gone**

```bash
git ls-files firmware/h1/ firmware/h1e/
```

Expected: empty output.

- [ ] **Step 3: Verify research shared exists**

```bash
ls research/_shared/safe_testing_framework.py research/_shared/parameter_generators.py research/_shared/__init__.py
```

Expected: all three files listed.

- [ ] **Step 4: Run electron tests**

```bash
cd G:/Code/hidock-next/apps/electron && npm run test:run
```

Expected: all tests pass (no source code was modified).

- [ ] **Step 5: Verify git status is clean for our changes**

```bash
cd G:/Code/hidock-next && git log --oneline -4
```

Expected: 3 new commits from this plan.
