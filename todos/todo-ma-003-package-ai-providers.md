# Scaffold packages/ai-providers
## Current State
Nothing exists. Reference: apps/meeting-recorder/electron/main/services/ai-provider.ts
## What to Create
Package @hidock/ai-providers with tsup build:
- src/types.ts - provider config interfaces
- src/provider-factory.ts - createProvider() factory
- src/providers/gemini.ts, openai.ts, anthropic.ts, bedrock.ts, ollama.ts - stubs
- src/index.ts barrel exports
## Dependencies
None
## Acceptance Criteria
- Build and typecheck pass
- Factory function createProvider(config) exported
- All 5 provider stubs have consistent interface
