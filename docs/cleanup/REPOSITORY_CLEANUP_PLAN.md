# HiDock Next Repository Cleanup Plan

## Current State Analysis

The repository currently has files scattered across the root directory and various subdirectories without clear organization. This cleanup plan will reorganize everything into a logical, maintainable structure.

## Proposed Directory Structure

```
hidock-next/
├── apps/                          # All applications
│   ├── desktop/                   # Desktop application (from hidock-desktop-app/)
│   ├── web/                       # Web application (from hidock-web-app/)
│   └── audio-insights/            # Audio insights extractor (from audio-insights-extractor/)
│
├── research/                      # Research and reverse engineering (existing)
│   ├── firmware-analysis/         # Firmware analysis scripts
│   ├── protocol-analysis/         # Protocol reverse engineering
│   ├── command-discovery/         # Command testing and discovery
│   └── hardware-analysis/         # Hardware-related research
│
├── firmware/                      # Firmware files (existing, keep as-is)
│   ├── h1/
│   ├── h1e/
│   ├── p1/
│   └── README.md
│
├── docs/                          # All documentation
│   ├── api/                       # API documentation
│   ├── development/               # Development guides
│   ├── deployment/                # Deployment guides
│   ├── hardware/                  # Hardware documentation
│   ├── protocols/                 # Protocol specifications
│   ├── troubleshooting/           # Troubleshooting guides
│   └── README.md                  # Documentation index
│
├── scripts/                       # Utility scripts (existing, reorganize)
│   ├── setup/                     # Setup and installation
│   ├── development/               # Development utilities
│   ├── testing/                   # Test scripts
│   └── deployment/                # Deployment scripts
│
├── archive/                       # Historical/deprecated items (existing)
│   ├── old-docs/                  # Outdated documentation
│   ├── legacy-scripts/            # Old scripts
│   ├── har-files/                 # HAR analysis files
│   └── reverse-engineering/       # Old RE docs
│
├── config/                        # Configuration files
│   ├── ai/                        # AI assistant configs (from .ai-configs/)
│   ├── ide/                       # IDE configurations
│   └── ci/                        # CI/CD configurations
│
├── tests/                         # All test files
│   ├── desktop/                   # Desktop app tests
│   ├── web/                       # Web app tests
│   └── integration/               # Integration tests
│
├── temp/                          # Temporary files (existing)
├── audio/                         # Audio files (existing)
└── [root files]                   # Essential root files only
```

## Files to Move/Organize

### 1. Root Python Scripts → research/
These appear to be reverse engineering and analysis scripts:
- `analyze_auth.py` → `research/protocol-analysis/`
- `decode_firmware.py` → `research/firmware-analysis/`
- `command_parameter_test.py` → `research/command-discovery/`
- `command_table_analysis.py` → `research/command-discovery/`
- `deep_command_analysis.py` → `research/command-discovery/`
- `disasm_analysis.py` → `research/firmware-analysis/`
- `firmware_analysis.py` → `research/firmware-analysis/`
- `firmware_downloader.py` → `research/firmware-analysis/`
- `jensen_protocol_reverse.py` → `research/protocol-analysis/`
- `universal_firmware_downloader.py` → `research/firmware-analysis/`
- `test_p1_versions.py` → `research/firmware-analysis/`

### 2. Documentation Files → docs/
Root documentation that should be organized:
- `CLAUDE.md` → Keep in root (AI assistant context)
- `README.md` → Keep in root (main readme)
- `LICENSE` → Keep in root (legal)
- `QUICK_START.md` → `docs/getting-started/`
- `DOCUMENTATION_INDEX.md` → `docs/` (merge with existing INDEX.md)
- `Screenshot*.png` → `docs/assets/screenshots/`

### 3. Configuration Files
- `.ai-configs/` → `config/ai/`
- `.claude/` → `config/ai/claude/`
- `.mcp.json` → `config/ai/`
- `.vscode/` → `config/ide/vscode/`
- `.github/` → Keep in root (GitHub specific)

### 4. Build/Package Files (Keep in root)
- `pyproject.toml`
- `setup.py`
- `.gitignore`
- `.env`

### 5. Scripts Organization
**Root Launchers (NO CHANGES NEEDED):**
- `run-desktop.bat/sh` → **KEEP IN ROOT** (continue calling scripts/run/)
- `run-web.bat/sh` → **KEEP IN ROOT** (continue calling scripts/run/)
- `setup-unix.sh` → **KEEP IN ROOT** (update internal paths only)
- `setup-windows.bat` → **KEEP IN ROOT** (update internal paths only)
- `setup.py` → **KEEP IN ROOT** (update package paths)

