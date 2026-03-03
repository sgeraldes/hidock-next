# Phase 2 Audit Findings

**Date:** 2026-03-03
**Scope:** Phase 2 Chirp 3 STT Integration + related changes
**Agents:** 4 (AI Pipeline, IPC+Preload, Model Config, Settings UI+Store)
**Raw findings:** 67 → **Deduplicated:** 52

## Duplicate Map
- AP-002 = IC-011 (retranscribe empty pipeline)
- IC-010 = ST-007 (serviceAccountJson not encrypted)
- MC-009 = IC-002 (env.d.ts onTopicsUpdated type mismatch)

---

## CRITICAL (4 findings)

### ST-001: Masked API key saved to DB, destroying real keys
- **File:** Settings.tsx:280-281
- **Impact:** User edits any character in API key field → masked value "****abcd" overwrites real encrypted key
- **Phase 2?** Pre-existing but Settings.tsx modified in Phase 2
- **Fix:** Add isMaskedValue() check, edit-mode pattern (like ProviderSettings.tsx)

### ST-002: Same masked value issue for ALL Bedrock credentials
- **File:** Settings.tsx:329-363
- **Impact:** bedrockAccessKeyId, bedrockSecretAccessKey, bedrockSessionToken all corrupted on edit
- **Phase 2?** Pre-existing
- **Fix:** Same as ST-001

### AP-001: EndOfMeetingProcessor swallows errors, marks failed sessions "complete"
- **File:** end-of-meeting-processor.ts:110, meeting-type-handlers.ts:47-57
- **Impact:** AI failures silently marked complete, dead error handling code
- **Phase 2?** Pre-existing
- **Fix:** Propagate errors from process() or check return value

### AP-002/IC-011: session:retranscribe creates empty pipeline that never receives data
- **File:** session-handlers.ts:114-128
- **Impact:** User clicks retranscribe → transcript deleted, no new transcription occurs
- **Phase 2?** Pre-existing
- **Fix:** Implement audio replay or disable feature

---

## HIGH (11 findings)

### AP-003: AI timestamps discarded, only chunk-boundary estimates used
- **File:** transcription-pipeline.ts:222-223
- **Impact:** Chirp3 word timestamps and AI segment timestamps all replaced with chunk × 3000ms
- **Phase 2?** Phase 2 (pipeline was rewritten)
- **Fix:** Use segment.startMs/endMs when available

### AP-004: SessionManager.endSession never calls saveDatabase
- **File:** session-manager.ts:30-55
- **Impact:** Session status/end time/audio path lost on crash
- **Phase 2?** Pre-existing
- **Fix:** Add saveDatabase() call after final updateSession

### AP-005: meetingType:setForSession never saves database
- **File:** meeting-type-handlers.ts:33-37
- **Impact:** Meeting type assignment lost on restart
- **Phase 2?** Pre-existing
- **Fix:** Add debouncedSave() call

### AP-006: Duplicate topics/action items per chunk (no dedup)
- **File:** transcription-pipeline.ts:229-247
- **Impact:** 30-min meeting could have hundreds of duplicate topic rows
- **Phase 2?** Pre-existing
- **Fix:** Deduplicate by session_id + normalized text before insert

### IC-010/ST-007: ai.gcp.serviceAccountJson stored unencrypted
- **File:** settings-handlers.ts:303-307
- **Impact:** GCP private key in plaintext while being masked (false security)
- **Phase 2?** Phase 2 (encryption check not updated for new GCP support)
- **Fix:** Add serviceAccountJson to encrypt condition

### IC-001: transcription:newSegments env.d.ts type mismatch
- **File:** env.d.ts:47, preload/index.ts:95
- **Impact:** Type says unknown[] but actual payload is {chunkIndex, segments}
- **Phase 2?** Pre-existing but worsened
- **Fix:** Update env.d.ts type

### MC-001: Model contexts reference undefined context strings
- **File:** models.config.json
- **Impact:** Models claim "default"/"draft"/"final"/"important" contexts that don't exist in registry
- **Phase 2?** Phase 2 (new config file)
- **Fix:** Add missing contexts to registry or fix model definitions

### MC-002: Two competing model resolution paths (models:getForContext vs settings:getModelForContext)
- **File:** model-handlers.ts:21-24, settings-handlers.ts:337-368
- **Impact:** Different answers for same query depending on which channel is used
- **Phase 2?** Phase 2 (both handlers are new)
- **Fix:** Remove models:getForContext or make it delegate to settings handler

### ST-003: SETTING_KEY_MAP uses deprecated ai.model key
- **File:** Settings.tsx:25
- **Impact:** Writes to deprecated key, relies on redirect
- **Phase 2?** Pre-existing
- **Fix:** Change to "ai.model.default"

