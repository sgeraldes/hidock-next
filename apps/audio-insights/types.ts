
export interface AudioData {
  fileName: string;
  base64: string;
  mimeType: string;
}

export interface InsightData {
  summary: string;
  keyPoints: string[];
  sentiment: string;
  actionItems: string[];
}

// This type is for Gemini's grounding metadata if used, not directly used in this app's core logic but good to have.
export interface GroundingChunkWeb {
  uri: string;
  title: string;
}
export interface GroundingChunk {
  web: GroundingChunkWeb;
}
export interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
}