**Worker Scripts (UPDATE PATHS):**
- `scripts/run/run-hidock-desktop.bat` → Update to navigate to apps/desktop
- `scripts/run/run-hidock-web.bat` → Update to navigate to apps/web

### 6. Cache/Build Directories → Delete and Update VSCode Settings
- `.mypy_cache/` → **DELETE** (configure VSCode to use temp/mypy_cache)
- `.pytest_cache/` → **DELETE** (configure VSCode to use temp/pytest_cache)
- **Action**: Update VSCode settings.json to redirect cache locations

### 7. Archive Directory Reorganization
Current `archive/` contents to be reorganized:
- `*.har` files → `archive/har-files/`
- `hinotes.hidock site/` → `archive/legacy-sites/`
- `reverse-engineering-docs/` → Keep as-is
- `temp-scripts/` → Review and move useful ones to `scripts/testing/`
- `testing-docs/` → Move to `docs/testing/`
- `*.js` files → `archive/extracted-code/`
- `*.md` files → Review and move to appropriate docs

### 8. Applications
- `hidock-desktop-app/` → `apps/desktop/`
- `hidock-web-app/` → `apps/web/`
- `audio-insights-extractor/` → `apps/audio-insights/`

## Cleanup Actions

### Phase 1: Create New Structure
1. Create all new directories as outlined above
2. Create README.md files in each major directory explaining its purpose

### Phase 2: Move Research Files
1. Move all Python analysis scripts from root to `research/` subdirectories
2. Organize by purpose (firmware, protocol, command discovery)
3. Create index of research tools with descriptions

### Phase 3: Consolidate Documentation
1. Review all .md files in root and docs/
2. Remove duplicates
3. Organize by category
4. Update cross-references
5. Create master documentation index

### Phase 4: Organize Configuration
1. Move AI configurations to `config/ai/`
2. Keep IDE configs in `config/ide/`
3. Document configuration purposes

### Phase 5: Clean Build Artifacts
1. Move cache directories to archive
2. Add to .gitignore if not already present
3. Clean up temp files

### Phase 6: Application Reorganization
1. Move applications to `apps/` directory
2. Update all path references in scripts
3. Update documentation references

### Phase 7: Final Cleanup
1. Review archive directory
2. Remove truly obsolete files
3. Update root README.md with new structure
4. Update all run scripts with new paths

## Files to Keep in Root
- `README.md` - Main project documentation
- `LICENSE` - Legal requirements
- `CLAUDE.md` - AI assistant context
- `.gitignore` - Git configuration
- `.github/` - GitHub specific files
- `pyproject.toml` - Python project configuration
- `setup.py` - Python package setup
- `.env` - Environment variables (if needed)
- **All run scripts**: `run-desktop.bat`, `run-desktop.sh`, `run-web.bat`, `run-web.sh`
- **All setup scripts**: `setup-unix.sh`, `setup-windows.bat`

## Benefits of This Structure

1. **Clear Separation of Concerns**
   - Applications in `apps/`
   - Research/RE work in `research/`
   - Documentation in `docs/`
   - Scripts in `scripts/`

2. **Easier Navigation**
   - Logical grouping of related files
   - Clear purpose for each directory
   - No clutter in root directory

3. **Better Maintenance**
   - Easy to find specific types of files
   - Clear where new files should go
   - Simplified CI/CD configuration

4. **Professional Organization**
   - Standard project structure
   - Easy for new developers to understand
   - Clear separation of source and artifacts

## Execution Steps

### Step 1: Backup
```bash
# Create backup of current state
cp -r . ../hidock-next-backup-$(date +%Y%m%d)
```

### Step 2: Create Structure
```bash
# Create new directory structure
mkdir -p apps/{desktop,web,audio-insights}
mkdir -p research/{firmware-analysis,protocol-analysis,command-discovery,hardware-analysis}
mkdir -p docs/{api,development,deployment,hardware,protocols,troubleshooting,getting-started,assets/screenshots}
mkdir -p scripts/{setup,development,testing,deployment,run}
mkdir -p archive/{old-docs,legacy-scripts,har-files,extracted-code,legacy-sites,build-cache/{mypy,pytest}}
mkdir -p config/{ai/claude,ide/vscode,ci}
mkdir -p tests/{desktop,web,integration}
```

