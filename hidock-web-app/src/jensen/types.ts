/**
 * @fileoverview
 * This file contains all the type definitions for the Jensen protocol module.
 */

export type LogLevel = 'info' | 'debug' | 'error';

export interface LogEntry {
    level: LogLevel;
    module: string;
    procedure: string;
    message: string;
    time: number;
}

export interface DeviceInfo {
    versionCode: string;
    versionNumber: number;
    sn: string;
}

export interface DeviceTime {
    time: string;
}

export interface FileCount {
    count: number;
}

export interface FileInfo {
    name: string;
    createDate: string;
    createTime: string;
    time: Date | null;
    duration: number;
    version: number;
    length: number;
    signature: string;
}

export interface CardInfo {
    used: number;
    capacity: number;
    status: string;
}

export interface DeviceSettings {
    autoRecord: boolean;
    autoPlay: boolean;
    bluetoothTone: boolean;
    notification?: boolean;
}

export interface BluetoothDevice {
    name: string;
    mac: string;
}

export interface BluetoothStatus {
    status: 'connected' | 'disconnected';
    mac?: string;
    name?: string;
    a2dp?: boolean;
    hfp?: boolean;
    avrcp?: boolean;
    battery?: number;
}

export interface MeetingSchedule {
    platform: string;
    os: 'Windows' | 'Mac' | 'Linux';
    startDate?: Date;
    endDate?: Date;
}

export interface SimpleStatusResponse {
    result: 'success' | 'failed' | 'not-exists' | 'wrong-version' | 'busy' | 'card-full' | 'card-error' | string;
    code?: number;
}

export type ProgressCallback = (transferred: number, total: number) => void;

export type DataCallback = (data: Uint8Array | 'fail') => void;
