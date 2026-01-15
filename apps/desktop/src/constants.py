"""
Global Constants for the HiDock Tool Application.


This module defines various constant values used across the HiDock tool,
including USB device identifiers, communication protocol command IDs,
endpoint addresses, and the name of the configuration file.
Centralizing these constants helps in maintaining consistency and
ease of modification.
"""

# constants.py

# --- USB Device Constants ---
DEFAULT_VENDOR_ID = 0x10D6  # Actions Semiconductor (older devices)
ALTERNATE_VENDOR_ID = 0x3887  # HiDock (newer P1 Mini devices)
ALL_VENDOR_IDS = [DEFAULT_VENDOR_ID, ALTERNATE_VENDOR_ID]

# All known HiDock device PIDs (no hierarchy - all devices are equal)
# Source: Official HiDock HiNotes jensen.js (December 2025)
HIDOCK_PRODUCT_IDS = [
    # Original product IDs
    0xAF0C,  # H1 (45068 decimal)
    0xAF0D,  # H1E (45069 decimal, older PID)
    0xB00D,  # H1E (newer PID)
    0xAF0E,  # P1 (45070 decimal, older PID)
    0xB00E,  # P1 (newer PID)
    0xAF0F,  # P1 mini (45071 decimal)
    # Alternative product IDs
    0x0100,  # H1 alt (256 decimal)
    0x0101,  # H1E alt (257 decimal)
    0x0102,  # H1 alt (258 decimal)
    0x0103,  # H1E alt (259 decimal)
    0x2040,  # P1 alt (8256 decimal)
    0x2041,  # P1 mini alt (8257 decimal)
]

# Product ID to model name mapping
PRODUCT_ID_MODEL_MAP = {
    0xAF0C: "hidock-h1",
    0x0100: "hidock-h1",
    0x0102: "hidock-h1",
    0xAF0D: "hidock-h1e",
    0xB00D: "hidock-h1e",
    0x0101: "hidock-h1e",
    0x0103: "hidock-h1e",
    0xAF0E: "hidock-p1",
    0xB00E: "hidock-p1",
    0x2040: "hidock-p1",
    0xAF0F: "hidock-p1-mini",
    0x2041: "hidock-p1-mini",
}

# Default PID only used if auto-discovery fails and no config exists
# Using first in list arbitrarily - all devices are equally valid
DEFAULT_PRODUCT_ID = HIDOCK_PRODUCT_IDS[0] if HIDOCK_PRODUCT_IDS else 0xAF0C

# Target endpoints
EP_OUT_ADDR = 0x01  # Physical endpoint 0x01, OUT direction
EP_IN_ADDR = 0x82  # Physical endpoint 0x02, IN direction

# --- Command IDs ---
CMD_GET_DEVICE_INFO = 1
CMD_GET_DEVICE_TIME = 2
CMD_SET_DEVICE_TIME = 3
CMD_GET_FILE_LIST = 4
CMD_TRANSFER_FILE = 5  # Streaming
CMD_GET_FILE_COUNT = 6
CMD_DELETE_FILE = 7
CMD_REQUEST_FIRMWARE_UPGRADE = 8    # Firmware update preparation
CMD_FIRMWARE_UPLOAD = 9             # Firmware binary upload  
CMD_GET_SETTINGS = 11               # For autoRecord, autoPlay, etc.
CMD_SET_SETTINGS = 12               # For autoRecord, autoPlay, etc.
CMD_GET_FILE_BLOCK = 13             # Read file in blocks
CMD_GET_CARD_INFO = 16              # Storage information
CMD_FORMAT_CARD = 17                # Format storage
CMD_GET_RECORDING_FILE = 18         # Recording metadata
CMD_RESTORE_FACTORY_SETTINGS = 19   # Factory reset
CMD_SEND_MEETING_SCHEDULE_INFO = 20 # Calendar integration

# --- New Commands from Official HiNotes (December 2025) ---
CMD_TRANSFER_FILE_PARTIAL = 21      # Partial file transfer
CMD_REQUEST_TONE_UPDATE = 22        # Request tone update
CMD_TONE_UPDATE = 23                # Apply tone update
CMD_REQUEST_UAC_UPDATE = 24         # Request UAC (USB Audio Class) update
CMD_UAC_UPDATE = 25                 # Apply UAC update

# --- Realtime Commands (All devices - no device restrictions) ---
CMD_REALTIME_READ_SETTING = 32      # Get realtime streaming settings
CMD_REALTIME_CONTROL = 33           # Start/pause/stop realtime streaming
CMD_REALTIME_TRANSFER = 34          # Get realtime audio data

# --- Bluetooth Commands (P1 devices only: hidock-p1 and hidock-p1-mini) ---
CMD_BLUETOOTH_SCAN = 4097           # Scan for Bluetooth devices
CMD_BLUETOOTH_CMD = 4098            # Bluetooth command (connect/disconnect)
CMD_BLUETOOTH_STATUS = 4099         # Get Bluetooth status
CMD_GET_BATTERY_STATUS = 4100       # Get battery status (P1 only)
CMD_BT_SCAN = 4101                  # Enhanced Bluetooth scan
CMD_BT_DEV_LIST = 4102              # Get discovered device list
CMD_BT_GET_PAIRED_DEV_LIST = 4103   # Get paired devices list
CMD_BT_REMOVE_PAIRED_DEV = 4104     # Remove paired device

# --- Factory/Debug Commands ---
CMD_FACTORY_RESET = 61451           # Full factory reset
CMD_BLUE_B_TIMEOUT = 61457          # Bluetooth timeout setting

# Command 10 - Status: DOES NOT EXIST (causes device failure)
# Command 14 - Status: SUPPORTED (returns empty response)
# Command 15 - Status: SUPPORTED (returns empty response)

# --- THEORETICAL/STUB Extended Jensen Protocol Command IDs ---
# ⚠️  WARNING: These commands are THEORETICAL and likely DO NOT EXIST in actual firmware
# ⚠️  They were created based on speculation, not actual reverse engineering evidence
# ⚠️  DO NOT USE with real hardware - they are provided as STUBS for future development

# These are commented out to prevent accidental use:
# CMD_GET_HARDWARE_INFO = 21          # STUB - Theoretical hardware specs
# CMD_DIRECT_MEMORY_READ = 22         # STUB - Theoretical memory access
# CMD_DIRECT_MEMORY_WRITE = 23        # STUB - Theoretical memory modification
# CMD_GPIO_CONTROL = 24               # STUB - Theoretical GPIO control
# CMD_DSP_DIRECT_ACCESS = 25          # STUB - Theoretical DSP access
# CMD_STORAGE_RAW_ACCESS = 26         # STUB - Theoretical storage access
# CMD_BOOTLOADER_ACCESS = 27          # STUB - Theoretical bootloader access
# CMD_DEBUG_INTERFACE = 28            # STUB - Theoretical debug features
# CMD_PERFORMANCE_MONITORING = 29     # STUB - Theoretical metrics
# CMD_SECURITY_BYPASS = 30            # STUB - Theoretical security bypass
# [Commands 31-50 are all THEORETICAL STUBS - not implemented in real firmware]

# Configuration file name (although primarily used by config_manager,
# keeping it here if it's considered a fundamental constant of the app system)
# Alternatively, it can be moved to config_and_logger.py if preferred.
# For now, placing it with other fundamental identifiers.
CONFIG_FILE_NAME = "hidock_config.json"
