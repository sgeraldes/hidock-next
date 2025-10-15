# HiDock Next convenience Makefile
# Targets are thin wrappers around setup script and run commands.

PYTHON ?= python
SETUP = $(PYTHON) setup.py
DESKTOP_DIR = apps/desktop
WEB_DIR = apps/web
AUDIO_DIR = apps/audio-insights
# Default Linux venv path; on Windows or macOS activate the matching tagged venv (.venv.win/.venv.mac/.venv.wsl)
# This keeps Make targets simple while multi-OS logic lives in setup.py
VENV = $(DESKTOP_DIR)/.venv.linux

.PHONY: help setup dev-quick migrate-copy migrate-rebuild desktop web audio tests clean env-rebuild

help:
	@echo "HiDock Next Make targets:"
	@echo "  make setup          - Full developer setup"
	@echo "  make dev-quick      - Non-interactive developer setup (skips tests)"
	@echo "  make migrate-copy   - Force legacy -> tagged env copy migration"
	@echo "  make migrate-rebuild- Force legacy -> tagged env rebuild migration"
	@echo "  make desktop        - Run desktop app (after activation)"
	@echo "  make web            - Run web dev server"
	@echo "  make audio          - Run audio insights dev server"
	@echo "  make tests          - Run all test suites (python + web + audio)"
	@echo "  make clean          - Remove Python venv and node_modules"
	@echo "  make env-rebuild    - Force rebuild Python environment"

setup:
	$(SETUP) --mode developer

dev-quick:
	$(SETUP) --mode developer --non-interactive --skip-tests

migrate-copy:
	HIDOCK_AUTO_MIGRATE=c $(SETUP) --mode developer --non-interactive

migrate-rebuild:
	HIDOCK_AUTO_MIGRATE=r $(SETUP) --mode developer --non-interactive

desktop:
	@echo "Activate your platform venv then run main.py"
	@echo "Linux:   cd apps/desktop && source .venv.linux/bin/activate && python main.py"
	@echo "WSL:     cd apps/desktop && source .venv.wsl/bin/activate && python main.py"
	@echo "macOS:   cd apps/desktop && source .venv.mac/bin/activate && python main.py"
	@echo "Windows: cd apps/desktop && .venv.win\\Scripts\\activate && python main.py"

web:
	cd $(WEB_DIR) && npm run dev

audio:
	cd $(AUDIO_DIR) && npm run dev

tests:
	# Adjust the venv name below if not on native Linux
	cd $(DESKTOP_DIR) && .venv.linux/bin/python -m pytest -v || true
	cd $(WEB_DIR) && npm test || true
	cd $(AUDIO_DIR) && npm test || true

clean:
	@echo "Removing Python venv(s) and node_modules..."
	@if [ -d $(DESKTOP_DIR)/.venv.linux ]; then rm -rf $(DESKTOP_DIR)/.venv.linux; fi
	@if [ -d $(DESKTOP_DIR)/.venv.win ]; then rm -rf $(DESKTOP_DIR)/.venv.win; fi
	@if [ -d $(DESKTOP_DIR)/.venv.mac ]; then rm -rf $(DESKTOP_DIR)/.venv.mac; fi
	@if [ -d $(DESKTOP_DIR)/.venv.wsl ]; then rm -rf $(DESKTOP_DIR)/.venv.wsl; fi
	@if [ -d $(WEB_DIR)/node_modules ]; then rm -rf $(WEB_DIR)/node_modules; fi
	@if [ -d $(AUDIO_DIR)/node_modules ]; then rm -rf $(AUDIO_DIR)/node_modules; fi

env-rebuild:
	$(SETUP) --mode developer --force-new-env --non-interactive --skip-tests --skip-web --skip-audio
