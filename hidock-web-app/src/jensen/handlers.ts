/**
 * @fileoverview
 * This file contains the response handlers for the Jensen protocol.
 * Each handler is responsible for parsing the response body of a specific command.
 */

import { JensenResponse } from './protocol';
import { fromBcd } from './utils';
import {
    DeviceInfo,
    DeviceTime,
    FileCount,
    DeviceSettings,
    SimpleStatusResponse,
    CardInfo,
    FileInfo as ParsedFileInfo,
    BluetoothDevice,
    BluetoothStatus
} from './types';
import { Jensen } from './jensen';

export type ResponseHandler = (response: JensenResponse, jensen: Jensen) => any;

export const responseHandlers: { [key: number]: ResponseHandler } = {};

export function registerHandler(commandId: number, handler: ResponseHandler) {
    responseHandlers[commandId] = handler;
}

// Generic success/failure response handler
const simpleStatusHandler: ResponseHandler = (response: JensenResponse): SimpleStatusResponse => {
    return { result: response.body[0] === 0 ? "success" : "failed" };
};

registerHandler(1, (response: JensenResponse, jensen: Jensen): DeviceInfo => {
    const versionBytes: string[] = [];
    let versionNumber = 0;
    const serialBytes: string[] = [];

    for (let i = 0; i < 4; i++) {
        const byte = response.body[i] & 0xFF;
        if (i > 0) versionBytes.push(String(byte));
        versionNumber |= byte << (8 * (4 - i - 1));
    }

    for (let i = 0; i < 16; i++) {
        const byte = response.body[i + 4];
        if (byte > 0) {
            serialBytes.push(String.fromCharCode(byte));
        }
    }

    const versionCode = versionBytes.join(".");
    const serialNumber = serialBytes.join("");

    jensen.versionCode = versionCode;
    jensen.versionNumber = versionNumber;
    jensen.serialNumber = serialNumber;

    return {
        versionCode,
        versionNumber,
        sn: serialNumber,
    };
});

registerHandler(2, (response: JensenResponse): DeviceTime => {
    const bcdBytes = Array.from(response.body);
    const timeString = fromBcd(bcdBytes);

    return {
        time: timeString === "00000000000000" ? "unknown" :
            timeString.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/gi, "$1-$2-$3 $4:$5:$6")
    };
});

registerHandler(3, simpleStatusHandler);

registerHandler(6, (response: JensenResponse): FileCount => {
    if (response.body.length === 0) {
        return { count: 0 };
    }
    let count = 0;
    for (let i = 0; i < 4; i++) {
        count |= (response.body[i] & 0xFF) << (8 * (4 - i - 1));
    }
    return { count };
});

registerHandler(7, (response: JensenResponse): SimpleStatusResponse => {
    let result: SimpleStatusResponse['result'] = "failed";
    switch (response.body[0]) {
        case 0: result = "success"; break;
        case 1: result = "not-exists"; break;
        case 2: result = "failed"; break;
    }
    return { result };
});

registerHandler(8, (response: JensenResponse): SimpleStatusResponse => {
    let result: SimpleStatusResponse['result'] = "unknown";
    const resultCode = response.body[0];
    switch (resultCode) {
        case 0: result = "accepted"; break;
        case 1: result = "wrong-version"; break;
        case 2: result = "busy"; break;
        case 3: result = "card-full"; break;
        case 4: result = "card-error"; break;
    }
    return { result };
});

registerHandler(9, simpleStatusHandler);
registerHandler(10, simpleStatusHandler);

registerHandler(11, (response: JensenResponse): DeviceSettings => {
    const settings: DeviceSettings = {
        autoRecord: response.body[3] === 1,
        autoPlay: response.body[7] === 1,
        bluetoothTone: response.body[15] !== 1,
    };
    if (response.body.length >= 12) {
        settings.notification = response.body[11] === 1;
    }
    return settings;
});

registerHandler(12, simpleStatusHandler); // SET_SETTINGS

registerHandler(16, (response: JensenResponse): CardInfo => {
    let t = 0;
    return {
        used:
            ((response.body[t++] & 0xFF) << 24) |
            ((response.body[t++] & 0xFF) << 16) |
            ((response.body[t++] & 0xFF) << 8) |
            (response.body[t++] & 0xFF),
        capacity:
            ((response.body[t++] & 0xFF) << 24) |
            ((response.body[t++] & 0xFF) << 16) |
            ((response.body[t++] & 0xFF) << 8) |
            (response.body[t++] & 0xFF),
        status: (
            ((response.body[t++] & 0xFF) << 24) |
            ((response.body[t++] & 0xFF) << 16) |
            ((response.body[t++] & 0xFF) << 8) |
            (response.body[t++] & 0xFF)
        ).toString(16),
    };
});

registerHandler(17, simpleStatusHandler); // FORMAT_CARD

