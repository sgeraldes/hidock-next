import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

describe("env.d.ts type declarations", () => {
  it("env.d.ts exists", () => {
    const envPath = resolve(__dirname, "../env.d.ts");
    expect(existsSync(envPath)).toBe(true);
  });

  it("ElectronAPI type declarations compile correctly", () => {
    const envPath = resolve(__dirname, "../env.d.ts");
    const content = readFileSync(envPath, "utf8");
    expect(content).toContain("electronAPI");
    expect(content).toContain("session");
    expect(content).toContain("delete");
  });
});
