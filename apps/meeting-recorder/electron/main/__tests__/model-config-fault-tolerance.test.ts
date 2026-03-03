import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

/**
 * Model Config Fault Tolerance Tests
 *
 * Tests ModelConfigService with bad inputs and edge cases.
 * Uses the REAL service (not mocked) to validate actual behavior.
 *
 * model-config.test.ts already covers:
 *   - validateModel returns false for unknown provider
 *   - getDefaultModel returns "" for unknown provider
 *   - getCostMultiplier returns 1 for unknown model
 *   - getModelForContext returns "" for unknown provider
 *   - getModelForContext falls back to default for unknown context
 *   - getModelsForProvider returns [] for unknown provider
 *   - getModel returns null for unknown model / unknown provider
 *   - getProvider returns undefined for unknown provider
 *   - getContext returns undefined for unknown context
 *
 * This file tests ADDITIONAL fault tolerance cases:
 *   - Empty string inputs
 *   - Special characters in inputs
 *   - Null-like string inputs
 *   - Boundary conditions for cost multipliers
 *   - Multiple consecutive calls with bad inputs (no state corruption)
 *   - Config corrupt/missing scenarios (structural tests)
 */

import { modelConfig } from "../services/model-config";

describe("ModelConfigService - Fault Tolerance", () => {
  describe("Empty string inputs", () => {
    it("validateModel returns false for empty provider", () => {
      expect(modelConfig.validateModel("", "gemini-2.5-flash")).toBe(false);
    });

    it("validateModel returns false for empty model", () => {
      expect(modelConfig.validateModel("google", "")).toBe(false);
    });

    it("validateModel returns false for both empty", () => {
      expect(modelConfig.validateModel("", "")).toBe(false);
    });

    it("getDefaultModel falls back to Google default for empty provider", () => {
      expect(modelConfig.getDefaultModel("")).toBe("gemini-2.5-flash");
    });

    it("getModel returns null for empty provider", () => {
      expect(modelConfig.getModel("", "gemini-2.5-flash")).toBeNull();
    });

    it("getModel returns null for empty model ID", () => {
      expect(modelConfig.getModel("google", "")).toBeNull();
    });

    it("getModelsForProvider returns empty for empty provider", () => {
      expect(modelConfig.getModelsForProvider("")).toEqual([]);
    });

    it("getActiveModelsForProvider returns empty for empty provider", () => {
      expect(modelConfig.getActiveModelsForProvider("")).toEqual([]);
    });

    it("getModelForContext returns empty for empty provider", () => {
      expect(modelConfig.getModelForContext("", "realtime")).toBe("");
    });

    it("getModelForContext returns default for empty context", () => {
      // Empty context should fall back to provider default
      const result = modelConfig.getModelForContext("google", "");
      expect(result).toBe(modelConfig.getDefaultModel("google"));
    });

    it("getCostMultiplier returns 1 for empty provider", () => {
      expect(modelConfig.getCostMultiplier("", "gemini-2.5-flash")).toBe(1);
    });

    it("getCostMultiplier returns 1 for empty model", () => {
      expect(modelConfig.getCostMultiplier("google", "")).toBe(1);
    });

    it("isModelDeprecated returns false for empty provider", () => {
      expect(modelConfig.isModelDeprecated("", "gemini-2.0-flash")).toBe(false);
    });

    it("isAudioCapable returns false for empty provider", () => {
      expect(modelConfig.isAudioCapable("")).toBe(false);
    });

    it("getDeprecationMigration returns null for empty provider", () => {
      expect(modelConfig.getDeprecationMigration("", "gemini-2.0-flash")).toBeNull();
    });

    it("getProvider returns undefined for empty provider", () => {
      expect(modelConfig.getProvider("")).toBeUndefined();
    });

    it("getContext returns undefined for empty context", () => {
      expect(modelConfig.getContext("")).toBeUndefined();
    });
  });

  describe("Special character inputs", () => {
    it("validateModel returns false for provider with special chars", () => {
      expect(modelConfig.validateModel("goo<script>gle", "gemini-2.5-flash")).toBe(false);
    });

    it("getDefaultModel falls back to Google default for provider with spaces", () => {
      expect(modelConfig.getDefaultModel("go ogle")).toBe("gemini-2.5-flash");
    });

    it("getModel returns null for model with SQL injection attempt", () => {
      expect(modelConfig.getModel("google", "'; DROP TABLE models; --")).toBeNull();
    });

    it("getModelForContext handles unicode context gracefully", () => {
      const result = modelConfig.getModelForContext("google", "\u{1F600}emoji-context");
      // Should fall back to provider default, not crash
      expect(result).toBe(modelConfig.getDefaultModel("google"));
    });
  });

  describe("Unknown provider returns safe defaults", () => {
    it("unknown provider returns empty/null/false across all methods", () => {
      const unknownProvider = "nonexistent-provider-xyz";

      expect(modelConfig.getProvider(unknownProvider)).toBeUndefined();
      expect(modelConfig.getDefaultModel(unknownProvider)).toBe("gemini-2.5-flash");
      expect(modelConfig.getModel(unknownProvider, "some-model")).toBeNull();
      expect(modelConfig.getModelsForProvider(unknownProvider)).toEqual([]);
      expect(modelConfig.getActiveModelsForProvider(unknownProvider)).toEqual([]);
      expect(modelConfig.validateModel(unknownProvider, "some-model")).toBe(false);
      expect(modelConfig.isModelDeprecated(unknownProvider, "some-model")).toBe(false);
      expect(modelConfig.getDeprecationMigration(unknownProvider, "some-model")).toBeNull();
      expect(modelConfig.getCostMultiplier(unknownProvider, "some-model")).toBe(1);
      expect(modelConfig.isAudioCapable(unknownProvider)).toBe(false);
      expect(modelConfig.getModelForContext(unknownProvider, "realtime")).toBe("");
    });
  });

  describe("Unknown model returns safe defaults", () => {
    it("unknown model with known provider returns null/defaults", () => {
      const unknownModel = "completely-fake-model-999";

      expect(modelConfig.getModel("google", unknownModel)).toBeNull();
      expect(modelConfig.validateModel("google", unknownModel)).toBe(false);
      expect(modelConfig.isModelDeprecated("google", unknownModel)).toBe(false);
      expect(modelConfig.getDeprecationMigration("google", unknownModel)).toBeNull();
      expect(modelConfig.getCostMultiplier("google", unknownModel)).toBe(1);
    });
  });

  describe("Multiple consecutive bad inputs do not corrupt state", () => {
    it("service remains functional after multiple bad lookups", () => {
      // Hammer with bad inputs
      for (let i = 0; i < 50; i++) {
        modelConfig.getModel("bad-provider-" + i, "bad-model-" + i);
        modelConfig.validateModel("bad-" + i, "bad-" + i);
        modelConfig.getDefaultModel("nonexistent-" + i);
        modelConfig.getModelForContext("fake-" + i, "fake-context-" + i);
      }

      // Service should still work correctly
      expect(modelConfig.getProviderIds()).toContain("google");
      expect(modelConfig.getDefaultModel("google")).toBe("gemini-2.5-flash");
      expect(modelConfig.validateModel("google", "gemini-2.5-flash")).toBe(true);
      expect(modelConfig.getModel("google", "gemini-2.5-flash")).not.toBeNull();
      expect(modelConfig.getModelForContext("google", "realtime")).toBe("gemini-2.5-flash");
    });
  });

  describe("Config structural validation", () => {
    it("getFullConfig returns a non-null object", () => {
      const config = modelConfig.getFullConfig();
      expect(config).toBeDefined();
      expect(config).not.toBeNull();
    });

    it("getFullConfig has providers and contexts", () => {
      const config = modelConfig.getFullConfig();
      expect(config.providers).toBeDefined();
      expect(config.contexts).toBeDefined();
      expect(typeof config.providers).toBe("object");
      expect(typeof config.contexts).toBe("object");
    });

    it("getProviderIds returns a non-empty array of strings", () => {
      const ids = modelConfig.getProviderIds();
      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBeGreaterThan(0);
      ids.forEach((id) => {
        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);
      });
    });

    it("getContextIds returns a non-empty array of strings", () => {
      const ids = modelConfig.getContextIds();
      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBeGreaterThan(0);
      ids.forEach((id) => {
        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);
      });
    });

    it("every provider ID in getProviderIds resolves to a valid provider", () => {
      const ids = modelConfig.getProviderIds();
      for (const id of ids) {
        const provider = modelConfig.getProvider(id);
        expect(provider, `Provider '${id}' returned undefined`).toBeDefined();
        expect(provider!.name.length).toBeGreaterThan(0);
      }
    });

    it("every context ID in getContextIds resolves to a valid context", () => {
      const ids = modelConfig.getContextIds();
      for (const id of ids) {
        const context = modelConfig.getContext(id);
        expect(context, `Context '${id}' returned undefined`).toBeDefined();
        expect(context!.name.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Config file corruption scenarios (structural)", () => {
    it("invalid JSON throws when parsed", () => {
      expect(() => JSON.parse("{ invalid json !!!")).toThrow();
    });

    it("empty string throws when parsed", () => {
      expect(() => JSON.parse("")).toThrow();
    });

    it("null string throws when parsed", () => {
      expect(() => JSON.parse("null")).not.toThrow();
      expect(JSON.parse("null")).toBeNull();
    });

    it("config with missing providers key is detectable", () => {
      const badConfig = JSON.stringify({ contexts: {} });
      const parsed = JSON.parse(badConfig);
      expect(parsed.providers).toBeUndefined();
      expect(parsed.contexts).toBeDefined();
    });

    it("config with missing contexts key is detectable", () => {
      const badConfig = JSON.stringify({ providers: {} });
      const parsed = JSON.parse(badConfig);
      expect(parsed.providers).toBeDefined();
      expect(parsed.contexts).toBeUndefined();
    });

    it("config with empty providers object is detectable", () => {
      const emptyProviders = JSON.stringify({ providers: {}, contexts: {} });
      const parsed = JSON.parse(emptyProviders);
      expect(Object.keys(parsed.providers)).toHaveLength(0);
    });
  });
});
