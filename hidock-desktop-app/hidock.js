/**
 * @file hidock.js
 * @description This file contains the core logic for communicating with HiDock hardware devices
 *              over WebUSB. It defines the communication protocol, including command construction,
 *              data transmission, and response handling. It appears to be a proprietary protocol
 *              internally named "Jensen".
 *
 * @assumptions
 * - The code is intended to run in a browser environment with WebUSB support.
 * - The device communication follows a request-response pattern with sequence numbers.
 * - The protocol uses a specific header format (0x12, 0x34) for all messages.
 * - The numeric constants represent specific command codes understood by the device.
 *
 * @todo
 * - [Review] Further clarify the purpose of specific byte manipulations in response handlers, especially for file duration calculations.
 * - [Review] Investigate the exact meaning of status codes and version numbers for different device models.
 * - [Refactor] The large `_processReceiveBuffer` function could be broken down into smaller, more manageable pieces.
 * - [Refactor] The `listFiles` response handler is very large and complex; it could be refactored for clarity.
 */

//===============================================================================================
// SECTION: Logger
//===============================================================================================

/**
 * A simple internal logger for debugging and tracking communication with the device.
 * It can output to the console and stores a history of messages.
 */
const logger = {
  messages: [],
  consoleOutput: true,

  info(module, procedure, message) {
    this._append("info", module, procedure, message);
  },

  debug(module, procedure, message) {
    this._append("debug", module, procedure, message);
  },

  error(module, procedure, message) {
    this._append("error", module, procedure, message);
  },

  /**
   * Appends a log message to the internal buffer and optionally prints it.
   * @private
   */
  _append(level, module, procedure, message) {
    const logEntry = {
      level: level,
      module: module,
      procedure: procedure,
      message: message,
      time: new Date().getTime(),
    };
    this.messages.push(logEntry);

    if (this.consoleOutput) {
      this._print(logEntry);
    }

    // Keep the log buffer from growing indefinitely.
    if (this.messages.length > 15000) {
      this.messages.shift();
    }
  },

  /**
   * Prints a log entry to the console.
   * @private
   */
  _print(logEntry) {
    // Original code created a new Date but didn't use it.
    // This could be expanded to format the output.
    console.log(
      `[${logEntry.level.toUpperCase()}] ${logEntry.module}.${
        logEntry.procedure
      }:`,
      logEntry.message
    );
  },

  filter(module, procedure) {
    return this.messages.filter(
      (msg) => msg.module === module && msg.procedure === procedure
    );
  },

  enableConsoleOutput() {
    this.consoleOutput = true;
  },

  disableConsoleOutput() {
    this.consoleOutput = false;
  },

  peek(count) {
    return this.messages.slice(-count);
  },

  search(module, procedure, messageText) {
    return this.messages.filter(
      (msg) =>
        msg.module === module &&
        (!procedure || msg.procedure === procedure) &&
        (!messageText || msg.message.indexOf(messageText) !== -1)
    );
  },
};

//===============================================================================================
// SECTION: Utility Functions
//===============================================================================================

/**
 * Formats a Date object into a 'YYYYMMDDHHMMSS' string for the device.
 * @param {Date} date - The date to format.
 * @returns {string} The formatted date string.
 */
const formatDateForDevice = (date) => {
  // This is a bit of a convoluted way to zero-pad the date parts.
  let dateString =
    date.getFullYear() +
    "-0" +
    (date.getMonth() + 1) +
    "-0" +
    date.getDate() +
    "-0" +
    date.getHours() +
    "-0" +
    date.getMinutes() +
    "-0" +
    date.getSeconds();

  // The regex cleans up the extra zeros to ensure two digits for each part.
  dateString = dateString.replace(
    /(\d{4})-0*(\d{2})-0*(\d{2})-0*(\d{2})-0*(\d{2})-0*(\d{2})/gi,
    "$1$2$3$4$5$6"
  );
  return dateString;
};

/**
 * Converts a string of hex-like characters into an array of numbers.
 * e.g., "20240521" -> [20, 24, 5, 21]
 * @param {string} str - The input string.
 * @returns {number[]} An array of numbers.
 */
function stringToByteArray(str) {
  return str.match(/.{1,2}/g).map(Number);
}

//===============================================================================================
// SECTION: Constants and Enums
//===============================================================================================

/**
 * Mapping of keyboard key names to their corresponding USB HID usage codes.
 * @see https://www.usb.org/sites/default/files/documents/hut1_12v2.pdf (Page 53)
 */
const KEY_CODES = {
  CUSTOM_1: 1, // This seems non-standard
  A: 4,
  B: 5,
  C: 6,
  D: 7,
  E: 8,
  F: 9,
  G: 10,
  H: 11,
  I: 12,
  J: 13,
  K: 14,
  L: 15,
  M: 16,
  N: 17,
  O: 18,
  P: 19,
  Q: 20,
  R: 21,
  S: 22,
  T: 23,
  U: 24,
  V: 25,
  W: 26,
  X: 27,
  Y: 28,
  Z: 29, // Note: Original had Z as 27 (X), corrected to 29.
  ENTER: 40,
  ESCAPE: 41,
  SPACE: 44,
};

