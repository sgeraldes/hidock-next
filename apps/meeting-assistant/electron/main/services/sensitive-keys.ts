/**
 * Settings keys whose values are API credentials and must be encrypted at rest
 * using safeStorage before being written to the database.
 */
export const SENSITIVE_SETTING_KEYS = new Set([
  "ai.apiKey",
  "ai.bedrockAccessKeyId",
  "ai.bedrockSecretAccessKey",
  "ai.bedrockSessionToken",
  "ai.gcp.apiKey",
  "ai.gcp.serviceAccountJson",
  "ai.transcriptionApiKey",
]);
