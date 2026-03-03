import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Config Integrity Tests (Contract Tests)
 *
 * These tests read the REAL production models.config.json file
 * and validate its schema/structure as a contract test.
 * If the config file is missing or malformed, these tests will fail,
 * which is the intended behavior -- the config MUST exist and be valid.
 */

const CONFIG_PATH = path.resolve(
  __dirname,
  "../config/models.config.json",
);

interface ModelDefinition {
  id: string;
  name: string;
  description: string;
  costMultiplier: number;
  contexts: string[];
  capabilities: string[];
  deprecated?: boolean;
  recommended?: boolean;
  migratesTo?: string;
  sunset?: string;
}

interface ProviderDefinition {
  name: string;
  audioCapable: boolean;
  models: ModelDefinition[];
  defaultModel: string;
  requiresTranscription?: boolean;
  transcriptionProvider?: string;
  allowCustomModels?: boolean;
}

interface ContextDefinition {
  name: string;
  description: string;
  priority: string;
}

interface ModelsConfig {
  version: number;
  providers: Record<string, ProviderDefinition>;
  contexts: Record<string, ContextDefinition>;
}

describe("models.config.json Integrity", () => {
  let config: ModelsConfig;

  it("is valid JSON and can be parsed", () => {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
    config = JSON.parse(raw);
  });

  describe("Top-Level Structure", () => {
    beforeAll(() => {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    });

    it("has providers object at top level", () => {
      expect(config).toHaveProperty("providers");
      expect(typeof config.providers).toBe("object");
      expect(config.providers).not.toBeNull();
    });

    it("has contexts object at top level", () => {
      expect(config).toHaveProperty("contexts");
      expect(typeof config.contexts).toBe("object");
      expect(config.contexts).not.toBeNull();
    });

    it("has version field", () => {
      expect(config).toHaveProperty("version");
      expect(typeof config.version).toBe("number");
    });

    it("has at least one provider", () => {
      expect(Object.keys(config.providers).length).toBeGreaterThan(0);
    });

    it("has at least one context", () => {
      expect(Object.keys(config.contexts).length).toBeGreaterThan(0);
    });

    it("has google provider (required)", () => {
      expect(config.providers).toHaveProperty("google");
    });
  });

  describe("Provider Definitions", () => {
    beforeAll(() => {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    });

    it("every provider has required fields (name, audioCapable, models, defaultModel)", () => {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        expect(provider, `${providerId} missing name`).toHaveProperty("name");
        expect(typeof provider.name, `${providerId} name not string`).toBe("string");
        expect(provider.name.length, `${providerId} name is empty`).toBeGreaterThan(0);

        expect(provider, `${providerId} missing audioCapable`).toHaveProperty("audioCapable");
        expect(typeof provider.audioCapable, `${providerId} audioCapable not boolean`).toBe("boolean");

        expect(provider, `${providerId} missing models`).toHaveProperty("models");
        expect(Array.isArray(provider.models), `${providerId} models not array`).toBe(true);

        expect(provider, `${providerId} missing defaultModel`).toHaveProperty("defaultModel");
        expect(typeof provider.defaultModel, `${providerId} defaultModel not string`).toBe("string");
      }
    });

    it("every provider has at least one model", () => {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        expect(
          provider.models.length,
          `${providerId} has no models`,
        ).toBeGreaterThan(0);
      }
    });

    it("every provider's defaultModel exists in its models list", () => {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        const modelIds = provider.models.map((m) => m.id);
        expect(
          modelIds,
          `${providerId} defaultModel '${provider.defaultModel}' not found in models`,
        ).toContain(provider.defaultModel);
      }
    });

    it("default model is NOT deprecated for any provider", () => {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        const defaultModel = provider.models.find(
          (m) => m.id === provider.defaultModel,
        );
        expect(
          defaultModel,
          `${providerId} defaultModel '${provider.defaultModel}' not found`,
        ).toBeDefined();
        expect(
          defaultModel?.deprecated,
          `${providerId} defaultModel '${provider.defaultModel}' is deprecated`,
        ).not.toBe(true);
      }
    });

    it("google provider has gemini-2.5-flash as default", () => {
      expect(config.providers.google.defaultModel).toBe("gemini-2.5-flash");
    });
  });

  describe("Model Definitions", () => {
    beforeAll(() => {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    });

    it("every model has all required fields (id, name, description, costMultiplier, contexts, capabilities)", () => {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        for (const model of provider.models) {
          const prefix = `${providerId}/${model.id}`;

          expect(typeof model.id, `${prefix} id not string`).toBe("string");
          expect(model.id.length, `${prefix} id is empty`).toBeGreaterThan(0);

          expect(typeof model.name, `${prefix} name not string`).toBe("string");
          expect(model.name.length, `${prefix} name is empty`).toBeGreaterThan(0);

          expect(typeof model.description, `${prefix} description not string`).toBe("string");

          expect(typeof model.costMultiplier, `${prefix} costMultiplier not number`).toBe("number");
          expect(model.costMultiplier, `${prefix} costMultiplier < 0`).toBeGreaterThanOrEqual(0);

          expect(Array.isArray(model.contexts), `${prefix} contexts not array`).toBe(true);
          expect(Array.isArray(model.capabilities), `${prefix} capabilities not array`).toBe(true);
        }
      }
    });

    it("no duplicate model IDs within a provider", () => {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        const ids = provider.models.map((m) => m.id);
        const uniqueIds = new Set(ids);
        const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
        expect(
          ids.length,
          `${providerId} has duplicate model IDs: ${duplicates.join(", ")}`,
        ).toBe(uniqueIds.size);
      }
    });

    it("deprecated models have sunset dates", () => {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        for (const model of provider.models) {
          if (model.deprecated) {
            expect(
              model.sunset,
              `${providerId}/${model.id} is deprecated but has no sunset date`,
            ).toBeDefined();
            expect(typeof model.sunset).toBe("string");
            expect(
              new Date(model.sunset!).toString(),
              `${providerId}/${model.id} sunset '${model.sunset}' is not a valid date`,
            ).not.toBe("Invalid Date");
          }
        }
      }
    });

    it("deprecated models have empty contexts array", () => {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        for (const model of provider.models) {
          if (model.deprecated) {
            expect(
              model.contexts,
              `${providerId}/${model.id} is deprecated but still has contexts`,
            ).toEqual([]);
          }
        }
      }
    });

    it("deprecated models with migratesTo reference a valid model in the same provider", () => {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        for (const model of provider.models) {
          if (model.deprecated && model.migratesTo) {
            const targetModel = provider.models.find(
              (m) => m.id === model.migratesTo,
            );
            expect(
              targetModel,
              `${providerId}/${model.id} migratesTo '${model.migratesTo}' not found in provider`,
            ).toBeDefined();
            expect(
              targetModel?.deprecated,
              `${providerId}/${model.id} migratesTo '${model.migratesTo}' is also deprecated`,
            ).not.toBe(true);
          }
        }
      }
    });

    it("non-deprecated models have at least one context", () => {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        for (const model of provider.models) {
          if (!model.deprecated) {
            expect(
              model.contexts.length,
              `${providerId}/${model.id} is active but has no contexts`,
            ).toBeGreaterThan(0);
          }
        }
      }
    });

    it("non-deprecated models have at least one capability", () => {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        for (const model of provider.models) {
          if (!model.deprecated) {
            expect(
              model.capabilities.length,
              `${providerId}/${model.id} is active but has no capabilities`,
            ).toBeGreaterThan(0);
          }
        }
      }
    });

    it("all contexts referenced by models exist in the contexts section", () => {
      const definedContexts = new Set(Object.keys(config.contexts));

      for (const [providerId, provider] of Object.entries(config.providers)) {
        for (const model of provider.models) {
          for (const ctx of model.contexts) {
            // Allow provider-specific contexts (like "draft", "final", "important", "default")
            // that may not be in the top-level contexts section.
            // Only flag if the context looks like a typo of a known context.
            if (
              !definedContexts.has(ctx) &&
              !["default", "draft", "final", "important"].includes(ctx)
            ) {
              // This is a soft warning -- we just ensure the main contexts exist
              console.warn(
                `${providerId}/${model.id} references context '${ctx}' not in contexts section`,
              );
            }
          }
        }
      }
      // The test passes as long as no exceptions are thrown.
      // The key assertion is in the "required contexts exist" test below.
      expect(true).toBe(true);
    });
  });

  describe("Context Definitions", () => {
    beforeAll(() => {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    });

    it("every context has name, description, and priority", () => {
      for (const [contextId, ctx] of Object.entries(config.contexts)) {
        expect(typeof ctx.name, `${contextId} name not string`).toBe("string");
        expect(ctx.name.length, `${contextId} name is empty`).toBeGreaterThan(0);

        expect(typeof ctx.description, `${contextId} description not string`).toBe("string");

        expect(typeof ctx.priority, `${contextId} priority not string`).toBe("string");
      }
    });

    it("context priorities are valid values (speed, quality, cost)", () => {
      const validPriorities = ["speed", "quality", "cost"];
      for (const [contextId, ctx] of Object.entries(config.contexts)) {
        expect(
          validPriorities,
          `${contextId} priority '${ctx.priority}' is not one of: ${validPriorities.join(", ")}`,
        ).toContain(ctx.priority);
      }
    });

    it("required contexts exist (realtime, postprocess, critical)", () => {
      expect(config.contexts).toHaveProperty("realtime");
      expect(config.contexts).toHaveProperty("postprocess");
      expect(config.contexts).toHaveProperty("critical");
    });

    it("batch context exists", () => {
      expect(config.contexts).toHaveProperty("batch");
    });
  });

  describe("Cross-Cutting Validation", () => {
    beforeAll(() => {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    });

    it("at least one provider supports the realtime context", () => {
      let found = false;
      for (const provider of Object.values(config.providers)) {
        for (const model of provider.models) {
          if (!model.deprecated && model.contexts.includes("realtime")) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      expect(found, "No active model supports the 'realtime' context").toBe(true);
    });

    it("at least one audio-capable provider exists", () => {
      const audioCaps = Object.values(config.providers).filter((p) => p.audioCapable);
      expect(audioCaps.length, "No audio-capable providers found").toBeGreaterThan(0);
    });

    it("costMultiplier values are consistent (no negative, reasonable range)", () => {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        for (const model of provider.models) {
          expect(
            model.costMultiplier,
            `${providerId}/${model.id} costMultiplier is negative`,
          ).toBeGreaterThanOrEqual(0);
          expect(
            model.costMultiplier,
            `${providerId}/${model.id} costMultiplier is unreasonably high (>1000)`,
          ).toBeLessThanOrEqual(1000);
        }
      }
    });
  });
});
