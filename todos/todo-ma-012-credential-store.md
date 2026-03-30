# Credential store using Electron safeStorage
## Current State
Nothing exists.
## What to Create
- electron/main/services/credential-store.ts - safeStorage wrapper: store, retrieve, delete, has, isAvailable
- Wire into settings-handlers for API key operations
## Dependencies
Task 6, Task 8
## Acceptance Criteria
- API keys encrypted with safeStorage.encryptString()
- Decryption works correctly
- isAvailable() checks encryption support
- Plain text keys never written to disk
