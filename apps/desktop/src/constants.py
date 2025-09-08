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
DEFAULT_VENDOR_ID = 0x10D6  # Actions Semiconductor

# All known HiDock device PIDs (no hierarchy - all devices are equal)
HIDOCK_PRODUCT_IDS = [
    0xAF0C,  # H1
    0xAF0D,  # H1E (older PID)
    0xB00D,  # H1E (newer PID)
    0xAF0E,  # P1 (older PID)
    0xB00E,  # P1 (newer PID)
]

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

# Command 10 - Status: DOES NOT EXIST (causes device failure)
# Command 14 - Status: SUPPORTED (returns empty response) 
# Command 15 - Status: SUPPORTED (returns empty response)

# --- THEORETICAL/STUB Extended Jensen Protocol Command IDs (21-50) ---
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
