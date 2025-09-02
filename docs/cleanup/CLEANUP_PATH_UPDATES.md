# Path Updates Required After Repository Cleanup

## Critical Path Updates After Moving Apps

### 1. Root Launch Scripts (run-desktop.bat)
**Current**: Calls `scripts\run\run-hidock-desktop.bat`
**NO CHANGE NEEDED** - Keep as is, just update the target script
```batch
@echo off
REM Convenience launcher for HiDock Desktop App
echo Launching HiDock Desktop App...
call scripts\run\run-hidock-desktop.bat
```

### 2. Root Launch Scripts (run-desktop.sh)
**NO CHANGE NEEDED** - Keep as is, just update the target script
```bash
#!/bin/bash
echo "Launching HiDock Desktop App..."
./scripts/run/run-hidock-desktop.sh
```

### 3. Root Launch Scripts (run-web.bat)
**NO CHANGE NEEDED** - Keep as is, just update the target script
```batch
@echo off
echo Starting HiDock Web App...
call scripts\run\run-hidock-web.bat
```

### 4. Root Launch Scripts (run-web.sh)
**NO CHANGE NEEDED** - Keep as is, just update the target script
```bash
#!/bin/bash
echo "Starting HiDock Web App..."
./scripts/run/run-hidock-web.sh
```

### 5. Setup Scripts (setup-windows.bat)
**Lines to update**:
- Any `cd hidock-desktop-app` → `cd apps\desktop`
- Any `cd hidock-web-app` → `cd apps\web`
- Path references in pip install commands

### 6. Setup Scripts (setup-unix.sh)
**Lines to update**:
- Any `cd hidock-desktop-app` → `cd apps/desktop`
- Any `cd hidock-web-app` → `cd apps/web`
- Path references in pip install commands

### 7. VSCode Settings (.vscode/settings.json → config/ide/vscode/settings.json)
```json
{
    // Python paths
    "python.defaultInterpreterPath": "${workspaceFolder}/apps/desktop/.venv/Scripts/python.exe",
    "flake8.path": ["${workspaceFolder}/apps/desktop/.venv/Scripts/flake8.exe"],
    "flake8.cwd": "${workspaceFolder}/apps/desktop",
    "pylint.path": ["${workspaceFolder}/apps/desktop/.venv/Scripts/pylint.exe"],
    "pylint.cwd": "${workspaceFolder}/apps/desktop",
    
    // Testing paths
    "python.testing.pytestArgs": [
        "apps/desktop/tests",
        "--cache-dir=${workspaceFolder}/temp/pytest_cache",
        "--ignore=archive",
        "--ignore=docs"
    ],
    
    // ESLint for web app
    "eslint.workingDirectories": ["apps/web"],
    
    // Coverage paths
    "coverage-gutters.coverageBaseDir": "${workspaceFolder}/apps/desktop",
    "coverage-gutters.manualCoverageFilePaths": [
        "${workspaceFolder}/apps/desktop/coverage.xml"
    ],
    
    // Cache directories (NEW)
    "python.linting.mypyCacheDir": "${workspaceFolder}/temp/mypy_cache"
}
```

### 8. Setup.py (Python Package Configuration)
**Update package discovery**:
```python
# Old
packages=find_packages(where="hidock-desktop-app/src")
package_dir={"": "hidock-desktop-app/src"}

# New
packages=find_packages(where="apps/desktop/src")
package_dir={"": "apps/desktop/src"}
```

### 9. .gitignore Updates
```gitignore
# Remove old cache paths
-.mypy_cache/
-.pytest_cache/

# Add new cache paths
+temp/mypy_cache/
+temp/pytest_cache/
+temp/*.log
+temp/*.tmp

# Update app paths
-hidock-desktop-app/.venv/
-hidock-desktop-app/__pycache__/
-hidock-web-app/node_modules/
+apps/desktop/.venv/
+apps/desktop/__pycache__/
+apps/web/node_modules/
```

### 10. GitHub Actions Workflows (.github/workflows/*.yml)
Any CI/CD pipelines referencing:
- `hidock-desktop-app` → `apps/desktop`
- `hidock-web-app` → `apps/web`

