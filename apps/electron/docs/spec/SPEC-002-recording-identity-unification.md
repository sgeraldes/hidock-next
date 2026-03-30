# SPEC-002: Recording Identity Unification

## 1. Problem Definition
The current Electron app suffers from a "Dual Identity Problem" where a single physical recording can be represented by two different, incompatible database records:
1.  **Device-Scan Record**: Created when scanning the HiDock device. Uses a standard UUID (v4) as the `id`.
2.  **File-Watcher Record**: Created when a new file is detected in the downloads directory. Uses a custom string prefix `rec_` followed by a timestamp (generated in `recording-watcher.ts`).

### Consequences
- **Validation Failures**: Zod schemas in `ipc/validation.ts` expect a UUID. `rec_` IDs cause runtime errors (P0).
- **Data Fragmentation**: A single recording appears twice in the UI if both the device is connected and the file exists locally.
- **Duration Loss**: `recording-watcher.ts` defaults duration to `undefined`, while `database.ts` may have the correct duration from the device metadata.

## 2. Technical Objectives
- **Single Canonical ID**: All recordings MUST use a standard UUID (v4) as their primary identifier.
- **Lookup Prior to Creation**: `recording-watcher.ts` must query the database by filename *before* creating a new record.
- **Duration Backfilling**: Implement automated duration probing for local files that lack metadata.
- **Legacy Migration**: Convert all existing `rec_` IDs to UUIDs without losing associated transcriptions or tags.

## 3. Implementation Details

### 3.1. Unified ID Strategy
- **New Records**: Use `crypto.randomUUID()` for all new entries.
- **`recording-watcher.ts` Modification**:
    - Current: Calls `generateRecordingId(path)` which returns `rec_${timestamp}`.
    - Future: 
        1. Extract `basename(path)` (e.g., `20231027103000.wav`).
        2. Query `recordings` table for `filename = :basename`.
        3. If found, use that UUID and update `location` to include `local`.
        4. If NOT found, generate a new UUID and create the record.

### 3.2. Duration Probing
When a local file is detected:
1. If the database record has `duration = 0` or `null`:
2. Use `music-metadata` or `ffprobe` (via `fluent-ffmpeg`) to extract the actual duration in seconds.
3. Update the `recordings` table with the probed duration.

### 3.3. Database Schema Updates
No immediate schema changes are required (the `id` column is already a `TEXT` field in SQLite), but the application logic must enforce the UUID constraint.

## 4. Migration Strategy for Legacy Records
To handle existing `rec_xxx` records in `database.ts`:
1. **Startup Check**: On application boot, perform a "Sanitize IDs" migration.
2. **Identification**: Find all records where `id LIKE 'rec_%'`.
3. **Conversion**:
    - For each legacy record, generate a new UUID.
    - Update the `recordings` table primary key (this requires a `DELETE` and `INSERT` or a temporary column swap due to PK constraints).
    - **Crucial**: Update all foreign keys in `transcriptions`, `notes`, and `tags` tables to point to the new UUID.

## 5. Acceptance Criteria

### 5.1. ID Unification (Testable)
- [ ] **AC-1**: Given a recording file `TEST.wav` already known to the device-scan (UUID: `A`), when the file is downloaded, the `recording-watcher` MUST identify the existing record and update its `on_local` status rather than creating a new `rec_` record.
- [ ] **AC-2**: All entries in the `recordings` table MUST pass `z.string().uuid()` validation.

### 5.2. Migration (Testable)
- [ ] **AC-3**: After the migration runs, the `recordings` table contains ZERO records starting with the prefix `rec_`.
- [ ] **AC-4**: Transcriptions previously associated with a `rec_` ID MUST still be accessible and correctly linked to the new UUID.

### 5.3. Duration (Testable)
- [ ] **AC-5**: A recording file added manually to the downloads folder (not via device sync) MUST have its duration correctly populated in the database within 5 seconds of detection.

## 6. Affected Files (Reference)
- `apps/electron/electron/main/services/recording-watcher.ts` (ID generation and lookup)
- `apps/electron/electron/main/services/database.ts` (Upsert logic and migration)
- `apps/electron/electron/main/ipc/validation.ts` (Schema enforcement)
- `apps/electron/src/hooks/useUnifiedRecordings.ts` (Remove frontend merging hacks)
