/**
 * @fileoverview
 * This file contains utility functions for the Jensen protocol module,
 * including date formatting, BCD conversion, and byte manipulation.
 */

/**
 * Date formatting utility
 * Converts Date object to a string format "YYYYMMDDHHMMSS"
 * @param date - The Date object to format
 */
export function formatDateToBCDString(date: Date): string {
    const pad = (num: number) => num.toString().padStart(2, '0');

    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
           `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Hex string to byte array conversion utility
 * @param hexString - Hex string (e.g., "1234ABCD")
 * @returns Array of bytes
 */
export function hexStringToBytes(hexString: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < hexString.length; i += 2) {
        bytes.push(parseInt(hexString.substr(i, 2), 16));
    }
    return bytes;
}

/**
 * Convert a string of decimal digits to BCD (Binary Coded Decimal) format.
 * Each pair of digits is encoded into a single byte.
 * @param decimalString - A string containing only decimal digits (e.g., "20240101")
 * @returns An array of BCD-encoded bytes.
 */
export function toBcd(decimalString: string): number[] {
    const bcdBytes: number[] = [];
    for (let i = 0; i < decimalString.length; i += 2) {
        const highNibble = parseInt(decimalString[i], 10);
        const lowNibble = parseInt(decimalString[i + 1], 10);
        bcdBytes.push((highNibble << 4) | lowNibble);
    }
    return bcdBytes;
}

/**
 * Convert an array of BCD-encoded bytes back to a decimal string.
 * @param bcdBytes - An array of BCD-encoded bytes.
 * @returns A string of decimal digits.
 */
export function fromBcd(bcdBytes: number[]): string {
    let result = "";
    for (const byte of bcdBytes) {
        result += (byte >> 4).toString();
        result += (byte & 0x0F).toString();
    }
    return result;
}

/**
 * Reads a 16-bit big-endian unsigned integer from a buffer.
 * @param buffer - The buffer to read from.
 * @param offset - The offset to start reading at.
 * @returns The 16-bit number.
 */
export function read16BitBigEndian(buffer: Uint8Array, offset: number): number {
    return ((buffer[offset] & 0xFF) << 8) | (buffer[offset + 1] & 0xFF);
}

/**
 * Reads a 32-bit big-endian unsigned integer from a buffer.
 * @param buffer - The buffer to read from.
 * @param offset - The offset to start reading at.
 * @returns The 32-bit number.
 */
export function read32BitBigEndian(buffer: Uint8Array, offset: number): number {
    return ((buffer[offset] & 0xFF) << 24) |
           ((buffer[offset + 1] & 0xFF) << 16) |
           ((buffer[offset + 2] & 0xFF) << 8) |
           (buffer[offset + 3] & 0xFF);
}
