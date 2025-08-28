#!/bin/bash
# HiDock H1E Background Monitor
# Lightweight monitoring for secondary disconnect issues
# Logs everything to detect patterns in rare ENODEV disconnections

LOG_DIR="/tmp/h1e-monitor"
LOG_FILE="$LOG_DIR/h1e-background.log"
STATUS_FILE="$LOG_DIR/h1e-status.json"

# Create log directory
mkdir -p "$LOG_DIR"

# Function to log with timestamp
log_event() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Function to get H1E device count
get_h1e_count() {
    lsusb | grep -E "(10d6|1395|0bda:8153)" | wc -l
}

# Function to check audio device
check_audio() {
    aplay -l 2>/dev/null | grep -q "H1E" && echo "present" || echo "missing"
}

# Function to log system state
log_system_state() {
    local event="$1"
    log_event "=== $event ==="
    log_event "USB Devices: $(get_h1e_count)"
    log_event "Audio Status: $(check_audio)"
    log_event "Load Average: $(cat /proc/loadavg)"
    log_event "Memory: $(free -m | grep '^Mem:' | awk '{print $3"MB used / "$2"MB total"}')"
    
    # Power management status
    log_event "Power States:"
    for device in /sys/bus/usb/devices/*/; do
        if [[ -f "$device/idVendor" ]] && [[ -f "$device/idProduct" ]]; then
            vendor=$(cat "$device/idVendor")
            product=$(cat "$device/idProduct")
            if [[ "$vendor:$product" =~ ^(0bda:0411|0bda:8153|10d6:b00d|1395:005c)$ ]]; then
                control=$(cat "$device/power/control" 2>/dev/null || echo "N/A")
                runtime_status=$(cat "$device/power/runtime_status" 2>/dev/null || echo "N/A")
                device_name=$(basename "$device")
                log_event "  $device_name ($vendor:$product): Control=$control Runtime=$runtime_status"
            fi
        fi
    done
    log_event ""
}

# Initialize monitoring
log_event "🎯 HiDock H1E Background Monitor Started"
log_event "PID: $$"
log_event "Monitoring for secondary disconnect issues (ENODEV -19)"
log_event "Primary r8152 issue: FIXED (driver blacklisted)"

# Initial state
LAST_COUNT=$(get_h1e_count)
LAST_AUDIO=$(check_audio)
log_system_state "INITIAL_STATE"

# Create status file for easy checking
cat > "$STATUS_FILE" << EOF
{
  "monitor_pid": $$,
  "started": "$(date -Iseconds)",
  "last_check": "$(date -Iseconds)",
  "h1e_count": $LAST_COUNT,
  "audio_status": "$LAST_AUDIO",
  "disconnect_events": 0,
  "r8152_errors": 0
}
EOF

# Background kernel log monitoring
{
    journalctl -k -f | while read line; do
        # Check for any USB/H1E related issues
        if echo "$line" | grep -qE "(usb.*disconnect|cannot submit urb|status -19|status -108|1395|10d6|r8152)"; then
            log_event "KERNEL: $line"
            
            # If we see status -108, that means r8152 blacklist failed
            if echo "$line" | grep -q "status -108"; then
                log_event "⚠️  CRITICAL: r8152 ESHUTDOWN detected - blacklist may have failed!"
            fi
            
            # If we see status -19, that's the secondary issue we're tracking
            if echo "$line" | grep -q "status -19"; then
                log_event "⚠️  SECONDARY ISSUE: ENODEV (-19) error detected"
                log_system_state "ENODEV_EVENT"
            fi
        fi
    done
} &

KERNEL_MONITOR_PID=$!

# Main monitoring loop
while true; do
    sleep 15  # Check every 15 seconds
    
    CURRENT_COUNT=$(get_h1e_count)
    CURRENT_AUDIO=$(check_audio)
    
    # Detect changes
    if [[ $CURRENT_COUNT != $LAST_COUNT ]] || [[ "$CURRENT_AUDIO" != "$LAST_AUDIO" ]]; then
        if [[ $CURRENT_COUNT -lt $LAST_COUNT ]] || [[ "$CURRENT_AUDIO" == "missing" && "$LAST_AUDIO" == "present" ]]; then
            log_event "💥 DISCONNECT DETECTED!"
            log_event "  Count: $LAST_COUNT → $CURRENT_COUNT"
            log_event "  Audio: $LAST_AUDIO → $CURRENT_AUDIO"
            log_system_state "DISCONNECT_EVENT"
            
            # Update disconnect counter
            DISCONNECT_COUNT=$(grep -c "DISCONNECT DETECTED" "$LOG_FILE" || echo 0)
            
        elif [[ $CURRENT_COUNT -gt $LAST_COUNT ]] || [[ "$CURRENT_AUDIO" == "present" && "$LAST_AUDIO" == "missing" ]]; then
            log_event "🔌 RECONNECT DETECTED!"
            log_event "  Count: $LAST_COUNT → $CURRENT_COUNT"  
            log_event "  Audio: $LAST_AUDIO → $CURRENT_AUDIO"
            log_system_state "RECONNECT_EVENT"
        fi
        
        LAST_COUNT=$CURRENT_COUNT
        LAST_AUDIO="$CURRENT_AUDIO"
    fi
    
    # Update status file every minute
    if (( $(date +%s) % 60 < 15 )); then
        DISCONNECT_COUNT=$(grep -c "DISCONNECT DETECTED" "$LOG_FILE" 2>/dev/null || echo 0)
        R8152_COUNT=$(grep -c "status -108" "$LOG_FILE" 2>/dev/null || echo 0)
        
        cat > "$STATUS_FILE" << EOF
{
  "monitor_pid": $$,
  "started": "$(date -Iseconds)",
  "last_check": "$(date -Iseconds)",
  "h1e_count": $CURRENT_COUNT,
  "audio_status": "$CURRENT_AUDIO",
  "disconnect_events": $DISCONNECT_COUNT,
  "r8152_errors": $R8152_COUNT
}
EOF
    fi
done
