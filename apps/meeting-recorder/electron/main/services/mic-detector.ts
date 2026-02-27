import { exec } from "child_process";
import { readFileSync, existsSync } from "fs";

export interface MicStatus {
  active: boolean;
  appName?: string;
  error?: string;
}

export interface MicDetectorOptions {
  pollIntervalMs?: number;
  gracePeriodMs?: number;
}

export class MicDetector {
  private pollIntervalMs: number;
  private gracePeriodMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastActiveTime: number | null = null;
  private running = false;

  constructor(options: MicDetectorOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 3000;
    this.gracePeriodMs = options.gracePeriodMs ?? 30000;
  }

  async poll(): Promise<MicStatus> {
    try {
      const platform = process.platform;
      let rawStatus: MicStatus;
      if (platform === "linux") {
        rawStatus = await this.pollLinux();
      } else if (platform === "darwin") {
        rawStatus = await this.pollMacOS();
      } else if (platform === "win32") {
        rawStatus = await this.pollWindows();
      } else {
        rawStatus = {
          active: false,
          error: `Unsupported platform: ${platform}`,
        };
      }
      return this.applyGracePeriod(rawStatus);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[MicDetector] Poll error:", msg);
      return { active: false, error: msg };
    }
  }

  start(callback: (status: MicStatus) => void): void {
    if (this.running) return;
    this.running = true;

    const doPoll = async () => {
      const status = await this.poll();
      callback(status);
    };

    doPoll();
    this.timer = setInterval(doPoll, this.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private applyGracePeriod(status: MicStatus): MicStatus {
    const now = Date.now();

    if (status.active) {
      this.lastActiveTime = now;
      return status;
    }

    if (
      this.lastActiveTime !== null &&
      now - this.lastActiveTime < this.gracePeriodMs
    ) {
      return { active: true, appName: status.appName };
    }

    return status;
  }

  private pollLinux(): Promise<MicStatus> {
    return new Promise((resolve) => {
      exec("pactl list source-outputs 2>/dev/null", (err, stdout) => {
        if (!err && stdout.trim().length > 0) {
          const appMatch = stdout.match(/application\.name\s*=\s*"([^"]+)"/);
          resolve({
            active: true,
            appName: appMatch?.[1] ?? undefined,
          });
          return;
        }

        exec("pw-cli list-objects 2>/dev/null", (err2, stdout2) => {
          if (!err2 && stdout2.includes("Audio/Source")) {
            resolve({ active: true });
            return;
          }

          try {
            if (existsSync("/proc/asound")) {
              const cards = readFileSync("/proc/asound/cards", "utf-8");
              if (cards.trim().length > 0) {
                const pcmMatch = cards.match(/\s*(\d+)\s/);
                if (pcmMatch) {
                  const cardPath = `/proc/asound/card${pcmMatch[1]}/pcm0c/sub0/status`;
                  if (existsSync(cardPath)) {
                    const status = readFileSync(cardPath, "utf-8");
                    if (status.includes("RUNNING")) {
                      resolve({ active: true });
                      return;
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn("[MicDetector] ALSA fallback error:", e);
          }

          resolve({ active: false });
        });
      });
    });
  }

  private pollMacOS(): Promise<MicStatus> {
    return new Promise((resolve) => {
      exec("lsof -c coreaudiod 2>/dev/null", (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve({ active: false });
          return;
        }
        const parts = stdout.trim().split(/\s+/);
        resolve({ active: true, appName: parts[0] ?? undefined });
      });
    });
  }

  private pollWindows(): Promise<MicStatus> {
    return new Promise((resolve) => {
      const regPaths = [
        "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged",
        "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone",
      ];

      let resolved = false;
      let pending = regPaths.length;

      for (const regPath of regPaths) {
        exec(`reg query "${regPath}" /s 2>nul`, (err, stdout) => {
          pending--;
          if (!resolved && !err && stdout) {
            const startMatch = stdout.match(
              /LastUsedTimeStart\s+REG_QWORD\s+0x([0-9a-fA-F]+)/,
            );
            const stopMatch = stdout.match(
              /LastUsedTimeStop\s+REG_QWORD\s+0x([0-9a-fA-F]+)/,
            );

            if (startMatch && stopMatch) {
              const start = parseInt(startMatch[1], 16);
              const stop = parseInt(stopMatch[1], 16);
              if (start > 0 && stop === 0) {
                resolved = true;
                resolve({ active: true });
                return;
              }
            }
          }

          if (pending === 0 && !resolved) {
            resolve({ active: false });
          }
        });
      }
    });
  }
}
