import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ===========================
// Mock Setup (hoisted)
// ===========================
const {
  mockTranscribe,
  mockTranscribeAudio,
  mockIsAudioCapable,
  mockInsertSegment,
  mockGetRecentTranscriptSegments,
  mockBroadcast,
  mockCreateTalkingPoint,
  mockCreateActionItem,
} = vi.hoisted(() => {
  // Define mock speakers for deterministic results
  const speakers = ["Alice", "Bob", "Charlie", "Diana"];
  let callCount = 0;

  return {
    mockTranscribe: vi.fn().mockImplementation(async () => {
      callCount++;
      const speaker = speakers[callCount % speakers.length];

      return {
        segments: [
          {
            speaker,
            text: `${speaker} said something at chunk ${callCount}`,
            sentiment: "neutral",
            startMs: undefined,
            endMs: undefined,
          },
        ],
        topics: callCount % 20 === 0 ? ["Meeting Topic"] : [],
        actionItems:
          callCount % 30 === 0
            ? [{ text: `Action item ${callCount}`, assignee: speaker }]
            : [],
      };
    }),
    mockTranscribeAudio: vi.fn().mockResolvedValue({
      segments: [],
      topics: [],
      actionItems: [],
    }),
    mockIsAudioCapable: vi.fn().mockReturnValue(false),
    mockInsertSegment: vi.fn().mockImplementation((segment) => ({
      id: `seg-${segment.chunk_index}`,
    })),
    mockGetRecentTranscriptSegments: vi.fn().mockReturnValue([]),
    mockBroadcast: vi.fn(),
    mockCreateTalkingPoint: vi.fn().mockImplementation((topic) => ({
      id: `topic-${topic.topic}`,
    })),
    mockCreateActionItem: vi.fn().mockImplementation((item) => ({
      id: `action-${item.text}`,
    })),
  };
});

const mockAIService = {
  transcribe: mockTranscribe,
  transcribeAudio: mockTranscribeAudio,
  isAudioCapable: mockIsAudioCapable,
  configure: vi.fn(),
  getActiveProvider: vi.fn().mockReturnValue("google"),
  summarize: vi.fn(),
  validateApiKey: vi.fn(),
};

vi.mock("../services/database", () => ({
  insertTranscriptSegment: mockInsertSegment,
  getRecentTranscriptSegments: mockGetRecentTranscriptSegments,
  saveDatabase: vi.fn(),
  createSession: vi.fn().mockReturnValue("session-load-test"),
  updateSession: vi.fn(),
  getSession: vi.fn(),
  getAllSessions: vi.fn().mockReturnValue([]),
  createRecording: vi.fn(),
  updateRecording: vi.fn(),
}));

vi.mock("../services/database-extras", () => ({
  createTalkingPoint: mockCreateTalkingPoint,
  createActionItem: mockCreateActionItem,
  getTalkingPointsBySession: vi.fn().mockReturnValue([]),
  getActionItemsBySession: vi.fn().mockReturnValue([]),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi
      .fn()
      .mockReturnValue([{ webContents: { send: mockBroadcast } }]),
  },
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
}));

import { TranscriptionPipeline } from "../services/transcription-pipeline";

// ===========================
// Memory Analysis Utilities
// ===========================
interface MemorySample {
  chunkIndex: number;
  heapUsedMB: number;
  rssMB: number;
  timestamp: number;
}

function sampleMemory(chunkIndex: number): MemorySample {
  const mem = process.memoryUsage();
  return {
    chunkIndex,
    heapUsedMB: mem.heapUsed / 1024 / 1024,
    rssMB: mem.rss / 1024 / 1024,
    timestamp: Date.now(),
  };
}

interface MemoryAnalysis {
  totalGrowthMB: number;
  growthPerChunkKB: number;
  sampleCount: number;
  isLeak: boolean;
}

