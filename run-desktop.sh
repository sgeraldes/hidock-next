#!/bin/zsh
# Convenience launcher for HiDock Desktop App

emulate -L zsh
setopt errexit pipefail

SCRIPT_DIR=${0:A:h}
cd "$SCRIPT_DIR"

echo "Launching HiDock Desktop App..."
"$SCRIPT_DIR/scripts/run/run-hidock-desktop.sh"