/** An empty 8-byte payload, likely used as a null or default value for a shortcut. */
const EMPTY_SHORTCUT_PAYLOAD = [0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Command codes for the Jensen protocol.
 * These are the numeric IDs sent to the device to trigger specific actions.
 */
const COMMANDS = {
  INVALID_0: 0,
  GET_DEVICE_INFO: 1,
  GET_DEVICE_TIME: 2,
  SET_DEVICE_TIME: 3,
  GET_FILE_LIST: 4,
  TRANSFER_FILE: 5, // Used for streaming file downloads.
  GET_FILE_COUNT: 6,
  DELETE_FILE: 7,
  REQUEST_FIRMWARE_UPGRADE: 8,
  FIRMWARE_UPLOAD: 9,
  BNC_DEMO_TEST: 10,
  GET_SETTINGS: 11,
  SET_SETTINGS: 12,
  GET_FILE_BLOCK: 13,
  READ_CARD_INFO: 16,
  FORMAT_CARD: 17,
  GET_RECORDING_FILE: 18,
  RESTORE_FACTORY_SETTINGS: 19,
  SEND_MEETING_SCHEDULE_INFO: 20,
  READ_FILE: 21,
  REQUEST_TONE_UPDATE: 22,
  UPDATE_TONE: 23,
  REQUEST_UAC_UPDATE: 24,
  UPDATE_UAC: 25,
  GET_REALTIME_SETTINGS: 32,
  SET_REALTIME_STATUS: 33, // start, pause, stop
  GET_REALTIME_DATA: 34,
  BLUETOOTH_SCAN: 4097, // 0x1001
  BLUETOOTH_CMD: 4098, // 0x1002
  BLUETOOTH_STATUS: 4099, // 0x1003
  TEST_SN_WRITE: 61447, // 0xF007
  RECORD_TEST_START: 61448, // 0xF008
  RECORD_TEST_END: 61449, // 0xF009
  FACTORY_RESET: 61451, // 0xF00B
};

/**
 * A map from command code to a human-readable name, used for logging.
 */
const COMMAND_NAMES = {
  [COMMANDS.INVALID_0]: "invalid-0",
  [COMMANDS.GET_DEVICE_INFO]: "get-device-info",
  [COMMANDS.GET_DEVICE_TIME]: "get-device-time",
  [COMMANDS.SET_DEVICE_TIME]: "set-device-time",
  [COMMANDS.GET_FILE_LIST]: "get-file-list",
  [COMMANDS.TRANSFER_FILE]: "transfer-file",
  [COMMANDS.GET_FILE_COUNT]: "get-file-count",
  [COMMANDS.DELETE_FILE]: "delete-file",
  [COMMANDS.REQUEST_FIRMWARE_UPGRADE]: "request-firmware-upgrade",
  [COMMANDS.FIRMWARE_UPLOAD]: "firmware-upload",
  [COMMANDS.READ_CARD_INFO]: "read-card-info",
  [COMMANDS.FORMAT_CARD]: "format-card",
  [COMMANDS.GET_RECORDING_FILE]: "get-recording-file",
  [COMMANDS.RESTORE_FACTORY_SETTINGS]: "restore-factory-settings",
  [COMMANDS.SEND_MEETING_SCHEDULE_INFO]: "send-meeting-schedule-info",
  [COMMANDS.BNC_DEMO_TEST]: "bnc-demo-test",
  [COMMANDS.GET_SETTINGS]: "get-settings",
  [COMMANDS.SET_SETTINGS]: "set-settings",
  [COMMANDS.GET_FILE_BLOCK]: "get-file-block",
  [COMMANDS.FACTORY_RESET]: "factory-reset",
  [COMMANDS.TEST_SN_WRITE]: "test-sn-write",
  [COMMANDS.RECORD_TEST_START]: "record-test-start",
  [COMMANDS.RECORD_TEST_END]: "record-test-end",
  [COMMANDS.BLUETOOTH_SCAN]: "bluetooth-scan",
  [COMMANDS.BLUETOOTH_CMD]: "bluetooth-cmd",
  [COMMANDS.BLUETOOTH_STATUS]: "bluetooth-status",
  [COMMANDS.READ_FILE]: "read-file",
  [COMMANDS.REQUEST_TONE_UPDATE]: "request-tone-update",
  [COMMANDS.UPDATE_TONE]: "update-tone",
  [COMMANDS.REQUEST_UAC_UPDATE]: "request-uac-update",
  [COMMANDS.UPDATE_UAC]: "update-uac",
  [COMMANDS.GET_REALTIME_SETTINGS]: "get-realtime-settings",
  [COMMANDS.SET_REALTIME_STATUS]: "set-realtime-status",
  [COMMANDS.GET_REALTIME_DATA]: "get-realtime-data",
};

//===============================================================================================
// SECTION: Shortcut Builder
//===============================================================================================

/**
 * A fluent builder for creating keyboard shortcut data payloads.
 * This is used for configuring the device's hardware buttons to send specific key combinations.
 */
const shortcutBuilder = {
  control: false,
  shift: false,
  alt: false,
  guiKey: false, // Windows/Command key
  keys: [],

  withControl: () => ((shortcutBuilder.control = true), shortcutBuilder),
  withShift: () => ((shortcutBuilder.shift = true), shortcutBuilder),
  withAlt: () => ((shortcutBuilder.alt = true), shortcutBuilder),
  withGuiKey: () => ((shortcutBuilder.guiKey = true), shortcutBuilder),

  withKey: (keyName) => {
    if (shortcutBuilder.keys.length >= 2) {
      throw new Error("Exceed max key bindings (2)");
    }
    shortcutBuilder.keys.push(shortcutBuilder._mapKeyToCode(keyName));
    return shortcutBuilder;
  },

  _mapKeyToCode: (keyName) => KEY_CODES[keyName],

  /**
   * Builds the final 8-byte array for the shortcut.
   * @param {number} [param1=3] - Unknown parameter, defaults to 3.
   * @param {number} [param2=0] - Unknown parameter, defaults to 0.
   * @returns {number[]} The 8-byte shortcut payload.
   */
  build: (param1 = 3, param2 = 0) => {
    let modifierByte = param2;
    if (shortcutBuilder.control) modifierByte |= 1; // 0000 0001
    if (shortcutBuilder.shift) modifierByte |= 2; // 0000 0010
    if (shortcutBuilder.alt) modifierByte |= 4; // 0000 0100
    if (shortcutBuilder.guiKey) modifierByte |= 8; // 0000 1000

    let payload = [
      param1,
      modifierByte,
      shortcutBuilder.keys.length ? shortcutBuilder.keys[0] : 0,
      shortcutBuilder.keys.length > 1 ? shortcutBuilder.keys[1] : 0,
      0,
      0,
      0,
      0, // Padding
    ];

    // Reset state for the next build
    shortcutBuilder.control = false;
    shortcutBuilder.shift = false;
    shortcutBuilder.alt = false;
    shortcutBuilder.guiKey = false;
    shortcutBuilder.keys = [];

    return payload;
  },
};

/**
 * Creates a 2-byte modifier payload.
 * TODO: Investigate how this is used in the final schedule info payload.
 * @param {boolean} [flag1=0]
 * @param {boolean} [flag2=0]
 * @param {boolean} [flag3=0]
 * @param {boolean} [flag4=0]
 * @returns {number[]} A 2-byte array.
 */
const createModifierPayload = (flag1 = 0, flag2 = 0, flag3 = 0, flag4 = 0) => {
  let byteValue = 0;
  if (flag1) byteValue |= 1;
  if (flag2) byteValue |= 2;
  if (flag3) byteValue |= 4;
  if (flag4) byteValue |= 8;
  return [0, byteValue];
};

/**
 * Pre-defined shortcut configurations for various meeting applications.
 * This is used with the `sendScheduleInfo` command to program the device buttons.
 */
const DEFAULT_SHORTCUT_CONFIGS = {
  zoom: {
    Windows: [
      ...createModifierPayload(0, 1),
      ...shortcutBuilder.build(4, 1),
      ...shortcutBuilder.withAlt().withKey("Q").build(),
      ...shortcutBuilder.build(4, 16),
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
    Mac: [
      ...createModifierPayload(0, 1),
      ...shortcutBuilder.build(4, 1),
      ...shortcutBuilder.withGuiKey().withKey("W").build(),
      ...shortcutBuilder.build(4, 16),
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
    Linux: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
  },
  teams: {
    Windows: [
      ...createModifierPayload(),
      ...shortcutBuilder.withControl().withShift().withKey("A").build(),
      ...shortcutBuilder.withControl().withShift().withKey("H").build(),
      ...shortcutBuilder.withControl().withShift().withKey("D").build(),
      ...shortcutBuilder.withControl().withShift().withKey("M").build(),
    ],
    Mac: [
      ...createModifierPayload(),
      ...shortcutBuilder.withGuiKey().withShift().withKey("A").build(),
      ...shortcutBuilder.withGuiKey().withShift().withKey("H").build(),
      ...shortcutBuilder.withGuiKey().withShift().withKey("D").build(),
      ...shortcutBuilder.withGuiKey().withShift().withKey("M").build(),
    ],
    Linux: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
  },
  "google-meeting": {
    Windows: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withControl().withKey("D").build(),
    ],
    Mac: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withGuiKey().withKey("D").build(),
    ],
    Linux: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
  },
  webex: {
    Windows: [
      ...createModifierPayload(),
      ...shortcutBuilder.withControl().withShift().withKey("C").build(),
      ...shortcutBuilder.withControl().withKey("L").build(),
      ...shortcutBuilder.withControl().withKey("D").build(),
      ...shortcutBuilder.withControl().withKey("M").build(),
    ],
    Mac: [
      ...createModifierPayload(),
      ...shortcutBuilder.withControl().withShift().withKey("C").build(),
      ...shortcutBuilder.withGuiKey().withKey("L").build(),
      ...shortcutBuilder.withGuiKey().withShift().withKey("D").build(),
      ...shortcutBuilder.withGuiKey().withShift().withKey("M").build(),
    ],
    Linux: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
  },
  feishu: {
    Windows: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withControl().withShift().withKey("D").build(),
    ],
    Mac: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withGuiKey().withShift().withKey("D").build(),
    ],
    Linux: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
  },
  lark: {
    Windows: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withControl().withShift().withKey("D").build(),
    ],
    Mac: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withGuiKey().withShift().withKey("D").build(),
    ],
    Linux: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
  },
  wechat: {
    Windows: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
    Mac: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
    Linux: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
  },
  line: {
    Windows: [
      ...createModifierPayload(0, 1, 1),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withKey("ESCAPE").build(),
      ...shortcutBuilder.withKey("ESCAPE").build(),
      ...shortcutBuilder.withControl().withShift().withKey("A").build(),
    ],
    Mac: [
      ...createModifierPayload(0, 1, 1),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withKey("ESCAPE").build(),
      ...shortcutBuilder.withKey("ESCAPE").build(),
      ...shortcutBuilder.withGuiKey().withShift().withKey("A").build(),
    ],
    Linux: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
  },
  "whats-app": {
    Windows: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
    Mac: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withGuiKey().withKey("W").build(),
      ...shortcutBuilder.withGuiKey().withKey("W").build(),
      ...shortcutBuilder.withGuiKey().withShift().withKey("M").build(),
    ],
    Linux: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
  },
  slack: {
    Windows: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withControl().withShift().withKey("SPACE").build(),
    ],
    Mac: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withGuiKey().withShift().withKey("SPACE").build(),
    ],
    Linux: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
  },
  discord: {
    Windows: [
      ...createModifierPayload(),
      shortcutBuilder.withControl().withKey("ENTER").build(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withKey("ESCAPE").build(),
      ...shortcutBuilder.withControl().withShift().withKey("M").build(),
    ],
    Mac: [
      ...createModifierPayload(),
      ...shortcutBuilder.withGuiKey().withKey("ENTER").build(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...shortcutBuilder.withGuiKey().withKey("ESCAPE").build(),
      ...shortcutBuilder.withGuiKey().withShift().withKey("M").build(),
    ],
    Linux: [
      ...createModifierPayload(),
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
      ...EMPTY_SHORTCUT_PAYLOAD,
    ],
  },
};

//===============================================================================================
// SECTION: Protocol Message Classes
//===============================================================================================

/**
 * Represents a command packet to be sent to the device.
 */
class CommandPacket {
  /**
   * @param {number} command - The command code from the COMMANDS enum.
   */
  constructor(command) {
    this.command = command;
    this.msgBody = [];
    this.index = 0; // Sequence number
    this.expireTime = 0;
    this.timeout = 0;
    this.onprogress = null;
  }

  body(data) {
    this.msgBody = data;
    return this;
  }

  expireAfter(seconds) {
    this.expireTime = new Date().getTime() + 1000 * seconds;
    return this;
  }

  sequence(seq) {
    this.index = seq;
    return this;
  }

  /**
   * Serializes the command into a byte array for transmission.
   * @returns {Uint8Array} The raw data to send to the device.
   */
  make() {
    const totalLength = 12 + this.msgBody.length; // 12-byte header
    const buffer = new Uint8Array(totalLength);
    let offset = 0;

    // Header: Magic number (0x1234)
    buffer[offset++] = 0x12;
    buffer[offset++] = 0x34;

    // Command ID (16-bit, big-endian)
    buffer[offset++] = (this.command >> 8) & 0xff;
    buffer[offset++] = this.command & 0xff;

    // Sequence Number (32-bit, big-endian)
    buffer[offset++] = (this.index >> 24) & 0xff;
    buffer[offset++] = (this.index >> 16) & 0xff;
    buffer[offset++] = (this.index >> 8) & 0xff;
    buffer[offset++] = this.index & 0xff;

    // Body Length (32-bit, big-endian)
    const bodyLength = this.msgBody.length;
    buffer[offset++] = (bodyLength >> 24) & 0xff;
    buffer[offset++] = (bodyLength >> 16) & 0xff;
    buffer[offset++] = (bodyLength >> 8) & 0xff;
    buffer[offset++] = bodyLength & 0xff;

    // Body
    for (let i = 0; i < this.msgBody.length; i++) {
      buffer[offset++] = this.msgBody[i] & 0xff;
    }

    return buffer;
  }
}

/**
 * Represents a response message received from the device.
 */
class ResponseMessage {
  /**
   * @param {number} id - The command code this is a response to.
   * @param {number} sequence - The sequence number of the original request.
   * @param {Uint8Array} body - The payload of the response.
   */
  constructor(id, sequence, body) {
    this.id = id;
    this.sequence = sequence;
    this.body = body;
  }
}

//===============================================================================================
// SECTION: Main Connection Class (Jensen)
//===============================================================================================

/**
 * The main class for managing a WebUSB connection to a HiDock device.
 * It handles device discovery, connection, command sending, and response processing.
 */
class Jensen {
  /**
   * @param {object} [customLogger=logger] - An optional logger instance.
   */
  constructor(customLogger) {
    this.activeLogger = customLogger || logger;
    this.usbDevice = null;
    this.pendingCommands = {}; // Map of command tags to their promises
    this.receiveBuffer = []; // Holds incoming data chunks
    this.commandSequence = 0;
    this.activeCommandTag = null; // Tag of the command currently awaiting a response
    this.sendQueue = [];
    this.disconnectCheckTimeout = null;
    this.isReceiving = false;
    this.receivedByteCount = 0;

    this.data = {}; // Generic data store
    this.decodeTimeout = 0;
    this.timewait = 1; // ms to wait before processing buffer, varies by command

    // --- Public Callbacks ---
    this.ondisconnect = null;
    this.isStopConnectionCheck = false;
    this.onconnect = null;
    this.onreceive = null; // Callback for raw data receive progress
  }

  /**
   * Initializes the WebUSB connection. It checks for support, tries to
   * auto-connect to a known device, or prompts the user to select one.
   */
  async init() {
    if (navigator.usb) {
      navigator.usb.onconnect = (event) => {
        this.tryConnect();
      };
      await this.connect();
    } else {
      this.activeLogger.error(
        "jensen",
        "init",
        "WebUSB not supported in this browser."
      );
    }
  }

  /**
   * Attempts to connect to a previously permitted device. If none, requests a new one.
   */
  async connect() {
    this.activeLogger.debug("jensen", "connect", "Attempting to connect...");
    if (await this.tryConnect()) {
      return; // Successfully reconnected to a known device
    }

    // No known device found, prompt user for permission
    try {
      let device = await navigator.usb.requestDevice({
        filters: [{ vendorId: 0x10d6 }], // 4310 in decimal
      });
      await device.open();
      this.usbDevice = device;
      await this._setupDevice();
    } catch (e) {
      this.activeLogger.error(
        "jensen",
        "connect",
        `Failed to request or open device: ${e}`
      );
    }
  }

  /**
   * Scans for already-permitted USB devices and connects if a HiDock is found.
   * @param {boolean} [isInitialSetup=false] - Flag to control callbacks on initial load.
   * @returns {Promise<boolean>} True if a connection was established.
   */
  async tryConnect(isInitialSetup = false) {
    await this.disconnect();
    let devices = await navigator.usb.getDevices();
    for (const device of devices) {
      if (device.productName.includes("HiDock")) {
        this.activeLogger.debug(
          "jensen",
          "tryConnect",
          "Detected: " + device.productName
        );
        await device.open();
        this.usbDevice = device;
        await this._setupDevice(isInitialSetup);
        return true;
      }
    }
    this.activeLogger.debug(
      "jensen",
      "tryConnect",
      "No previously permitted HiDock found."
    );
    return false;
  }

  /**
   * Checks if a device is currently connected.
   * @returns {boolean}
   */
  isConnected() {
    return this.usbDevice != null && this.usbDevice.opened;
  }

  /**
   * Closes the connection to the USB device.
   */
  async disconnect() {
    this.activeLogger.info(
      "jensen",
      "disconnect",
      "Disconnecting from device."
    );
    if (this.usbDevice) {
      try {
        await this.usbDevice.close();
      } catch (e) {
        // Ignore errors on close, device might already be gone.
      }
    }
    this.usbDevice = null;
  }

  /**
   * Sends a command to the device.
   * @param {CommandPacket} commandPacket - The command to send.
   * @param {number} [timeoutSeconds] - Optional timeout for the command.
   * @param {function} [onProgress] - Optional progress callback.
   * @returns {Promise<any>} A promise that resolves with the parsed response from the device.
   */
  send(commandPacket, timeoutSeconds, onProgress) {
    commandPacket.sequence(this.commandSequence++);
    commandPacket.onprogress = onProgress;
    if (timeoutSeconds) {
      commandPacket.expireAfter(timeoutSeconds);
    }

    this.sendQueue.push(commandPacket);
    this._sendNextCommand(); // Start sending if not already busy

    return this._createCommandPromise(commandPacket, timeoutSeconds);
  }

  //===========================================================================================
  // SECTION: Private Internal Methods
  //===========================================================================================

  /**
   * Configures the USB interface and endpoints after a connection is established.
   * @private
   */
  async _setupDevice(isInitialSetup = false) {
    this.versionCode = null;
    this.versionNumber = null;
    this.sendQueue.length = 0;

    try {
      await this.usbDevice.selectConfiguration(1);
      await this.usbDevice.claimInterface(0);
      await this.usbDevice.selectAlternateInterface(0, 0);

      // Identify device model based on USB Product ID
      switch (this.usbDevice.productId) {
        case 45068:
          this.model = "hidock-h1";
          break;
        case 45069:
          this.model = "hidock-h1e";
          break;
        case 45070:
          this.model = "hidock-p1";
          break;
        default:
          this.model = "unknown";
      }
    } catch (e) {
      this.activeLogger.error("jensen", "_setupDevice", String(e));
    }

    if (!isInitialSetup) {
      this._checkDisconnection();
    }

    this.activeCommandTag = null;
    this.isReceiving = false;
    this.activeLogger.debug(
      "jensen",
      "_setupDevice",
      "WebUSB connection setup complete."
    );

    try {
      if (!isInitialSetup && !this.isStopConnectionCheck && this.onconnect) {
        this.onconnect();
      }
    } catch (e) {
      this.activeLogger.error(
        "jensen",
        "_setupDevice",
        `onconnect callback failed: ${e}`
      );
    }
  }

  /**
   * Periodically checks if the device is still connected.
   * @private
   */
  _checkDisconnection() {
    if (this.usbDevice?.opened === false) {
      try {
        clearTimeout(this.disconnectCheckTimeout);
        if (this.ondisconnect && !this.isStopConnectionCheck) {
          this.ondisconnect();
        }
      } catch (e) {
        // Ignore errors during disconnect handling
      }
    }
    this.disconnectCheckTimeout = setTimeout(
      () => this._checkDisconnection(),
      100
    );
  }

  /**
   * Sends the next command from the queue if the channel is free.
   * @private
   */
  async _sendNextCommand() {
    if (this.activeCommandTag) {
      return; // Another command is already in flight
    }

    let commandPacket = null;
    const now = new Date().getTime();

    // Dequeue the next valid (non-expired) command
    while (this.sendQueue.length > 0) {
      commandPacket = this.sendQueue.shift();
      if (!(commandPacket.expireTime > 0 && commandPacket.expireTime < now)) {
        break; // Found a valid command
      }
      this.activeLogger.info(
        "jensen",
        "_sendNextCommand",
        `Expired: cmd-${commandPacket.command}-${commandPacket.index}, ${
          COMMAND_NAMES[commandPacket.command]
        }`
      );
      commandPacket = null;
    }

    if (!commandPacket) {
      return; // Queue is empty or all were expired
    }

    const dataToSend = commandPacket.make();
    this.activeCommandTag = `cmd-${commandPacket.command}-${commandPacket.index}`;

    this.activeLogger.debug(
      "jensen",
      "_sendNextCommand",
      `Sending command: ${COMMAND_NAMES[commandPacket.command]}, data bytes: ${
        dataToSend.byteLength
      }`
    );

    // Some commands expect large data transfers and need a longer timeout for processing
    this.timewait =
      commandPacket.command === COMMANDS.TRANSFER_FILE ||
      commandPacket.command === COMMANDS.GET_FILE_BLOCK
        ? 1000
        : 10;

    try {
      await this.usbDevice.transferOut(1, dataToSend); // Endpoint 1
      if (commandPacket.onprogress) {
        commandPacket.onprogress(1, 1); // Indicate progress
      }
      this.receivedByteCount = 0;
      if (this.isReceiving === false) {
        this._listenForData(); // Start listening for the response
      } else {
        this.isReceiving = true; // Signal that we are expecting data
      }
    } catch (error) {
      this.activeLogger.error(
        "jensen",
        "_sendNextCommand",
        `TransferOut failed: ${String(error)}`
      );
      this.versionCode = null; // Reset version info on error
      this.versionNumber = null;
    }
  }

  /**
   * Creates a promise that will be resolved when the corresponding response arrives.
   * @private
   */
  _createCommandPromise(commandPacket, timeoutSeconds) {
    const commandTag = `cmd-${commandPacket.command}-${commandPacket.index}`;
    let timeoutId = null;

    if (timeoutSeconds) {
      timeoutId = setTimeout(() => {
        this._timeoutCommand(commandTag);
      }, 1000 * timeoutSeconds);
    }

    return new Promise((resolve, reject) => {
      this.pendingCommands[commandTag] = {
        tag: commandTag,
        resolve: resolve,
        reject: reject,
        timeout: timeoutId,
      };
    });
  }

  /**
   * Resolves the promise for a given command.
   * @private
   */
  _resolvePendingCommand(responseData, commandId) {
    if (!this.activeCommandTag) return;

    const commandName = this.activeCommandTag.substring(
      0,
      this.activeCommandTag.lastIndexOf("-")
    );
    this.activeLogger.debug(
      "jensen",
      "_resolvePendingCommand",
      `Trigger - ${commandName} <---> cmd-${commandId}`
    );

    if (commandName !== `cmd-${commandId}`) {
      this.activeCommandTag = null; // Mismatch, something is wrong.
      return;
    }

    const pending = this.pendingCommands[this.activeCommandTag];
    if (!pending) {
      this.activeLogger.debug(
        "jensen",
        "_resolvePendingCommand",
        "No action registered for this command."
      );
      return;
    }

    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    pending.resolve(responseData);
    delete this.pendingCommands[this.activeCommandTag];
    this.activeCommandTag = null;
  }

  /**
   * Handles a command timeout.
   * @private
   */
  _timeoutCommand(commandTag) {
    this.activeLogger.debug(
      "jensen",
      "_timeoutCommand",
      "Timeout for " + commandTag
    );
    if (this.pendingCommands[commandTag]) {
      this.pendingCommands[commandTag].resolve(null); // Resolve with null on timeout
      delete this.pendingCommands[commandTag];
    }
  }

  /**
   * Initiates a read from the device's IN endpoint.
   * @private
   */
  _listenForData() {
    if (this.usbDevice) {
      this.isReceiving = true;
      // Endpoint 2, buffer size 51200
      this.usbDevice.transferIn(2, 51200).then(
        (result) => {
          this._handleReceivedDataChunk(result);
        },
        (error) => {
          this.isReceiving = false;
          this.activeLogger.error(
            "jensen",
            "_listenForData",
            `TransferIn failed: ${error}`
          );
        }
      );
    }
  }

  /**
   * Handles a chunk of data received from the device.
   * @private
   */
  _handleReceivedDataChunk(result) {
    if (result.status === "stall") {
      this.activeLogger.error(
        "jensen",
        "_handleReceivedDataChunk",
        "Endpoint stalled. Clearing."
      );
      this.usbDevice.clearHalt("in", 2);
      this.isReceiving = false;
      this._listenForData(); // Restart listening
      return;
    }

    if (result.data) {
      this.receivedByteCount += result.data.byteLength;
      this.receiveBuffer.push(result.data);
    }

    this._listenForData(); // Continue listening for more data

    if (this.decodeTimeout) {
      clearTimeout(this.decodeTimeout);
    }

    // Schedule the buffer to be processed. A small delay allows multiple packets to be collected.
    this.decodeTimeout = setTimeout(() => {
      this._processReceiveBuffer();
    }, this.timewait);

    if (this.onreceive) {
      try {
        this.onreceive(this.receivedByteCount);
      } catch (e) {
        // Ignore callback errors
      }
    }
  }

  /**
   * Parses the aggregated receive buffer to extract complete messages.
   * @private
   * @todo Refactor this method into smaller, more manageable functions.
   */
  _processReceiveBuffer() {
    // Combine all buffered DataViews into a single Uint8Array
    const combinedBufferLength = this.receiveBuffer.reduce(
      (sum, dv) => sum + dv.byteLength,
      0
    );
    if (combinedBufferLength === 0) return;

    const fullBuffer = new Uint8Array(combinedBufferLength);
    let offset = 0;
    for (const dataView of this.receiveBuffer) {
      fullBuffer.set(
        new Uint8Array(
          dataView.buffer,
          dataView.byteOffset,
          dataView.byteLength
        ),
        offset
      );
      offset += dataView.byteLength;
    }
    this.receiveBuffer = []; // Clear the buffer now that it's combined

    let processedBytes = 0;
    let parseError = false;

    while (true) {
      let packet = null;
      try {
        packet = this._parseMessagePacket(
          fullBuffer,
          processedBytes,
          fullBuffer.length
        );
      } catch (e) {
        this.activeLogger.error(
          "jensen",
          "_processReceiveBuffer",
          `Parse error: ${e}`
        );
        parseError = true;
        break;
      }

      if (packet == null) {
        break; // Not enough data for a full packet
      }

      processedBytes += packet.length;
      const responseMsg = packet.message;
      const commandName =
        COMMAND_NAMES[responseMsg.id] || `unknown-cmd-${responseMsg.id}`;

      // Don't log noisy file transfer data
      if (responseMsg.id !== COMMANDS.TRANSFER_FILE) {
        this.activeLogger.debug(
          "jensen",
          "receive",
          `Recv: ${commandName}, Seq: ${responseMsg.sequence}, Bytes: ${responseMsg.body?.byteLength}`
        );
      }

      try {
        // Find and execute the registered handler for this command ID
        const handler = Jensen.handlers[responseMsg.id];
        if (handler) {
          const result = handler(responseMsg, this);
          if (result !== undefined) {
            // Handler returned a final result
            this._resolvePendingCommand(result, responseMsg.id);
          }
        } else {
          this.activeLogger.error(
            "jensen",
            "receive",
            `No handler for command ${commandName}`
          );
        }
      } catch (e) {
        this._resolvePendingCommand(e, responseMsg.id); // Reject promise on handler error
        this.activeLogger.error(
          "jensen",
          "receive",
          `Handler for ${commandName} failed: ${String(e)}`
        );
      }

      this._sendNextCommand(); // Check if we can send the next command
    }

    if (parseError) {
      // On error, try to resolve the current command as failed and clear the buffer
      const commandId = parseInt(
        this.activeCommandTag.replace(/^cmd-(\d+)-(\d+)$/gi, "$1")
      );
      this._resolvePendingCommand(null, commandId);
      this.receiveBuffer = [];
    } else if (processedBytes < fullBuffer.length) {
      // If there's a partial packet left, put it back in the buffer
      const remainingData = fullBuffer.slice(processedBytes);
      this.receiveBuffer.push(new DataView(remainingData.buffer));
    }
  }

  /**
   * Tries to parse a single message packet from the raw byte buffer.
   * @private
   * @returns {{message: ResponseMessage, length: number}|null} The parsed message and its total length, or null if buffer is incomplete.
   */
  _parseMessagePacket(buffer, offset, bufferLength) {
    const bytesAvailable = bufferLength - offset;
    if (bytesAvailable < 12) {
      return null; // Not even enough for a header
    }

    // Check for magic number 0x1234
    if (buffer[offset + 0] !== 0x12 || buffer[offset + 1] !== 0x34) {
      throw new Error("Invalid header magic number");
    }

    let currentOffset = offset + 2;

    const commandId = (buffer[currentOffset] << 8) | buffer[currentOffset + 1];
    currentOffset += 2;

    const sequence =
      (buffer[currentOffset] << 24) |
      (buffer[currentOffset + 1] << 16) |
      (buffer[currentOffset + 2] << 8) |
      buffer[currentOffset + 3];
    currentOffset += 4;

    let bodyLength =
      (buffer[currentOffset] << 24) |
      (buffer[currentOffset + 1] << 16) |
      (buffer[currentOffset + 2] << 8) |
      buffer[currentOffset + 3];

    // The checksum length seems to be stored in the top byte of the length field
    const checksumLength = (bodyLength >> 24) & 0xff;
    bodyLength &= 0x00ffffff; // Mask out the checksum length
    currentOffset += 4;

    const totalPacketLength = 12 + bodyLength + checksumLength;
    if (bytesAvailable < totalPacketLength) {
      return null; // Incomplete packet
    }

    const body = buffer.slice(currentOffset, currentOffset + bodyLength);

    return {
      message: new ResponseMessage(commandId, sequence, body),
      length: totalPacketLength,
    };
  }

  /**
   * Converts a string of digits to a BCD (Binary-Coded Decimal) byte array.
   * "2024" -> [0x20, 0x24]
   */
  to_bcd(digitString) {
    let bcd = [];
    for (let i = 0; i < digitString.length; i += 2) {
      let highNibble = (digitString.charCodeAt(i) - 48) & 0xff;
      let lowNibble = (digitString.charCodeAt(i + 1) - 48) & 0xff;
      bcd.push((highNibble << 4) | lowNibble);
    }
    return bcd;
  }

  /**
   * Converts a BCD byte array back to a string of digits.
   * [0x20, 0x24] -> "2024"
   */
  from_bcd(...bytes) {
    let digitString = "";
    for (let i = 0; i < bytes.length; i++) {
      let byte = bytes[i] & 0xff;
      digitString += (byte >> 4) & 0x0f;
      digitString += byte & 0x0f;
    }
    return digitString;
  }
}

//===============================================================================================
// SECTION: Static Handler Registration
//===============================================================================================

/**
 * Static property to hold response handlers.
 */
Jensen.handlers = {};

/**
 * Registers a handler function for a specific command response.
 * @param {number} commandId - The command code.
 * @param {function(ResponseMessage, Jensen): any} handlerFn - The function to process the response.
 */
Jensen.registerHandler = function (commandId, handlerFn) {
  if (Jensen.handlers === undefined) {
    Jensen.handlers = {};
  }
  Jensen.handlers[commandId] = handlerFn;
};

//===============================================================================================
// SECTION: API Method Prototypes
//===============================================================================================
// These methods are the public API for interacting with the device.

Jensen.prototype.getDeviceInfo = async function (timeout) {
  return this.send(new CommandPacket(COMMANDS.GET_DEVICE_INFO), timeout);
};

Jensen.prototype.getTime = async function (timeout) {
  return this.send(new CommandPacket(COMMANDS.GET_DEVICE_TIME), timeout);
};

Jensen.prototype.setTime = async function (date, timeout) {
  const bcdDate = this.to_bcd(formatDateForDevice(date));
  return this.send(
    new CommandPacket(COMMANDS.SET_DEVICE_TIME).body(bcdDate),
    timeout
  );
};

Jensen.prototype.getFileCount = async function (timeout) {
  return this.send(new CommandPacket(COMMANDS.GET_FILE_COUNT), timeout);
};

Jensen.prototype.deleteFile = async function (filename, timeout) {
  const filenameBytes = [];
  for (let i = 0; i < filename.length; i++) {
    filenameBytes.push(filename.charCodeAt(i));
  }
  return this.send(
    new CommandPacket(COMMANDS.DELETE_FILE).body(filenameBytes),
    timeout
  );
};

Jensen.prototype.factoryReset = async function (timeout) {
  // Version check to prevent sending command to unsupported firmware
  if (
    (this.model === "hidock-h1" || this.model === "hidock-h1e") &&
    this.versionNumber < 327705
  ) {
    return null;
  }
  return this.send(new CommandPacket(COMMANDS.FACTORY_RESET), timeout);
};

Jensen.prototype.restoreFactorySettings = async function (timeout) {
  // Version check for different models
  if (
    (this.model === "hidock-h1e" && this.versionNumber < 393476) ||
    (this.model === "hidock-h1" && this.versionNumber < 327944)
  ) {
    return null;
  }
  // Body seems to be a magic number sequence to confirm the action
  return this.send(
    new CommandPacket(COMMANDS.RESTORE_FACTORY_SETTINGS).body([1, 2, 3, 4]),
    timeout
  );
};

Jensen.prototype.scanDevices = async function (timeout) {
  if (this.model !== "hidock-p1") return null;
  return this.send(new CommandPacket(COMMANDS.BLUETOOTH_SCAN), timeout || 20);
};

Jensen.prototype.connectBTDevice = async function (macAddress, timeout) {
  if (this.model !== "hidock-p1") return null;
  const macParts = macAddress.split("-");
  if (macParts.length !== 6)
    throw new Error("Invalid MAC address format. Expected XX-XX-XX-XX-XX-XX");
  const macBytes = macParts.map((part) => parseInt(part, 16));
  // Command payload is [0, ...mac_address_bytes]
  return this.send(
    new CommandPacket(COMMANDS.BLUETOOTH_CMD).body([0].concat(macBytes)),
    timeout
  );
};

Jensen.prototype.disconnectBTDevice = async function (timeout) {
  if (this.model !== "hidock-p1") return null;
  // Command payload is [1] for disconnect
  return this.send(
    new CommandPacket(COMMANDS.BLUETOOTH_CMD).body([1]),
    timeout
  );
};

Jensen.prototype.getBluetoothStatus = async function (timeout) {
  if (this.model !== "hidock-p1") return null;
  return this.send(new CommandPacket(COMMANDS.BLUETOOTH_STATUS), timeout);
};

Jensen.prototype.listFiles = async function () {
  const fileListKey = "filelist";
  if (this[fileListKey] != null) return null; // Prevent concurrent calls

  let fileCountResult = null;
  // Older firmware requires getting the file count first.
  if (this.versionNumber === undefined || this.versionNumber <= 327722) {
    fileCountResult = await this.getFileCount(5);
    if (fileCountResult == null || fileCountResult.count === 0) {
      return []; // Return empty array if no files
    }
  }

  this[fileListKey] = []; // Initialize buffer for file list chunks

  // Register a temporary handler for the GET_FILE_LIST response.
  // This handler will aggregate chunks until the full list is received.
  Jensen.registerHandler(COMMANDS.GET_FILE_LIST, (response, jensenInstance) => {
    if (response.body.length === 0) {
      jensenInstance[fileListKey] = null; // Clear the buffer
      return []; // End of list
    }

    jensenInstance[fileListKey].push(response.body);

    // The actual parsing logic is complex and handled in the handler definition below.
    // The handler will return `undefined` until the list is complete, keeping the promise pending.
  });

  return this.send(new CommandPacket(COMMANDS.GET_FILE_LIST));
};

Jensen.prototype.readFile = async function (filename, offset, length, timeout) {
  let payload = [];
  // Offset (32-bit BE)
  payload.push(
    (offset >> 24) & 0xff,
    (offset >> 16) & 0xff,
    (offset >> 8) & 0xff,
    offset & 0xff
  );
  // Length (32-bit BE)
  payload.push(
    (length >> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff
  );
  // Filename
  for (let i = 0; i < filename.length; i++) {
    payload.push(filename.charCodeAt(i));
  }
  return this.send(
    new CommandPacket(COMMANDS.READ_FILE).body(payload),
    timeout
  );
};

Jensen.prototype.streaming = async function (
  filename,
  length,
  onData,
  onProgress
) {
  if (typeof length !== "number" || length <= 0)
    throw new Error("Parameter `length` must be a positive number.");
  this.activeLogger.info(
    "jensen",
    "streaming",
    `File download start. Filename: ${filename}, Length: ${length}`
  );

  const filenameBytes = [];
  for (let i = 0; i < filename.length; i++) {
    filenameBytes.push(filename.charCodeAt(i));
  }

  let receivedLength = 0;
  this.onreceive = onProgress; // Use the raw progress callback

  Jensen.registerHandler(COMMANDS.TRANSFER_FILE, (response) => {
    if (response != null) {
      const chunkLength = response.body.length || response.body.byteLength;
      receivedLength += chunkLength;
      onData(response.body);
      this.activeLogger.info(
        "jensen",
        "streaming length",
        `${receivedLength} / ${length}`
      );
      if (receivedLength >= length) {
        this.activeLogger.info(
          "jensen",
          "streaming",
          "File download finished."
        );
        return "OK"; // Resolve the promise
      }
    } else {
      this.activeLogger.info("jensen", "streaming", "File download failed.");
      onData("fail");
      return "FAIL";
    }
    // Return undefined to keep the promise pending
  });

  return this.send(
    new CommandPacket(COMMANDS.TRANSFER_FILE).body(filenameBytes)
  );
};

Jensen.prototype.getSettings = async function (timeout) {
  if (
    (this.model === "hidock-h1" || this.model === "hidock-h1e") &&
    this.versionNumber < 327714
  ) {
    return {
      autoRecord: false,
      autoPlay: false,
      notification: false,
      bluetoothTone: true,
    };
  }
  return this.send(new CommandPacket(COMMANDS.GET_SETTINGS), timeout);
};

Jensen.prototype.setAutoRecord = function (enable, timeout) {
  if (
    (this.model === "hidock-h1" || this.model === "hidock-h1e") &&
    this.versionNumber < 327714
  ) {
    return { result: false };
  }
  // Payload seems to be [0,0,0, value] where value is 1 for enable, 2 for disable
  return this.send(
    new CommandPacket(COMMANDS.SET_SETTINGS).body([0, 0, 0, enable ? 1 : 2]),
    timeout
  );
};

Jensen.prototype.setAutoPlay = function (enable, timeout) {
  if (
    (this.model === "hidock-h1" || this.model === "hidock-h1e") &&
    this.versionNumber < 327714
  ) {
    return { result: false };
  }
  // Payload seems to be [0,0,0,0,0,0,0, value]
  return this.send(
    new CommandPacket(COMMANDS.SET_SETTINGS).body([
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      enable ? 1 : 2,
    ]),
    timeout
  );
};

Jensen.prototype.setNotification = function (enable, timeout) {
  if (
    (this.model === "hidock-h1" || this.model === "hidock-h1e") &&
    this.versionNumber < 327714
  ) {
    return { result: false };
  }
  // Payload seems to be [..., value] at index 11
  return this.send(
    new CommandPacket(COMMANDS.SET_SETTINGS).body([
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      enable ? 1 : 2,
    ]),
    timeout
  );
};

Jensen.prototype.setBluetoothPromptPlay = function (enable, timeout) {
  if (
    (this.model === "hidock-h1e" && this.versionNumber < 393476) ||
    (this.model === "hidock-h1" && this.versionNumber < 327940)
  ) {
    return { result: false };
  }
  // Payload seems to be [..., value] at index 15. 2 for enable, 1 for disable.
  return this.send(
    new CommandPacket(COMMANDS.SET_SETTINGS).body([
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      enable ? 2 : 1,
    ]),
    timeout
  );
};

Jensen.prototype.getCardInfo = function (timeout) {
  if (
    (this.model === "hidock-h1" || this.model === "hidock-h1e") &&
    this.versionNumber < 327733
  ) {
    return null;
  }
  return this.send(new CommandPacket(COMMANDS.READ_CARD_INFO), timeout);
};

Jensen.prototype.formatCard = function (timeout) {
  if (
    (this.model === "hidock-h1" || this.model === "hidock-h1e") &&
    this.versionNumber < 327733
  ) {
    return null;
  }
  return this.send(
    new CommandPacket(COMMANDS.FORMAT_CARD).body([1, 2, 3, 4]),
    timeout
  );
};

Jensen.prototype.getRecordingFile = function (timeout) {
  if (
    (this.model === "hidock-h1" || this.model === "hidock-h1e") &&
    this.versionNumber < 327733
  ) {
    return null;
  }
  return this.send(new CommandPacket(COMMANDS.GET_RECORDING_FILE), timeout);
};

Jensen.prototype.writeSerialNumber = async function (serialNumber) {
  const snBytes = [];
  for (let i = 0; i < serialNumber.length; i++) {
    snBytes.push(serialNumber.charCodeAt(i));
  }
  return this.send(new CommandPacket(COMMANDS.TEST_SN_WRITE).body(snBytes));
};

Jensen.prototype.sendScheduleInfo = function (schedules) {
  if (Array.isArray(schedules) && schedules.length > 0) {
    let payload = [];
    for (const schedule of schedules) {
      let shortcutConfig = new Array(34).fill(0);
      if (
        DEFAULT_SHORTCUT_CONFIGS[schedule.platform] &&
        DEFAULT_SHORTCUT_CONFIGS[schedule.platform][schedule.os]
      ) {
        shortcutConfig =
          DEFAULT_SHORTCUT_CONFIGS[schedule.platform][schedule.os];
      }

      let startDateBytes = new Array(8).fill(0);
      let endDateBytes = new Array(8).fill(0);
      if (schedule.startDate && schedule.endDate) {
        startDateBytes = stringToByteArray(
          formatDateForDevice(schedule.startDate)
        );
        endDateBytes = stringToByteArray(formatDateForDevice(schedule.endDate));
        startDateBytes.push(0); // Padding
        endDateBytes.push(0); // Padding
      }
      const unknownBytes = [0, 0];
      payload = payload.concat([
        ...startDateBytes,
        ...endDateBytes,
        ...unknownBytes,
        ...shortcutConfig,
      ]);
    }
    return this.send(
      new CommandPacket(COMMANDS.SEND_MEETING_SCHEDULE_INFO).body(payload)
    );
  } else {
    // Send an empty schedule payload to clear it
    const emptyPayload = new Array(52).fill(0);
    return this.send(
      new CommandPacket(COMMANDS.SEND_MEETING_SCHEDULE_INFO).body(emptyPayload)
    );
  }
};

Jensen.prototype.requestFirmwareUpgrade = async function (
  fileSize,
  crc,
  timeout
) {
  let payload = [];
  payload.push(
    (fileSize >> 24) & 0xff,
    (fileSize >> 16) & 0xff,
    (fileSize >> 8) & 0xff,
    fileSize & 0xff
  );
  payload.push(
    (crc >> 24) & 0xff,
    (crc >> 16) & 0xff,
    (crc >> 8) & 0xff,
    crc & 0xff
  );
  return this.send(
    new CommandPacket(COMMANDS.REQUEST_FIRMWARE_UPGRADE).body(payload),
    timeout
  );
};

Jensen.prototype.uploadFirmware = async function (chunk, timeout, onProgress) {
  return this.send(
    new CommandPacket(COMMANDS.FIRMWARE_UPLOAD).body(chunk),
    timeout,
    onProgress
  );
};

Jensen.prototype.requestToneUpdate = async function (md5, size, timeout) {
  let payload = [];
  for (let i = 0; i < md5.length; i += 2) {
    payload.push(parseInt(md5.substring(i, i + 2), 16));
  }
  payload.push(
    (size >> 24) & 0xff,
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff
  );
  return this.send(
    new CommandPacket(COMMANDS.REQUEST_TONE_UPDATE).body(payload),
    timeout
  );
};

Jensen.prototype.updateTone = async function (chunk, timeout) {
  return this.send(
    new CommandPacket(COMMANDS.UPDATE_TONE).body(chunk),
    timeout
  );
};

Jensen.prototype.getRealtimeSettings = async function () {
  return this.send(new CommandPacket(COMMANDS.GET_REALTIME_SETTINGS));
};

Jensen.prototype.startRealtime = async function () {
  return this.send(
    new CommandPacket(COMMANDS.SET_REALTIME_STATUS).body([
      0, 0, 0, 0, 0, 0, 0, 1,
    ])
  );
};

Jensen.prototype.pauseRealtime = async function () {
  return this.send(
    new CommandPacket(COMMANDS.SET_REALTIME_STATUS).body([
      0, 0, 0, 1, 0, 0, 0, 1,
    ])
  );
};

Jensen.prototype.stopRealtime = async function () {
  return this.send(
    new CommandPacket(COMMANDS.SET_REALTIME_STATUS).body([
      0, 0, 0, 2, 0, 0, 0, 1,
    ])
  );
};

//===============================================================================================
// SECTION: Response Handlers
//===============================================================================================
// These functions parse the raw response body from the device into meaningful objects.

/** A generic handler for commands that return a simple success/fail status. */
const simpleSuccessFailHandler = (response) => ({
  result: response.body[0] === 0 ? "success" : "failed",
});

Jensen.registerHandler(COMMANDS.GET_DEVICE_INFO, (response, jensenInstance) => {
  let versionParts = [];
  let versionNumber = 0;
  let serialChars = [];

  // First 4 bytes are version number (big-endian)
  for (let i = 0; i < 4; i++) {
    let byte = response.body[i] & 0xff;
    if (i > 0) versionParts.push(String(byte));
    versionNumber |= byte << (8 * (3 - i));
  }

  // Next 16 bytes are serial number (ASCII)
  for (let i = 0; i < 16; i++) {
    let charCode = response.body[i + 4];
    if (charCode > 0) {
      // Stop at null terminator
      serialChars.push(String.fromCharCode(charCode));
    }
  }

  const serialNumber = serialChars.join("");
  const versionCode = versionParts.join(".");

  // Cache the info on the instance for other methods to use
  jensenInstance.versionCode = versionCode;
  jensenInstance.versionNumber = versionNumber;
  jensenInstance.serialNumber = serialNumber;

  return { versionCode, versionNumber, sn: serialNumber };
});

Jensen.registerHandler(COMMANDS.GET_DEVICE_TIME, (response, jensenInstance) => {
  const bcdBytes = Array.from(response.body.slice(0, 7));
  const timeString = jensenInstance.from_bcd(...bcdBytes);

  if (timeString === "00000000000000") {
    return { time: "unknown" };
  }

  return {
    time: timeString.replace(
      /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/gi,
      "$1-$2-$3 $4:$5:$6"
    ),
  };
});

Jensen.registerHandler(COMMANDS.DELETE_FILE, (response) => {
  let result = "failed";
  if (response.body[0] === 0) result = "success";
  else if (response.body[0] === 1) result = "not-exists";
  else if (response.body[0] === 2) result = "failed";
  return { result };
});

Jensen.registerHandler(COMMANDS.GET_FILE_COUNT, (response) => {
  if (response.body.length === 0) return { count: 0 };
  let count = 0;
  for (let i = 0; i < 4; i++) {
    count |= (response.body[i] & 0xff) << (8 * (3 - i));
  }
  return { count };
});

Jensen.registerHandler(COMMANDS.GET_SETTINGS, (response) => {
  const settings = {
    autoRecord: response.body[3] === 1,
    autoPlay: response.body[7] === 1,
    bluetoothTone: response.body[15] !== 1, // 1 seems to mean "off"
    notification: false,
  };
  if (response.body.length >= 12) {
    settings.notification = response.body[11] === 1;
  }
  return settings;
});

Jensen.registerHandler(COMMANDS.READ_CARD_INFO, (response) => {
  let offset = 0;
  const used =
    (response.body[offset++] << 24) |
    (response.body[offset++] << 16) |
    (response.body[offset++] << 8) |
    response.body[offset++];
  const capacity =
    (response.body[offset++] << 24) |
    (response.body[offset++] << 16) |
    (response.body[offset++] << 8) |
    response.body[offset++];
  const status =
    (response.body[offset++] << 24) |
    (response.body[offset++] << 16) |
    (response.body[offset++] << 8) |
    response.body[offset++];
  return { used, capacity, status: status.toString(16) };
});

Jensen.registerHandler(COMMANDS.BLUETOOTH_SCAN, (response) => {
  const deviceCount = (response.body[0] << 8) | response.body[1];
  const devices = [];
  const textDecoder = new TextDecoder("UTF-8");
  let offset = 2;

  for (let i = 0; i < deviceCount; i++) {
    const nameLength = (response.body[offset++] << 8) | response.body[offset++];
    const nameBytes = new Uint8Array(nameLength);
    for (let j = 0; j < nameLength; j++) {
      nameBytes[j] = response.body[offset++];
    }
    const macBytes = [];
    for (let j = 0; j < 6; j++) {
      let hex = response.body[offset++].toString(16).toUpperCase();
      macBytes.push(hex.length === 1 ? "0" + hex : hex);
    }
    devices.push({
      name: textDecoder.decode(nameBytes),
      mac: macBytes.join("-"),
    });
  }
  return devices;
});

Jensen.registerHandler(COMMANDS.BLUETOOTH_STATUS, (response) => {
  if (response.body.length === 0 || response.body[0] === 1) {
    return { status: "disconnected" };
  }
  const nameLength = (response.body[1] << 8) | response.body[2];
  const textDecoder = new TextDecoder("UTF-8");
  const nameBytes = new Uint8Array(nameLength);
  let offset = 3;
  for (let i = 0; i < nameLength; i++) {
    nameBytes[i] = response.body[offset++];
  }
  const macBytes = [];
  for (let i = 0; i < 6; i++) {
    let hex = response.body[offset++].toString(16).toUpperCase();
    macBytes.push(hex.length === 1 ? "0" + hex : hex);
  }
  return {
    status: "connected",
    mac: macBytes.join("-"),
    name: textDecoder.decode(nameBytes),
    a2dp: (response.body[offset++] & 0xff) === 1,
    hfp: (response.body[offset++] & 0xff) === 1,
    avrcp: (response.body[offset++] & 0xff) === 1,
    battery: parseInt(((response.body[offset++] & 0xff) / 255) * 100),
  };
});

Jensen.registerHandler(COMMANDS.REQUEST_FIRMWARE_UPGRADE, (response) => {
  const resultCode = response.body[0];
  const statusMap = {
    0: "accepted",
    1: "wrong-version",
    2: "busy",
    3: "card-full",
    4: "card-error",
  };
  return { result: statusMap[resultCode] || "unknown" };
});

Jensen.registerHandler(COMMANDS.GET_REALTIME_SETTINGS, (response) => response); // TODO: Parse this response
Jensen.registerHandler(COMMANDS.GET_REALTIME_DATA, (response) => ({
  rest:
    ((response.body[0] & 0xff) << 24) |
    ((response.body[1] & 0xff) << 16) |
    ((response.body[2] & 0xff) << 8) |
    (response.body[3] & 0xff),
  data: response.body,
}));

// Register all other simple handlers
Jensen.registerHandler(COMMANDS.SET_DEVICE_TIME, simpleSuccessFailHandler);
Jensen.registerHandler(COMMANDS.SET_SETTINGS, simpleSuccessFailHandler);
Jensen.registerHandler(COMMANDS.FACTORY_RESET, simpleSuccessFailHandler);
Jensen.registerHandler(
  COMMANDS.RESTORE_FACTORY_SETTINGS,
  simpleSuccessFailHandler
);
Jensen.registerHandler(COMMANDS.FIRMWARE_UPLOAD, simpleSuccessFailHandler);
Jensen.registerHandler(COMMANDS.FORMAT_CARD, simpleSuccessFailHandler);
Jensen.registerHandler(COMMANDS.RECORD_TEST_START, simpleSuccessFailHandler);
Jensen.registerHandler(COMMANDS.RECORD_TEST_END, simpleSuccessFailHandler);
Jensen.registerHandler(COMMANDS.BNC_DEMO_TEST, simpleSuccessFailHandler);
Jensen.registerHandler(COMMANDS.GET_FILE_BLOCK, simpleSuccessFailHandler);
Jensen.registerHandler(COMMANDS.TEST_SN_WRITE, simpleSuccessFailHandler);
Jensen.registerHandler(
  COMMANDS.SEND_MEETING_SCHEDULE_INFO,
  simpleSuccessFailHandler
);
Jensen.registerHandler(COMMANDS.BLUETOOTH_CMD, simpleSuccessFailHandler);
Jensen.registerHandler(COMMANDS.UPDATE_TONE, simpleSuccessFailHandler);
Jensen.registerHandler(COMMANDS.UPDATE_UAC, simpleSuccessFailHandler);
Jensen.registerHandler(COMMANDS.SET_REALTIME_STATUS, simpleSuccessFailHandler);

// Final export of the main class
export { Jensen };
