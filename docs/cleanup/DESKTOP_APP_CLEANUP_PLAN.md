# Desktop App Cleanup Plan

## Current State Analysis - apps/desktop/

The desktop app folder contains many files and directories that should be reorganized or removed.

## Files and Folders to Clean Up

### 1. 🗑️ DELETE - Build/Cache/Coverage Artifacts
These are generated files that shouldn't be in version control:
- `__pycache__/` - Python bytecode cache
- `.pytest_cache/` - Pytest cache 
- `htmlcov/` - Coverage HTML reports
- `hidock_next.egg-info/` - Python package build artifacts

### 2. 📦 ARCHIVE - Test Utilities & Temporary Scripts
Move to `archive/desktop-test-scripts/`:
- `test_utilities/` - 33 test/debug scripts
  - check_calendar_cache.py
  - debug_*.py scripts
  - test_*.py scripts
  - verify_*.py scripts
- `temp/` - 7 temporary test scripts
  - calendar_disabled.py
  - manual_outlook_calendar_test.py
  - test_*.py files

### 3. 📚 MOVE TO MAIN DOCS - Documentation
Move to main docs structure:
- `docs/` folder (35 markdown files) → Move to:
  - `docs/desktop/` - Desktop-specific documentation
  - Or categorize into existing docs structure

Current docs in apps/desktop/docs/:
- Architecture/Design docs → `docs/development/desktop/`
- Bug lists → `docs/troubleshooting/desktop/`
- Feature plans → `docs/planning/desktop/`
- Changelogs → `docs/development/desktop/changelogs/`
- Implementation guides → `docs/implementation-guides/desktop/`

### 4. ⚙️ KEEP BUT REVIEW - Configuration & Scripts
- `config/` - Contains hidock_config.json (KEEP)
- `scripts/` - Contains runtime_deps_check.py (KEEP)
- `logs/` - Log directory (KEEP but add to .gitignore)

### 5. ✅ KEEP - Essential Files
These must stay in apps/desktop/:
- `.venv/` - Virtual environment
- `src/` - Source code
- `tests/` - Unit tests
- `icons/` - Application icons
- `themes/` - UI themes
- `main.py` - Entry point
- `libusb-1.0.dll` - Required DLL
- `README.md` - App documentation
- `AGENT.md` - AI context

### 6. 🔍 REVIEW - Small Scripts
- `run.bat` - Simple launcher (might be redundant with scripts/run/)
- `run.sh` - Simple launcher (might be redundant with scripts/run/)

### 7. ⚠️ PROBLEMATIC - Can't Remove
- `hidock-desktop-app/` - Contains the mysterious "E:" file

## Proposed Actions

### Step 1: Delete Build Artifacts
```bash
rm -rf apps/desktop/__pycache__
rm -rf apps/desktop/.pytest_cache
rm -rf apps/desktop/htmlcov
rm -rf apps/desktop/hidock_next.egg-info
```

### Step 2: Archive Test Scripts
```bash
# Create archive directory
mkdir -p archive/desktop-test-scripts/test_utilities
mkdir -p archive/desktop-test-scripts/temp

# Move test utilities
mv apps/desktop/test_utilities/* archive/desktop-test-scripts/test_utilities/
rmdir apps/desktop/test_utilities

# Move temp scripts
mv apps/desktop/temp/* archive/desktop-test-scripts/temp/
rmdir apps/desktop/temp
```

### Step 3: Reorganize Documentation
```bash
# Create desktop docs structure
mkdir -p docs/desktop/architecture
mkdir -p docs/desktop/bugs
mkdir -p docs/desktop/features
mkdir -p docs/desktop/implementation
mkdir -p docs/desktop/changelogs

# Move categorized docs
mv apps/desktop/docs/ARCHITECTURE_PLAN.md docs/desktop/architecture/
mv apps/desktop/docs/BUG_LIST.md docs/desktop/bugs/
mv apps/desktop/docs/CALENDAR_INTEGRATION_PLAN.md docs/desktop/features/
mv apps/desktop/docs/CONNECTION_IMPROVEMENTS.md docs/desktop/implementation/
mv apps/desktop/docs/CHANGELOG_*.md docs/desktop/changelogs/
# ... continue for all docs

# Remove empty docs folder
rmdir apps/desktop/docs
```

### Step 4: Update .gitignore
Add these entries:
```gitignore
# Desktop app specific
apps/desktop/__pycache__/
apps/desktop/.pytest_cache/
apps/desktop/htmlcov/
apps/desktop/*.egg-info/
apps/desktop/logs/*.log
apps/desktop/logs/*.txt
apps/desktop/scripts/__pycache__/
```

### Step 5: Clean Script Cache
```bash
rm -rf apps/desktop/scripts/__pycache__
```

## Final Structure

After cleanup, apps/desktop/ should contain:
```
apps/desktop/
├── .venv/              # Virtual environment
├── src/                # Source code
├── tests/              # Unit tests  
├── config/             # Configuration
├── scripts/            # Utility scripts
├── icons/              # Icons
├── themes/             # UI themes
├── logs/               # Log directory (empty)
├── main.py             # Entry point
├── libusb-1.0.dll      # Required DLL
├── README.md           # Documentation
├── AGENT.md            # AI context
├── run.bat             # Windows launcher
└── run.sh              # Unix launcher
```

## Summary of Changes

### Files to Delete (4 items)
- `__pycache__/`
- `.pytest_cache/`
- `htmlcov/`
- `hidock_next.egg-info/`

### Files to Archive (40+ scripts)
- `test_utilities/` (33 scripts)
- `temp/` (7 scripts)

### Files to Move (35 docs)
- `docs/` → Main documentation structure

### Files to Keep (Essential)
- Source code, tests, configs, icons, themes
- Virtual environment
- Entry points and launchers

## Benefits
- Cleaner application directory
- No build artifacts in version control
- Better organized documentation
- Test scripts archived but available
- Clear separation of concerns

## Execution Checklist
- [ ] Delete all __pycache__ directories
- [ ] Delete .pytest_cache
- [ ] Delete htmlcov
- [ ] Delete hidock_next.egg-info
- [ ] Archive test_utilities folder
- [ ] Archive temp folder
- [ ] Move documentation to main docs
- [ ] Update .gitignore
- [ ] Verify application still runs
- [ ] Commit changes