### 11. Documentation Updates
All markdown files with paths:
- Update references to `hidock-desktop-app/` → `apps/desktop/`
- Update references to `hidock-web-app/` → `apps/web/`
- Update references to scripts locations

### 12. PyTest Configuration (if exists: pytest.ini or pyproject.toml)
```ini
[tool.pytest.ini_options]
testpaths = ["apps/desktop/tests"]
cache_dir = "temp/pytest_cache"
```

### 13. MyPy Configuration (if exists: mypy.ini or pyproject.toml)
```ini
[mypy]
cache_dir = temp/mypy_cache
files = apps/desktop/src
```

### 14. Scripts/run Directory Files (UPDATE THESE)
**scripts/run/run-hidock-desktop.bat**:
- Line 9: `if not exist "hidock-desktop-app"` → `if not exist "apps\desktop"`
- Line 18: `cd hidock-desktop-app` → `cd apps\desktop`
- Error messages mentioning "hidock-desktop-app" → "apps/desktop"

**scripts/run/run-hidock-desktop.sh** (if exists):
- Update paths from `hidock-desktop-app` → `apps/desktop`

**scripts/run/run-hidock-web.bat** (if exists):
- Update paths from `hidock-web-app` → `apps/web`

**scripts/run/run-hidock-web.sh** (if exists):
- Update paths from `hidock-web-app` → `apps/web`

### 15. Desktop App Internal Paths
Check these files in `hidock-desktop-app/` for hardcoded paths:
- `main.py` - Any relative path imports
- `src/config_and_logger.py` - Log file paths, config paths
- Any file with `os.path.join` or path operations

### 16. Web App Package.json
Update any scripts that reference paths:
```json
{
  "scripts": {
    // Check if any scripts reference parent directories
  }
}
```

## Cache Directory Configuration

### Why Not Archive Cache Directories?
- `.mypy_cache` and `.pytest_cache` are **generated** by tools
- They're not source code or valuable data
- They can be regenerated anytime
- Archiving them wastes space and Git history

### New Cache Strategy
1. **Delete** existing cache directories
2. **Configure** tools to use `temp/` directory
3. **Add** temp cache paths to `.gitignore`
4. **Document** in README that temp/ is for transient files

### VSCode Cache Settings
```json
{
  // Tell mypy where to put cache
  "python.linting.mypyArgs": [
    "--cache-dir=${workspaceFolder}/temp/mypy_cache"
  ],
  
  // Tell pytest where to put cache
  "python.testing.pytestArgs": [
    "--cache-dir=${workspaceFolder}/temp/pytest_cache"
  ]
}
```

## Execution Order

1. **Backup** current state
2. **Create** new directory structure
3. **Move** applications (with .venv intact)
4. **Move** other files to new locations
5. **Delete** cache directories
6. **Update** all scripts in root
7. **Update** VSCode settings
8. **Update** .gitignore
9. **Test** all launch scripts
10. **Verify** .venv still works
11. **Run** tests to ensure nothing broke

## Testing Checklist After Updates

- [ ] `run-desktop.bat` launches the app
- [ ] `run-desktop.sh` launches the app
- [ ] `run-web.bat` launches the web app
- [ ] `run-web.sh` launches the web app
- [ ] `setup-windows.bat` can install dependencies
- [ ] `setup-unix.sh` can install dependencies
- [ ] VSCode finds Python interpreter
- [ ] VSCode can run tests
- [ ] Cache files generate in temp/ not root
- [ ] .venv activation works in new location
- [ ] All imports still work in Python files

## Important Notes

1. **DO NOT** move the .venv with the desktop app - it must stay with the app
2. **DO NOT** move scripts from root - they're entry points
3. **DO NOT** archive cache directories - just delete them
4. **DO** update all hardcoded paths in scripts
5. **DO** test everything after moving

## Rollback Plan

If something breaks:
1. Restore from backup
2. Document what failed
3. Fix the issue
4. Try again with smaller changes