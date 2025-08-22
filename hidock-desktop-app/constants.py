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
DEFAULT_PRODUCT_ID = 0xB00E  # The PID for HiDock P1 as a default

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
CMD_GET_FILE_BLOCK = 13  # Not currently used in this script's logic, but defined
CMD_GET_SETTINGS = 11  # For autoRecord, autoPlay, etc.
CMD_SET_SETTINGS = 12  # For autoRecord, autoPlay, etc.
CMD_GET_CARD_INFO = 16
CMD_FORMAT_CARD = 17
CMD_GET_RECORDING_FILE = 18

# Configuration file name (although primarily used by config_manager,
# keeping it here if it's considered a fundamental constant of the app system)
# Alternatively, it can be moved to config_and_logger.py if preferred.
# For now, placing it with other fundamental identifiers.
CONFIG_FILE_NAME = "hidock_config.json"