### Step 3: Move Files (Examples)
```bash
# Move research scripts
mv analyze_auth.py research/protocol-analysis/
mv decode_firmware.py firmware_analysis.py firmware_downloader.py universal_firmware_downloader.py test_p1_versions.py research/firmware-analysis/
mv command_*.py deep_command_analysis.py research/command-discovery/
mv jensen_protocol_reverse.py research/protocol-analysis/
mv disasm_analysis.py research/firmware-analysis/

# Move applications (INCLUDING .venv for desktop app)
mv hidock-desktop-app apps/desktop
mv hidock-web-app apps/web
mv audio-insights-extractor apps/audio-insights

# Move configurations
mv .ai-configs/* config/ai/
mv .claude/* config/ai/claude/
mv .vscode/* config/ide/vscode/
mv .mcp.json config/ai/

# Scripts stay in root - DON'T MOVE
# Instead, we'll update their internal paths

# Delete caches (will be recreated in new location)
rm -rf .mypy_cache
rm -rf .pytest_cache

# Move documentation
mv QUICK_START.md docs/getting-started/
mv Screenshot*.png docs/assets/screenshots/

# Archive HAR files
mv archive/*.har archive/har-files/
mv archive/*.js archive/extracted-code/
```

### Step 4: Update References

#### Scripts to Update (with new paths):

**Root launchers (run-desktop.bat, run-web.bat, etc.)**:
- NO CHANGES NEEDED - They just call scripts in scripts/run/

**scripts/run/run-hidock-desktop.bat**:
- Line 9: Change `if not exist "hidock-desktop-app"` → `if not exist "apps\desktop"`  
- Line 18: Change `cd hidock-desktop-app` → `cd apps\desktop`
- Update error messages mentioning "hidock-desktop-app"

**scripts/run/run-hidock-web.bat** (create if doesn't exist):
- Navigate to `apps\web` instead of `hidock-web-app`
- Run npm commands from there

**setup-windows.bat**:
- Change: `cd hidock-desktop-app` → `cd apps/desktop`
- Update any references to hidock-desktop-app path

**setup-unix.sh**:
- Change: `cd hidock-desktop-app` → `cd apps/desktop`
- Update any references to hidock-desktop-app path

**setup.py**:
- Update package discovery paths
- Change: `hidock-desktop-app` references → `apps/desktop`

#### VSCode Settings Updates:

**config/ide/vscode/settings.json**:
```json
{
  "python.linting.mypyCacheDir": "${workspaceFolder}/temp/mypy_cache",
  "python.testing.pytestArgs": [
    "--cache-dir=${workspaceFolder}/temp/pytest_cache"
  ],
  "python.defaultInterpreterPath": "${workspaceFolder}/apps/desktop/.venv/Scripts/python.exe",
  "python.terminal.activateEnvironment": true
}
```

#### .gitignore Updates:
```
# Old cache locations (remove these lines)
.mypy_cache/
.pytest_cache/

# New cache locations (add these lines)
temp/mypy_cache/
temp/pytest_cache/
```

1. Update all import paths in Python files
2. Update script paths in .bat and .sh files
3. Update documentation links
4. Update .gitignore paths
5. Update VSCode settings for new cache locations
6. Update GitHub Actions workflows if they reference app paths

### Step 5: Cleanup
```bash
# Remove empty directories
find . -type d -empty -delete

# Remove .pyc and __pycache__
find . -name "*.pyc" -delete
find . -name "__pycache__" -type d -delete
```

## Review Checklist

- [ ] All Python scripts moved from root
- [ ] Applications reorganized into apps/ (including .venv)
- [ ] Documentation consolidated and organized
- [ ] Configuration files centralized
- [ ] Cache directories deleted (not archived)
- [ ] Root scripts KEPT and UPDATED with new paths
- [ ] Archive directory cleaned up
- [ ] Root directory contains only essential files + run/setup scripts
- [ ] All path references updated in scripts
- [ ] VSCode settings updated for new cache locations
- [ ] .gitignore updated for new cache locations
- [ ] README.md updated with new structure
- [ ] No broken links in documentation
- [ ] All scripts tested with new paths
- [ ] Desktop app .venv still works after move
- [ ] Web app npm modules still work after move

## Notes

- This plan prioritizes logical organization over minimal changes
- Some files may need review before deciding final location
- Update CI/CD configurations after reorganization
- Consider creating a migration script to automate the process
- Test all applications after moving to ensure functionality

## Approval Required

Please review this plan and confirm before execution. The reorganization will:
1. Make the repository more maintainable
2. Improve developer experience
3. Standardize the project structure
4. Prepare for future growth

Ready to proceed with approval.