function analyzeMemoryGrowth(samples: MemorySample[]): MemoryAnalysis {
  if (samples.length < 2) {
    return {
      totalGrowthMB: 0,
      growthPerChunkKB: 0,
      sampleCount: 0,
      isLeak: false,
    };
  }

  const baseline = samples[0].heapUsedMB;
  const final = samples[samples.length - 1].heapUsedMB;
  const totalGrowthMB = final - baseline;
  const chunkSpan = samples[samples.length - 1].chunkIndex - samples[0].chunkIndex;
  const growthPerChunkKB = chunkSpan > 0 ? (totalGrowthMB * 1024) / chunkSpan : 0;

  // Threshold: 200 KB per chunk is acceptable (includes GC overhead)
  const LEAK_THRESHOLD_KB = 200;
  const isLeak = growthPerChunkKB > LEAK_THRESHOLD_KB;

  return {
    totalGrowthMB,
    growthPerChunkKB,
    sampleCount: samples.length,
    isLeak,
  };
}

function forceGarbageCollection(): void {
  if (global.gc) {
    global.gc();
  }
}

// ===========================
// Load Test Suite
// ===========================
describe("TranscriptionPipeline - Load Test (30+ min recording)", () => {
  let pipeline: TranscriptionPipeline;

  beforeEach(() => {
    mockTranscribe.mockClear();
    mockTranscribeAudio.mockClear();
    mockIsAudioCapable.mockClear().mockReturnValue(false);
    mockInsertSegment.mockClear();
    mockGetRecentTranscriptSegments.mockClear().mockReturnValue([]);
    mockBroadcast.mockClear();
    mockCreateTalkingPoint.mockClear();
    mockCreateActionItem.mockClear();
  });

  afterEach(() => {
    if (pipeline) {
      pipeline.stop();
    }
  });

  it(
    "should process 600+ text chunks without memory leaks or crashes",
    { timeout: 120_000 }, // 120 seconds timeout
    async () => {
      // Configuration
      const TOTAL_CHUNKS = 610; // 30+ minutes at 3s/chunk
      const SAMPLE_INTERVAL = 50; // Sample memory every 50 chunks
      const memorySamples: MemorySample[] = [];

      // Phase 1: Setup
      pipeline = new TranscriptionPipeline("session-load-test", mockAIService as never);

      // Baseline memory (force GC before starting)
      forceGarbageCollection();
      memorySamples.push(sampleMemory(0));

      console.log(`[LOAD-TEST] Starting load test: ${TOTAL_CHUNKS} chunks`);
      console.log(
        `[LOAD-TEST] Baseline: heap=${memorySamples[0].heapUsedMB.toFixed(1)}MB, rss=${memorySamples[0].rssMB.toFixed(1)}MB`,
      );

      // Phase 2: Process chunks (text mode - no audio data required)
      for (let i = 0; i < TOTAL_CHUNKS; i++) {
        // Generate deterministic text
        const text = `Speaker ${i % 4} said something meaningful at chunk ${i}`;

        // Process chunk
        await pipeline.processChunk(text, i);

        // Sample memory at intervals
        if (i % SAMPLE_INTERVAL === 0 && i > 0) {
          forceGarbageCollection();
          const sample = sampleMemory(i);
          memorySamples.push(sample);

          // Log progress every 100 chunks
          if (i % 100 === 0) {
            console.log(
              `[LOAD-TEST] Chunk ${i}: heap=${sample.heapUsedMB.toFixed(1)}MB, rss=${sample.rssMB.toFixed(1)}MB`,
            );
          }
        }
      }

      // Final memory sample
      forceGarbageCollection();
      const finalSample = sampleMemory(TOTAL_CHUNKS);
      memorySamples.push(finalSample);

      console.log(
        `[LOAD-TEST] Final: heap=${finalSample.heapUsedMB.toFixed(1)}MB, rss=${finalSample.rssMB.toFixed(1)}MB`,
      );

      // Phase 3: Memory Analysis
      const analysis = analyzeMemoryGrowth(memorySamples);
      console.log(`[LOAD-TEST] Memory Analysis:`, {
        totalGrowthMB: analysis.totalGrowthMB.toFixed(2),
        growthPerChunkKB: analysis.growthPerChunkKB.toFixed(2),
        sampleCount: analysis.sampleCount,
        isLeak: analysis.isLeak,
      });

      // Phase 4: Assertions

      // Memory leak detection
      expect(analysis.isLeak).toBe(false);
      expect(analysis.growthPerChunkKB).toBeLessThan(200);

      // Verify all chunks processed
      expect(mockTranscribe).toHaveBeenCalledTimes(TOTAL_CHUNKS);
      expect(mockInsertSegment).toHaveBeenCalledTimes(TOTAL_CHUNKS);

      // Verify session ID consistency
      expect(pipeline.getSessionId()).toBe("session-load-test");

      // Verify broadcasts occurred
      expect(mockBroadcast).toHaveBeenCalled();
      const newSegmentsCalls = mockBroadcast.mock.calls.filter(
        (call) => call[0] === "transcription:newSegments",
      );
      expect(newSegmentsCalls.length).toBe(TOTAL_CHUNKS);

      // Verify topics were created (~30 times based on mock logic)
      const topicsCalls = mockBroadcast.mock.calls.filter(
        (call) => call[0] === "transcription:topicsUpdated",
      );
      expect(topicsCalls.length).toBeGreaterThan(0);

      // Verify action items were created (~20 times based on mock logic)
      const actionItemsCalls = mockBroadcast.mock.calls.filter(
        (call) => call[0] === "transcription:actionItemsUpdated",
      );
      expect(actionItemsCalls.length).toBeGreaterThan(0);

      // Clean shutdown
      pipeline.stop();

      console.log(`[LOAD-TEST] ✓ Test completed successfully`);
    },
  );

  it(
    "should handle speaker tracking across many chunks",
    { timeout: 60_000 },
    async () => {
      const CHUNK_COUNT = 200;
      const speakers = ["Alice", "Bob", "Charlie", "Diana"];

      pipeline = new TranscriptionPipeline("session-speaker-test", mockAIService as never);

      // Process chunks with rotating speakers
      for (let i = 0; i < CHUNK_COUNT; i++) {
        const speaker = speakers[i % speakers.length];
        await pipeline.processChunk(`${speaker} speaks at chunk ${i}`, i);
      }

      // Verify all speakers were tracked
      // (We can't directly access knownSpeakers, but we can verify all were inserted)
      expect(mockInsertSegment).toHaveBeenCalledTimes(CHUNK_COUNT);

      // Verify speaker names appear in segments
      const allSegmentCalls = mockInsertSegment.mock.calls;
      const uniqueSpeakers = new Set(
        allSegmentCalls.map((call) => call[0].speaker_name),
      );
      expect(uniqueSpeakers.size).toBeGreaterThanOrEqual(4);

      pipeline.stop();
    },
  );

  it(
    "should maintain stable performance across chunks",
    { timeout: 60_000 },
    async () => {
      const CHUNK_COUNT = 300;
      const processingTimes: number[] = [];

      pipeline = new TranscriptionPipeline("session-perf-test", mockAIService as never);

      for (let i = 0; i < CHUNK_COUNT; i++) {
        const startTime = Date.now();
        await pipeline.processChunk(`Performance test chunk ${i}`, i);
        const duration = Date.now() - startTime;
        processingTimes.push(duration);
      }

      // Calculate average and max processing time
      const avgTime = processingTimes.reduce((a, b) => a + b, 0) / CHUNK_COUNT;
      const maxTime = Math.max(...processingTimes);

      console.log(`[LOAD-TEST] Performance: avg=${avgTime.toFixed(1)}ms, max=${maxTime}ms`);

      // Assert reasonable processing times (with mocks, should be fast)
      expect(avgTime).toBeLessThan(50); // Average under 50ms
      expect(maxTime).toBeLessThan(200); // No single chunk over 200ms

      pipeline.stop();
    },
  );
});
