import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateObject = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  generateObject: mockGenerateObject,
}));

import { TranslationService } from "../services/translation-service";

describe("TranslationService", () => {
  let service: TranslationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TranslationService();
    service.setModel("mock-model");
  });

  it("translates a batch of segments", async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        translatedSegments: [
          {
            originalText: "Hello everyone",
            translatedText: "Hola a todos",
            targetLanguage: "es",
          },
          {
            originalText: "Let's begin",
            translatedText: "Comencemos",
            targetLanguage: "es",
          },
        ],
      },
    });

    const result = await service.translateBatch(
      ["Hello everyone", "Let's begin"],
      "es",
    );

    expect(result).toHaveLength(2);
    expect(result[0].translatedText).toBe("Hola a todos");
    expect(result[1].translatedText).toBe("Comencemos");
  });

  it("passes target language to the prompt", async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        translatedSegments: [
          {
            originalText: "Hello",
            translatedText: "Bonjour",
            targetLanguage: "fr",
          },
        ],
      },
    });

    await service.translateBatch(["Hello"], "fr");

    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("fr");
    expect(call.prompt).toContain("Hello");
  });

  it("handles empty input gracefully", async () => {
    const result = await service.translateBatch([], "es");
    expect(result).toEqual([]);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("handles AI failure with empty result", async () => {
    mockGenerateObject.mockRejectedValue(new Error("Rate limited"));

    const result = await service.translateBatch(["Hello"], "es");
    expect(result).toEqual([]);
  });

  it("retries on 429 error and succeeds on 2nd attempt", async () => {
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = ((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      const successResult = {
        object: {
          translatedSegments: [
            {
              originalText: "Hello",
              translatedText: "Hola",
              targetLanguage: "es",
            },
          ],
        },
      };

      mockGenerateObject
        .mockRejectedValueOnce(new Error("429 rate limit exceeded"))
        .mockResolvedValueOnce(successResult);

      const result = await service.translateBatch(["Hello"], "es");

      expect(mockGenerateObject).toHaveBeenCalledTimes(2);
      expect(result[0].translatedText).toBe("Hola");
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  it("gives up after 3 retry attempts on 429", async () => {
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = ((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      mockGenerateObject.mockRejectedValue(new Error("429 rate limit"));

      const result = await service.translateBatch(["Hello"], "es");

      expect(mockGenerateObject).toHaveBeenCalledTimes(4);
      expect(result).toEqual([]);
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  it("respects concurrency limit", async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;

    mockGenerateObject.mockImplementation(async () => {
      concurrentCalls++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      await new Promise((r) => setTimeout(r, 10));
      concurrentCalls--;
      return {
        object: {
          translatedSegments: [
            {
              originalText: "a",
              translatedText: "b",
              targetLanguage: "es",
            },
          ],
        },
      };
    });

    await Promise.all([
      service.translateBatch(["a"], "es"),
      service.translateBatch(["b"], "es"),
      service.translateBatch(["c"], "es"),
      service.translateBatch(["d"], "es"),
    ]);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});
