#!/bin/bash
# Direct launcher for HiDock Desktop App from app directory
echo "Launching HiDock Desktop App..."
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec "$ROOT_DIR/run-desktop.sh"