registerHandler(18, (response: JensenResponse): { recording: ParsedFileInfo | null } => {
    if (response.body == null || response.body.length === 0) return { recording: null };

    const nameChars = Array.from(response.body).map(b => String.fromCharCode(b));
    const recordingName = nameChars.join('');

    const pad = (b: number) => b > 9 ? String(b) : "0" + b;

    let time: Date | null = null;
    if (recordingName.match(/^\d{14}REC\d+\.wav$/gi)) {
        time = new Date(recordingName.replace(
            /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})REC.*$/gi,
            "$1-$2-$3 $4:$5:$6"
        ));
    } else if (recordingName.match(/^(\d{2})?(\d{2})(\w{3})(\d{2})-(\d{2})(\d{2})(\d{2})-.*\.hda$/gi)) {
        time = new Date(recordingName.replace(
            /^(\d{2})?(\d{2})(\w{3})(\d{2})-(\d{2})(\d{2})(\d{2})-.*\.hda$/gi,
            "20$2 $3 $4 $5:$6:$7"
        ));
    }

    let createDate = "", createTimeStr = "";
    if (time) {
        createDate = `${time.getFullYear()}/${pad(time.getMonth() + 1)}/${pad(time.getDate())}`;
        createTimeStr = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
    }

    return {
        recording: {
            name: recordingName,
            createDate: createDate,
            createTime: createTimeStr,
            time: time,
            duration: 0,
            length: 0,
            version: 0, // Not available in this response
            signature: "0".repeat(32),
        }
    };
});

registerHandler(19, simpleStatusHandler); // RESTORE_FACTORY_SETTINGS
registerHandler(20, simpleStatusHandler); // SEND_MEETING_SCHEDULE
registerHandler(21, (response: JensenResponse): Uint8Array => {
    return new Uint8Array(response.body);
});

const toneUpdateHandler: ResponseHandler = (response: JensenResponse): SimpleStatusResponse => {
    const t = response.body[0];
    let n: SimpleStatusResponse['result'] = "success";
    n = t == 1 ? "length-mismatch" : t == 2 ? "busy" : t == 3 ? "card-full" : t == 4 ? "card-error" : String(t);
    return { code: t, result: n };
};

registerHandler(22, toneUpdateHandler); // REQUEST_TONE_UPDATE
registerHandler(23, simpleStatusHandler); // UPDATE_TONE
registerHandler(24, toneUpdateHandler); // REQUEST_UAC_UPDATE
registerHandler(25, simpleStatusHandler); // UPDATE_UAC

registerHandler(32, (response: JensenResponse) => response); // GET_REALTIME_SETTINGS (pass-through)
registerHandler(33, simpleStatusHandler); // CONTROL_REALTIME
registerHandler(34, (response: JensenResponse) => ({ // GET_REALTIME_DATA
    rest:
        ((response.body[0] & 0xFF) << 24) |
        ((response.body[1] & 0xFF) << 16) |
        ((response.body[2] & 0xFF) << 8) |
        (response.body[3] & 0xFF),
    data: response.body,
}));

registerHandler(4097, (response: JensenResponse): BluetoothDevice[] => { // BLUETOOTH_SCAN
    const deviceCount = ((response.body[0] & 0xFF) << 8) | (response.body[1] & 0xFF);
    const devices: BluetoothDevice[] = [];
    const decoder = new TextDecoder("UTF-8");
    let offset = 2;

    for (let i = 0; i < deviceCount; i++) {
        const nameLength = ((response.body[offset++] & 0xFF) << 8) | (response.body[offset++] & 0xFF);
        const nameBytes = new Uint8Array(nameLength);
        for (let j = 0; j < nameLength; j++) {
            nameBytes[j] = response.body[offset++] & 0xFF;
        }

        const macBytes: string[] = [];
        for (let j = 0; j < 6; j++) {
            const byte = (response.body[offset++] & 0xFF).toString(16).toUpperCase();
            macBytes.push(byte.length === 1 ? "0" + byte : byte);
        }

        devices.push({
            name: decoder.decode(nameBytes),
            mac: macBytes.join("-")
        });
    }
    return devices;
});

registerHandler(4098, simpleStatusHandler); // BLUETOOTH_CMD

registerHandler(4099, (response: JensenResponse): BluetoothStatus => { // BLUETOOTH_STATUS
    if (response.body.length == 0 || response.body[0] == 1) {
        return { status: "disconnected" };
    }

    const nameLength = ((response.body[1] & 0xFF) << 8) | (response.body[2] & 0xFF);
    const decoder = new TextDecoder("UTF-8");
    const nameBytes = new Uint8Array(nameLength);
    let offset = 3;

    for (let i = 0; i < nameLength; i++) {
        nameBytes[i] = response.body[offset++] & 0xFF;
    }

    const macBytes: string[] = [];
    for (let i = 0; i < 6; i++) {
        const byte = response.body[offset++].toString(16).toUpperCase();
        macBytes.push(byte.length === 1 ? "0" + byte : byte);
    }

    return {
        status: "connected",
        mac: macBytes.join("-"),
        name: decoder.decode(nameBytes),
        a2dp: (response.body[offset++] & 0xFF) == 1,
        hfp: (response.body[offset++] & 0xFF) == 1,
        avrcp: (response.body[offset++] & 0xFF) == 1,
        battery: parseInt(((response.body[offset++] & 0xFF) / 255) * 100),
    };
});

registerHandler(61447, simpleStatusHandler); // TEST_SN_WRITE
registerHandler(61448, simpleStatusHandler); // RECORD_TEST_START
registerHandler(61449, simpleStatusHandler); // RECORD_TEST_END
registerHandler(61451, simpleStatusHandler); // FACTORY_RESET
