import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

/**
 * Model Config Performance Tests
 *
 * Quick timing assertions to ensure config operations stay fast.
 * Thresholds are generous to avoid flaky tests on slow CI machines.
 */

import { modelConfig } from "../services/model-config";

const CONFIG_PATH = path.resolve(
  __dirname,
  "../config/models.config.json",
);

describe("ModelConfigService - Performance", () => {
  describe("Config loading", () => {
    it("reading and parsing the config file completes in < 50ms", () => {
      const start = performance.now();

      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      JSON.parse(raw);

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });

    it("getFullConfig returns in < 5ms (cached access)", () => {
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        modelConfig.getFullConfig();
      }

      const elapsed = performance.now() - start;
      const perCall = elapsed / 100;
      expect(perCall).toBeLessThan(5);
    });
  });

  describe("Model validation performance", () => {
    it("validateModel < 5ms per call (100 iterations)", () => {
      const models = [
        { provider: "google", model: "gemini-2.5-flash" },
        { provider: "google", model: "gemini-2.5-pro" },
        { provider: "google", model: "gemini-2.0-flash" },
        { provider: "openai", model: "gpt-4o" },
        { provider: "anthropic", model: "claude-sonnet-4-20250514" },
        { provider: "google", model: "nonexistent-model" },
        { provider: "nonexistent-provider", model: "some-model" },
      ];

      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        for (const { provider, model } of models) {
          modelConfig.validateModel(provider, model);
        }
      }

      const elapsed = performance.now() - start;
      const totalCalls = 100 * models.length;
      const perCall = elapsed / totalCalls;

      expect(perCall).toBeLessThan(5);
    });

    it("isModelDeprecated < 5ms per call (100 iterations)", () => {
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        modelConfig.isModelDeprecated("google", "gemini-2.5-flash");
        modelConfig.isModelDeprecated("google", "gemini-2.0-flash");
        modelConfig.isModelDeprecated("openai", "gpt-4o");
      }

      const elapsed = performance.now() - start;
      const perCall = elapsed / 300;
      expect(perCall).toBeLessThan(5);
    });
  });

  describe("getModelForContext performance", () => {
    it("getModelForContext < 5ms per call (100 iterations)", () => {
      const contexts = ["realtime", "postprocess", "critical", "batch", "nonexistent"];

      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        for (const ctx of contexts) {
          modelConfig.getModelForContext("google", ctx);
        }
      }

      const elapsed = performance.now() - start;
      const totalCalls = 100 * contexts.length;
      const perCall = elapsed / totalCalls;

      expect(perCall).toBeLessThan(5);
    });
  });

  describe("Bulk operations", () => {
    it("getModelsForProvider is fast for all providers (< 5ms each)", () => {
      const providers = modelConfig.getProviderIds();

      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        for (const provider of providers) {
          modelConfig.getModelsForProvider(provider);
        }
      }

      const elapsed = performance.now() - start;
      const totalCalls = 100 * providers.length;
      const perCall = elapsed / totalCalls;

      expect(perCall).toBeLessThan(5);
    });

    it("getCostMultiplier is fast across all models (< 5ms each)", () => {
      const providers = modelConfig.getProviderIds();

      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        for (const provider of providers) {
          const models = modelConfig.getModelsForProvider(provider);
          for (const model of models) {
            modelConfig.getCostMultiplier(provider, model.id);
          }
        }
      }

      const elapsed = performance.now() - start;
      // Count total calls
      let totalModels = 0;
      for (const provider of providers) {
        totalModels += modelConfig.getModelsForProvider(provider).length;
      }
      const totalCalls = 100 * totalModels;
      const perCall = totalCalls > 0 ? elapsed / totalCalls : 0;

      expect(perCall).toBeLessThan(5);
    });

    it("getDefaultModel for all providers completes in < 10ms total", () => {
      const providers = modelConfig.getProviderIds();

      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        for (const provider of providers) {
          modelConfig.getDefaultModel(provider);
        }
      }

      const elapsed = performance.now() - start;
      // Total should be well under 10ms per iteration
      const perIteration = elapsed / 100;
      expect(perIteration).toBeLessThan(10);
    });
  });
});
