# Scripts & Utilities

Utility scripts for setup, building, and running HiDock Next applications.

## 📁 Directory Structure

### [build/](build/) - Build Scripts
- `build_desktop.py` - Build desktop application installer
- `build_web.py` - Build web application bundle

### [setup/](setup/) - Setup Scripts
- Installation and configuration utilities
- Dependency management

### [run/](run/) - Run Scripts
- Application launch scripts
- Development server scripts

### [utils/](utils/) - Utility Scripts
- General purpose utilities
- Maintenance scripts

## 🚀 Quick Reference

### Setup
```bash
python scripts/setup/setup_environment.py
```

### Build
```bash
python scripts/build/build_desktop.py
```

### Run
```bash
# Windows
scripts\run\run-hidock-desktop.bat

# Unix
./scripts/run/run-hidock-desktop.sh
```

## ⚙️ Development

Scripts follow Python best practices:
- Type hints where applicable
- Error handling and logging
- Cross-platform compatibility