### ST-004: Model text input fires every keystroke, reconfiguring AI
- **File:** Settings.tsx:260-269
- **Impact:** AI reconfigures with partial model ID on each key press
- **Phase 2?** Pre-existing but exacerbated by Phase 2 model system
- **Fix:** Debounce save or use ModelSelector dropdown

### ST-005: Dead settings components not used
- **File:** Multiple component files
- **Impact:** ProviderSettings, ModelSelector, etc. have better UX but are unused
- **Phase 2?** Phase 2 created these components but Settings.tsx doesn't use them
- **Fix:** Integrate components into Settings.tsx (larger task)

### ST-006: Recording settings show wrong units (ms vs seconds)
- **File:** Settings.tsx:437-474
- **Impact:** UI says milliseconds, store values are seconds, min/max wrong
- **Phase 2?** Pre-existing
- **Fix:** Change labels to "seconds" and fix min/max values

---

## MEDIUM (20 findings)

IC-002, IC-003, IC-004, IC-007, IC-008, IC-009, IC-012, IC-015,
MC-003, MC-004, MC-005, MC-006, MC-007, MC-008,
AP-007, AP-008, AP-009, AP-010, AP-011, AP-012, AP-013, AP-014, AP-015,
ST-008, ST-009, ST-010, ST-011, ST-012, ST-013, ST-014

## LOW (17 findings)

IC-005, IC-006, IC-013, IC-014,
MC-010, MC-011, MC-012, MC-013, MC-014, MC-015,
AP-016, AP-017, AP-018, AP-019, AP-020,
ST-015, ST-016, ST-017

---

## All Fixes Applied

### Phase 2 commit (a47be470):
1. **IC-010/ST-007** - FIXED: serviceAccountJson now encrypted at rest
2. **MC-001** - FIXED: Added default/draft/final/important contexts to registry
3. **MC-002** - DOCUMENTED: Added clarifying comment differentiating the two handlers
4. **AP-003** - FIXED: Use AI-provided startMs/endMs when available, fallback to chunk estimates
5. **MC-004** - FIXED: Removed dead ModelCostInfo type
6. **MC-011** - FIXED: Removed unused ModelContext type from useSettingsStore
7. **AP-011** - FIXED: Made chirp3 projectId optional (inferred from credentials)
8. **IC-001/IC-002/IC-003** - FIXED: Updated env.d.ts types to match actual IPC payload shapes

### Phase D commit (6deb339d):
9. **ST-001/ST-002** - FIXED: Masked API key/Bedrock credential corruption prevented
10. **AP-004** - FIXED: saveDatabase() now called in endSession
11. **AP-005** - FIXED: saveDatabase() now called in meetingType:setForSession
12. **AP-006** - FIXED: Topic/action item deduplication by session
13. **ST-003** - FIXED: SETTING_KEY_MAP updated to ai.model.default
14. **ST-006** - FIXED: Recording settings show correct units (seconds)

### Phase D continued:
15. **AP-001** - FIXED: EndOfMeetingProcessor re-throws after writing error state
16. **AP-002/IC-011** - FIXED: retranscribe now replays saved audio through pipeline
17. **AP-007** - FIXED: deleteTranscript clears summary and title
18. **IC-004** - FIXED: env.d.ts app.info type matches handler return
19. **IC-009** - FIXED: settings:set throws on unauthorized key writes
20. **IC-012** - FIXED: audio:readFile buffer sliced to correct size
21. **IC-015** - FIXED: session:delete cleans up pipeline and cumulative buffer

## Remaining Issues (backlog)

### MEDIUM (not yet fixed):
- MC-003: gpt-4-turbo as "realtime" model for non-audio-capable OpenAI
- MC-006: validateModel allows deprecated with allowCustomModels
- MC-008: loadConfig minimal validation (no schema validation)
- AP-008: Summary field stores full JSON instead of text
- AP-009: Race condition between chunk processing and session:end
- AP-010: validateApiKey only checks format, not connectivity
- AP-012: Unsanitized transcript content in prompts
- AP-013: isAudioCapable checks provider-level, not model-level
- ST-005: Dead settings components not integrated (needs UI redesign)
- ST-008: Non-functional search in Settings
- ST-010: No visual indicator for configured credentials
- ST-011: handleFieldChange over-broad deps
- ST-013: setField no type validation
- ST-014: No input validation on numeric fields

### LOW (not yet fixed):
- IC-005, IC-006, IC-008, IC-013
- MC-010, MC-012, MC-013, MC-014, MC-015
- AP-016, AP-017, AP-018, AP-019, AP-020
- ST-015, ST-016, ST-017
