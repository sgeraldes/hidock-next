import { useEffect } from "react";
import { useTranscriptStore } from "../store/useTranscriptStore";

let nextSegmentId = 0;

export function useTranscriptionStream(sessionId: string | null) {
  const addSegments = useTranscriptStore((state) => state.addSegments);
  const setSegments = useTranscriptStore((state) => state.setSegments);
  const setTopics = useTranscriptStore((state) => state.setTopics);
  const setActionItems = useTranscriptStore((state) => state.setActionItems);
  const setSummary = useTranscriptStore((state) => state.setSummary);
  const setInterimResult = useTranscriptStore((state) => state.setInterimResult);
  const clearInterimResult = useTranscriptStore((state) => state.clearInterimResult);

  useEffect(() => {
    if (!sessionId) return;

    // FIX TRX-003, TOP-003, ACT-003, SUM-002: Load historical data on session switch
    const loadHistoricalData = async () => {
      try {
        const [transcript, topics, actionItems, summary] = await Promise.all([
          window.electronAPI.session.getTranscript(sessionId),
          window.electronAPI.session.getTopics(sessionId),
          window.electronAPI.session.getActionItems(sessionId),
          window.electronAPI.session.getSummary(sessionId),
        ]);

        // Load transcript segments
        if (transcript && Array.isArray(transcript)) {
          const mapped = transcript.map((seg: {
            id?: string;
            speaker_name?: string;
            text: string;
            sentiment?: string;
            start_ms: number;
          }) => ({
            id: seg.id ?? `seg-${nextSegmentId++}`,
            speaker: seg.speaker_name ?? "Unknown",
            text: seg.text,
            timestamp: formatTimestamp(seg.start_ms),
            startMs: seg.start_ms,
            sentiment: (seg.sentiment ?? "neutral") as "positive" | "negative" | "neutral",
          }));
          // Replace (not append) so that renamed speakers and revisits never duplicate
          setSegments(sessionId, mapped);
        }

        // Load topics
        if (topics && Array.isArray(topics) && topics.length > 0) {
          setTopics(sessionId, topics);
        }

        // Load action items
        if (actionItems && Array.isArray(actionItems) && actionItems.length > 0) {
          setActionItems(sessionId, actionItems);
        }

        // Load summary
        if (summary && typeof summary === "string") {
          setSummary(sessionId, summary);
        }
      } catch (err) {
        console.error("[useTranscriptionStream] Failed to load historical data:", err);
      }
    };

    loadHistoricalData();

    const handleSegments = (data: unknown) => {
      // SPEC-005: Guard — discard events that belong to a different session.
      // Matches the pattern already used by handleTopics and handleActions.
      const payload = data as {
        sessionId: string;
        chunkIndex: number;
        segments: Array<{
          speaker: string;
          text: string;
          sentiment?: string;
          startMs?: number;
        }>;
      };
      if (payload.sessionId !== sessionId) return;

      const TIMESLICE_MS = 3000;
      const chunkOffsetMs = payload.chunkIndex * TIMESLICE_MS;
      const mapped = payload.segments.map((s, i) => {
        // AI-returned startMs is relative to the chunk's audio clip, not the session.
        // Add the chunk offset to get absolute session time.
        const absoluteMs = chunkOffsetMs + (s.startMs ?? 0);
        return {
          // SPEC-006 REQ-3: session-scoped deterministic ID for live segments
          id: `${sessionId}:live:${payload.chunkIndex}:${i}`,
          speaker: s.speaker,
          text: s.text,
          timestamp: formatTimestamp(absoluteMs),
          startMs: absoluteMs,
          sentiment: (s.sentiment ?? "neutral") as
            | "positive"
            | "negative"
            | "neutral",
        };
      });
      addSegments(sessionId, mapped);
    };

    // FIX TOP-004: Handle sessionId in topics event payload
    const handleTopics = (data: { sessionId: string; topics: string[] }) => {
      if (data.sessionId === sessionId) {
        setTopics(sessionId, data.topics);
      }
    };

    // FIX ACT-004: Handle sessionId in action items event payload
    const handleActions = (data: { sessionId: string; actionItems: unknown[] }) => {
      if (data.sessionId === sessionId) {
        setActionItems(
          sessionId,
          data.actionItems as Array<{ text: string; assignee?: string }>,
        );
      }
    };

    const handleInterimResult = (data: {
      sessionId: string;
      transcript: string;
      resultEndTimeMs: number;
      speaker?: string;
      sequence: number;
      isFinal: boolean;
    }) => {
      if (data.isFinal) {
        clearInterimResult(sessionId!);
      } else if (data.transcript) {
        setInterimResult(sessionId!, {
          text: data.transcript,
          speaker: data.speaker ?? "...",
          timestamp: formatTimestamp(data.resultEndTimeMs),
          sequence: data.sequence,
        });
      }
    };

    const cleanupSegments =
      window.electronAPI.transcription.onNewSegments(handleSegments);
    const cleanupTopics =
      window.electronAPI.transcription.onTopicsUpdated(handleTopics);
    const cleanupActions =
      window.electronAPI.transcription.onActionItemsUpdated(handleActions);
    const cleanupInterim =
      window.electronAPI.transcription.onInterimResult(handleInterimResult);

    return () => {
      cleanupSegments();
      cleanupTopics();
      cleanupActions();
      cleanupInterim();
    };
  }, [sessionId, addSegments, setSegments, setTopics, setActionItems, setSummary, setInterimResult, clearInterimResult]);
}

// FIX TRX-006: Format timestamp from milliseconds
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
