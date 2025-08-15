/**
 * @fileoverview
 * This file defines the core data structures for the Jensen protocol,
 * including the packet for sending commands and the response structure.
 */

import { ProgressCallback } from './types';

/**
 * Represents a command packet to be sent to the device.
 */
export class JensenPacket {
    public command: number;
    public msgBody: number[] = [];
    public index = 0;
    public expireTime = 0;
    public onprogress: ProgressCallback | null = null;

    /**
     * @param command - The command code from COMMAND_CODES.
     */
    constructor(command: number) {
        this.command = command;
    }

    /**
     * Sets the packet body/payload.
     * @param bodyBytes - An array of bytes for the packet payload.
     * @returns The current packet instance for chaining.
     */
    public body(bodyBytes: number[]): this {
        this.msgBody = bodyBytes;
        return this;
    }

    /**
     * Sets the packet expiration time.
     * @param seconds - Seconds from now when the packet should expire.
     */
    public expireAfter(seconds: number): void {
        this.expireTime = new Date().getTime() + (seconds * 1000);
    }

    /**
     * Sets the packet sequence number.
     * @param sequenceId - The sequence ID for this packet.
     * @returns The current packet instance for chaining.
     */
    public sequence(sequenceId: number): this {
        this.index = sequenceId;
        return this;
    }

    /**
     * Builds the final packet bytes for transmission.
     *
     * Jensen Protocol Packet Structure:
     *
     * Bytes 0-1:   Sync bytes (0x12, 0x34)
     * Bytes 2-3:   Command ID (16-bit big-endian)
     * Bytes 4-7:   Sequence ID (32-bit big-endian)
     * Bytes 8-11:  Body length (32-bit big-endian)
     * Bytes 12+:   Body data
     *
     * @returns A Uint8Array containing the complete packet ready for transmission.
     */
    public make(): Uint8Array {
        const packet = new Uint8Array(12 + this.msgBody.length);
        let offset = 0;

        // Sync bytes - packet header identification
        packet[offset++] = 0x12;
        packet[offset++] = 0x34;

        // Command ID (16-bit big-endian)
        packet[offset++] = (this.command >> 8) & 0xFF;
        packet[offset++] = this.command & 0xFF;

        // Sequence ID (32-bit big-endian)
        packet[offset++] = (this.index >> 24) & 0xFF;
        packet[offset++] = (this.index >> 16) & 0xFF;
        packet[offset++] = (this.index >> 8) & 0xFF;
        packet[offset++] = this.index & 0xFF;

        // Body length (32-bit big-endian)
        const bodyLength = this.msgBody.length;
        packet[offset++] = (bodyLength >> 24) & 0xFF;
        packet[offset++] = (bodyLength >> 16) & 0xFF;
        packet[offset++] = (bodyLength >> 8) & 0xFF;
        packet[offset++] = bodyLength & 0xFF;

        // Copy body data
        for (let i = 0; i < this.msgBody.length; i++) {
            packet[offset++] = this.msgBody[i] & 0xFF;
        }

        return packet;
    }
}

/**
 * Represents a response packet received from the device.
 */
export class JensenResponse {
    public id: number;
    public sequence: number;
    public body: Uint8Array;

    /**
     * @param commandId - The command ID this response is for.
     * @param sequence - The sequence number of the response.
     * @param body - The response body data.
     */
    constructor(commandId: number, sequence: number, body: Uint8Array) {
        this.id = commandId;
        this.sequence = sequence;
        this.body = body;
    }
}
