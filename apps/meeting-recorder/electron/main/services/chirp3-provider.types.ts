export interface GCPCredentials {
  type: "api-key" | "service-account";
  apiKey?: string;
  serviceAccountJson?: string;
}

export interface Chirp3Config {
  credentials: GCPCredentials;
  projectId?: string;
  location?: string;
  languageCode?: string;
  model?: string;
  confidenceThreshold?: number;
}

export interface Chirp3Word {
  word: string;
  startTime: number;
  endTime: number;
  confidence: number;
  speakerTag?: number;
}

export interface Chirp3Result {
  transcript: string;
  words: Chirp3Word[];
  confidence: number;
  languageCode: string;
  isFinal: boolean;
}
