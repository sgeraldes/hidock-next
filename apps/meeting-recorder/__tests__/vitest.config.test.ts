/**
 * Tests for vitest.config.ts
 * Verifies the test runner configuration is correctly set up.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";

describe("vitest.config", () => {
  it("config file exists", () => {
    const configPath = resolve(__dirname, "../vitest.config.ts");
    expect(existsSync(configPath)).toBe(true);
  });

  it("maxWorkers is configured to prevent fork timeouts in WSL", () => {
    const configPath = resolve(__dirname, "../vitest.config.ts");
    const content = readFileSync(configPath, "utf8");
    expect(content).toContain("maxWorkers");
    const match = content.match(/maxWorkers:\s*(\d+)/);
    expect(match).not.toBeNull();
    const workers = parseInt(match![1], 10);
    expect(workers).toBeGreaterThanOrEqual(1);
    expect(workers).toBeLessThanOrEqual(8);
  });

  it("environmentMatchGlobs routes electron tests to node environment", () => {
    const configPath = resolve(__dirname, "../vitest.config.ts");
    const content = readFileSync(configPath, "utf8");
    expect(content).toContain('environmentMatchGlobs');
    expect(content).toContain('"node"');
  });
});
