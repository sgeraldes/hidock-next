#!/bin/bash
# Quick H1E Status Checker
# Shows current monitoring status and any recent events

LOG_DIR="/tmp/h1e-monitor"
LOG_FILE="$LOG_DIR/h1e-background.log"
STATUS_FILE="$LOG_DIR/h1e-status.json"

echo "🎯 HiDock H1E Status Check"
echo "========================="

# Check if monitoring is running
if [[ -f "$STATUS_FILE" ]]; then
    echo "📊 Current Status:"
    cat "$STATUS_FILE" | python3 -m json.tool 2>/dev/null || echo "Status file exists but invalid JSON"
    echo ""
else
    echo "⚠️  Monitor not running or no status available"
    echo ""
fi

# Show recent events
if [[ -f "$LOG_FILE" ]]; then
    echo "📋 Recent Events (last 10):"
    tail -20 "$LOG_FILE" | grep -E "(DISCONNECT|RECONNECT|CRITICAL|SECONDARY)" | tail -10
    echo ""
    
    echo "📈 Event Summary:"
    DISCONNECTS=$(grep -c "DISCONNECT DETECTED" "$LOG_FILE" 2>/dev/null || echo 0)
    RECONNECTS=$(grep -c "RECONNECT DETECTED" "$LOG_FILE" 2>/dev/null || echo 0)
    R8152_ERRORS=$(grep -c "status -108" "$LOG_FILE" 2>/dev/null || echo 0)
    ENODEV_ERRORS=$(grep -c "status -19" "$LOG_FILE" 2>/dev/null || echo 0)
    
    echo "  Disconnects: $DISCONNECTS"
    echo "  Reconnects: $RECONNECTS"  
    echo "  r8152 Errors (should be 0): $R8152_ERRORS"
    echo "  ENODEV Errors: $ENODEV_ERRORS"
else
    echo "ℹ️  No log file found - monitor hasn't started yet"
fi

echo ""
echo "🔍 Current H1E Devices:"
lsusb | grep -E "(10d6|1395)" || echo "No H1E devices detected"

echo ""
echo "🎵 Audio Status:"
aplay -l | grep H1E || echo "No H1E audio device detected"

echo ""
echo "📁 Log Files:"
echo "  Status: $STATUS_FILE"
echo "  Events: $LOG_FILE"
