/**
 * @fileoverview
 * This file contains the logic for building HID keyboard reports,
 * specifically for the meeting control shortcuts feature.
 */

import { HID_KEY_CODES, EMPTY_BYTES } from './constants';

/**
 * Keyboard shortcut builder for meeting controls.
 * This class provides a fluent interface for constructing HID keyboard reports.
 */
export class KeyboardShortcutBuilder {
    private control = false;
    private shift = false;
    private alt = false;
    private guiKey = false; // Windows/Cmd key
    private keys: number[] = [];

    public withControl(): this {
        this.control = true;
        return this;
    }

    public withShift(): this {
        this.shift = true;
        return this;
    }

    public withAlt(): this {
        this.alt = true;
        return this;
    }

    public withGuiKey(): this {
        this.guiKey = true;
        return this;
    }

    public withKey(keyName: string): this {
        if (this.keys.length >= 2) {
            throw new Error("Maximum 2 keys allowed in combination");
        }
        this.keys.push(this._mapKey(keyName));
        return this;
    }

    private _mapKey(keyName: string): number {
        const keyCode = HID_KEY_CODES[keyName];
        if (keyCode === undefined) {
            throw new Error(`Unknown key name: ${keyName}`);
        }
        return keyCode;
    }

    /**
     * Build the final HID report.
     * @param reportId - HID report ID (default: 3)
     * @param reserved - Reserved byte (default: 0)
     * @returns 8-byte HID keyboard report
     */
    public build(reportId = 3, reserved = 0): number[] {
        let modifiers = reserved;

        // Build modifier byte
        if (this.control) modifiers |= 0x01;  // Left Ctrl
        if (this.shift) modifiers |= 0x02;    // Left Shift
        if (this.alt) modifiers |= 0x04;      // Left Alt
        if (this.guiKey) modifiers |= 0x08;   // Left GUI (Windows/Cmd)

        const report = [
            reportId,
            modifiers,
            this.keys.length > 0 ? this.keys[0] : 0,
            this.keys.length > 1 ? this.keys[1] : 0,
            0, 0, 0, 0  // Reserved bytes
        ];

        // Reset state for next build
        this.reset();

        return report;
    }

    public reset(): void {
        this.control = false;
        this.shift = false;
        this.alt = false;
        this.guiKey = false;
        this.keys = [];
    }
}

/**
 * Create a modifier-only keyboard report.
 * @param ctrl - Control key pressed
 * @param shift - Shift key pressed
 * @param alt - Alt key pressed
 * @param gui - GUI key pressed
 * @returns 2-byte modifier report
 */
export function createModifierReport(ctrl = false, shift = false, alt = false, gui = false): number[] {
    let modifiers = 0;
    if (ctrl) modifiers |= 0x01;
    if (shift) modifiers |= 0x02;
    if (alt) modifiers |= 0x04;
    if (gui) modifiers |= 0x08;
    return [0, modifiers];
}

/**
 * Meeting platform keyboard shortcuts configuration.
 * Maps different meeting platforms to their keyboard shortcuts for different operating systems.
 */
export const MEETING_SHORTCUTS: { [platform: string]: { [os: string]: number[] } } = {
    zoom: {
        Windows: [
            ...createModifierReport(false, true),
            ...new KeyboardShortcutBuilder().build(4, 1),
            ...new KeyboardShortcutBuilder().withAlt().withKey("Q").build(),
            ...new KeyboardShortcutBuilder().build(4, 16),
            ...EMPTY_BYTES,
        ],
        Mac: [
            ...createModifierReport(false, true),
            ...new KeyboardShortcutBuilder().build(4, 1),
            ...new KeyboardShortcutBuilder().withGuiKey().withKey("W").build(),
            ...new KeyboardShortcutBuilder().build(4, 16),
            ...EMPTY_BYTES,
        ],
        Linux: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
    },
    teams: {
        Windows: [
            ...createModifierReport(),
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("A").build(),
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("H").build(),
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("D").build(),
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("M").build(),
        ],
        Mac: [
            ...createModifierReport(),
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("A").build(),
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("H").build(),
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("D").build(),
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("M").build(),
        ],
        Linux: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
    },
    "google-meeting": {
        Windows: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withControl().withKey("D").build(),
        ],
        Mac: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withGuiKey().withKey("D").build(),
        ],
        Linux: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
    },
    webex: {
        Windows: [
            ...createModifierReport(),
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("C").build(),
            ...new KeyboardShortcutBuilder().withControl().withKey("L").build(),
            ...new KeyboardShortcutBuilder().withControl().withKey("D").build(),
            ...new KeyboardShortcutBuilder().withControl().withKey("M").build(),
        ],
        Mac: [
            ...createModifierReport(),
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("C").build(),
            ...new KeyboardShortcutBuilder().withGuiKey().withKey("L").build(),
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("D").build(),
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("M").build(),
        ],
        Linux: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
    },
    feishu: {
        Windows: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("D").build(),
        ],
        Mac: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("D").build(),
        ],
        Linux: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
    },
    lark: {
        Windows: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("D").build(),
        ],
        Mac: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("D").build(),
        ],
        Linux: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
    },
    wechat: {
        Windows: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
        Mac: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
        Linux: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
    },
    line: {
        Windows: [
            ...createModifierReport(false, true, true),
            ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withKey("ESCAPE").build(),
            ...new KeyboardShortcutBuilder().withKey("ESCAPE").build(),
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("A").build(),
        ],
        Mac: [
            ...createModifierReport(false, true, true),
            ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withKey("ESCAPE").build(),
            ...new KeyboardShortcutBuilder().withKey("ESCAPE").build(),
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("A").build(),
        ],
        Linux: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
    },
    "whats-app": {
        Windows: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
        Mac: [
            ...createModifierReport(),
            ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withGuiKey().withKey("W").build(),
            ...new KeyboardShortcutBuilder().withGuiKey().withKey("W").build(),
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("M").build(),
        ],
        Linux: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
    },
    slack: {
        Windows: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("SPACE").build(),
        ],
        Mac: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("SPACE").build(),
        ],
        Linux: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
    },
    discord: {
        Windows: [
            ...createModifierReport(),
            ...new KeyboardShortcutBuilder().withControl().withKey("ENTER").build(),
            ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withKey("ESCAPE").build(),
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("M").build(),
        ],
        Mac: [
            ...createModifierReport(),
            ...new KeyboardShortcutBuilder().withGuiKey().withKey("ENTER").build(),
            ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withGuiKey().withKey("ESCAPE").build(),
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("M").build(),
        ],
        Linux: [...createModifierReport(), ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES],
    },
};
