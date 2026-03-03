import { describe, it, expect, beforeEach, vi } from "vitest";
import { Chirp3Provider } from "../chirp3-provider";
import type { Chirp3Word } from "../chirp3-provider.types";

// Mock getSetting to control QA logging
vi.mock("../database-extras", () => ({
  getSetting: vi.fn(() => "false"),
}));

describe("Chirp3Provider Confidence Filtering", () => {
  let provider: Chirp3Provider;

  beforeEach(() => {
    // Create provider with mock SpeechClient factory
    provider = new Chirp3Provider(() => ({
      SpeechClient: class {
        close() {}
      },
    }));

    // Configure with default threshold (0.7)
    provider.configure({
      credentials: { type: "api-key", apiKey: "test-key" },
      confidenceThreshold: 0.7,
    });
  });

  describe("filterByConfidence", () => {
    it("should filter words below threshold", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.95, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.5, startTime: 1, endTime: 2 },
        { word: "test", confidence: 0.8, startTime: 2, endTime: 3 },
      ];

      const filtered = provider.filterByConfidence(words);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((w) => w.word)).toEqual(["hello", "test"]);
    });

    it("should keep words at threshold (boundary case)", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.7, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.69, startTime: 1, endTime: 2 },
      ];

      const filtered = provider.filterByConfidence(words);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].word).toBe("hello");
    });

    it("should keep words above threshold", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.95, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.85, startTime: 1, endTime: 2 },
      ];

      const filtered = provider.filterByConfidence(words);
      expect(filtered).toHaveLength(2);
    });

    it("should handle empty word array", () => {
      const words: Chirp3Word[] = [];
      const filtered = provider.filterByConfidence(words);
      expect(filtered).toHaveLength(0);
    });

    it("should use instance threshold when not specified", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.75, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.65, startTime: 1, endTime: 2 },
      ];

      // Default threshold is 0.7, so should filter out 0.65
      const filtered = provider.filterByConfidence(words);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].word).toBe("hello");
    });

    it("should use provided threshold over instance threshold", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.75, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.65, startTime: 1, endTime: 2 },
      ];

      // Provide threshold 0.6 (lower than instance 0.7)
      const filtered = provider.filterByConfidence(words, 0.6);
      expect(filtered).toHaveLength(2);
    });

    it("should handle threshold = 0 (keep all)", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.1, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.05, startTime: 1, endTime: 2 },
      ];

      const filtered = provider.filterByConfidence(words, 0);
      expect(filtered).toHaveLength(2);
    });

    it("should handle threshold = 1 (keep none)", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.95, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.99, startTime: 1, endTime: 2 },
      ];

      const filtered = provider.filterByConfidence(words, 1.0);
      expect(filtered).toHaveLength(0);
    });

    it("should preserve word metadata (startTime, endTime, speakerTag)", () => {
      const words: Chirp3Word[] = [
        {
          word: "hello",
          confidence: 0.95,
          startTime: 1.5,
          endTime: 2.3,
          speakerTag: 1,
        },
      ];

      const filtered = provider.filterByConfidence(words);
      expect(filtered[0]).toEqual({
        word: "hello",
        confidence: 0.95,
        startTime: 1.5,
        endTime: 2.3,
        speakerTag: 1,
      });
    });
  });

  describe("buildFilteredTranscript", () => {
    it("should replace low-confidence words with [...]", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.95, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.5, startTime: 1, endTime: 2 },
        { word: "test", confidence: 0.8, startTime: 2, endTime: 3 },
      ];

      const transcript = provider.buildFilteredTranscript(words);
      expect(transcript).toBe("hello [...] test");
    });

    it("should preserve high-confidence words", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.95, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.85, startTime: 1, endTime: 2 },
      ];

      const transcript = provider.buildFilteredTranscript(words);
      expect(transcript).toBe("hello world");
    });

    it("should collapse consecutive [...] placeholders", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.95, startTime: 0, endTime: 1 },
        { word: "is", confidence: 0.4, startTime: 1, endTime: 2 },
        { word: "this", confidence: 0.3, startTime: 2, endTime: 3 },
        { word: "test", confidence: 0.8, startTime: 3, endTime: 4 },
      ];

      const transcript = provider.buildFilteredTranscript(words);
      expect(transcript).toBe("hello [...] test");
    });

    it("should handle mixed confidence levels", () => {
      const words: Chirp3Word[] = [
        { word: "The", confidence: 0.9, startTime: 0, endTime: 1 },
        { word: "quick", confidence: 0.5, startTime: 1, endTime: 2 },
        { word: "brown", confidence: 0.8, startTime: 2, endTime: 3 },
        { word: "fox", confidence: 0.6, startTime: 3, endTime: 4 },
        { word: "jumps", confidence: 0.95, startTime: 4, endTime: 5 },
      ];

      const transcript = provider.buildFilteredTranscript(words);
      expect(transcript).toBe("The [...] brown [...] jumps");
    });

    it("should return trimmed output (no leading/trailing spaces)", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.5, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.95, startTime: 1, endTime: 2 },
      ];

      const transcript = provider.buildFilteredTranscript(words);
      expect(transcript).toBe("[...] world");
      expect(transcript.startsWith(" ")).toBe(false);
      expect(transcript.endsWith(" ")).toBe(false);
    });

    it("should handle all-low-confidence input", () => {
      const words: Chirp3Word[] = [
        { word: "uh", confidence: 0.4, startTime: 0, endTime: 1 },
        { word: "er", confidence: 0.35, startTime: 1, endTime: 2 },
        { word: "hmm", confidence: 0.3, startTime: 2, endTime: 3 },
      ];

      const transcript = provider.buildFilteredTranscript(words);
      expect(transcript).toBe("[...]");
    });

    it("should handle all-high-confidence input", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.95, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.92, startTime: 1, endTime: 2 },
        { word: "test", confidence: 0.88, startTime: 2, endTime: 3 },
      ];

      const transcript = provider.buildFilteredTranscript(words);
      expect(transcript).toBe("hello world test");
    });

    it("should handle empty word array", () => {
      const words: Chirp3Word[] = [];
      const transcript = provider.buildFilteredTranscript(words);
      expect(transcript).toBe("");
    });

    it("should use provided threshold", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.6, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.8, startTime: 1, endTime: 2 },
      ];

      // Use threshold 0.5 (lower than instance 0.7)
      const transcript = provider.buildFilteredTranscript(words, 0.5);
      expect(transcript).toBe("hello world");

      // Use threshold 0.9 (higher than instance 0.7)
      const transcriptStrict = provider.buildFilteredTranscript(words, 0.9);
      expect(transcriptStrict).toBe("[...]");
    });
  });

  describe("threshold scenarios", () => {
    it("should handle threshold = 0.5 (50%) - permissive", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.6, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.4, startTime: 1, endTime: 2 },
        { word: "test", confidence: 0.55, startTime: 2, endTime: 3 },
      ];

      const filtered = provider.filterByConfidence(words, 0.5);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((w) => w.word)).toEqual(["hello", "test"]);
    });

    it("should handle threshold = 0.7 (70%) - default", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.8, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.65, startTime: 1, endTime: 2 },
        { word: "test", confidence: 0.75, startTime: 2, endTime: 3 },
      ];

      const filtered = provider.filterByConfidence(words, 0.7);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((w) => w.word)).toEqual(["hello", "test"]);
    });

    it("should handle threshold = 0.9 (90%) - strict", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.95, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.85, startTime: 1, endTime: 2 },
        { word: "test", confidence: 0.92, startTime: 2, endTime: 3 },
      ];

      const filtered = provider.filterByConfidence(words, 0.9);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((w) => w.word)).toEqual(["hello", "test"]);
    });

    it("should verify filtering count matches expected at 70%", () => {
      const words: Chirp3Word[] = Array.from({ length: 10 }, (_, i) => ({
        word: `word${i}`,
        confidence: 0.55 + i * 0.05, // 0.55, 0.60, 0.65, 0.70, 0.75, ..., 1.00
        startTime: i,
        endTime: i + 1,
      }));

      const filtered = provider.filterByConfidence(words, 0.7);
      // Words with confidence >= 0.7: indices 3-9 (7 words)
      expect(filtered).toHaveLength(7);
    });
  });

  describe("edge cases", () => {
    it("should handle single word with high confidence", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.95, startTime: 0, endTime: 1 },
      ];

      const filtered = provider.filterByConfidence(words);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].word).toBe("hello");
    });

    it("should handle single word with low confidence", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.5, startTime: 0, endTime: 1 },
      ];

      const filtered = provider.filterByConfidence(words);
      expect(filtered).toHaveLength(0);
    });

    it("should handle all words with identical confidence above threshold", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.8, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.8, startTime: 1, endTime: 2 },
        { word: "test", confidence: 0.8, startTime: 2, endTime: 3 },
      ];

      const filtered = provider.filterByConfidence(words);
      expect(filtered).toHaveLength(3);
    });

    it("should handle all words with identical confidence below threshold", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.6, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.6, startTime: 1, endTime: 2 },
        { word: "test", confidence: 0.6, startTime: 2, endTime: 3 },
      ];

      const filtered = provider.filterByConfidence(words);
      expect(filtered).toHaveLength(0);
    });

    it("should handle words with confidence exactly at threshold", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.7, startTime: 0, endTime: 1 },
        { word: "world", confidence: 0.7, startTime: 1, endTime: 2 },
      ];

      const filtered = provider.filterByConfidence(words);
      expect(filtered).toHaveLength(2); // >= includes boundary
    });

    it("should handle words without speakerTag", () => {
      const words: Chirp3Word[] = [
        { word: "hello", confidence: 0.95, startTime: 0, endTime: 1 },
      ];

      const filtered = provider.filterByConfidence(words);
      expect(filtered[0].speakerTag).toBeUndefined();
    });

    it("should handle very long word arrays", () => {
      const words: Chirp3Word[] = Array.from({ length: 1000 }, (_, i) => ({
        word: `word${i}`,
        confidence: Math.random(),
        startTime: i,
        endTime: i + 1,
      }));

      const filtered = provider.filterByConfidence(words, 0.5);
      // Expect roughly half to be filtered (probabilistic)
      expect(filtered.length).toBeGreaterThan(400);
      expect(filtered.length).toBeLessThan(600);
    });
  });

  describe("getConfidenceThreshold", () => {
    it("should return configured threshold", () => {
      expect(provider.getConfidenceThreshold()).toBe(0.7);
    });

    it("should return custom threshold after reconfiguration", () => {
      provider.configure({
        credentials: { type: "api-key", apiKey: "test-key" },
        confidenceThreshold: 0.85,
      });

      expect(provider.getConfidenceThreshold()).toBe(0.85);
    });
  });
});
