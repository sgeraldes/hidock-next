# Recording Test Plan - Verify REC-004 Fix

**Purpose**: Verify that manual recording now works end-to-end after fixing the MicDetector auto-end bug.

---

## Prerequisites

✅ Dev server is running (`npm run dev`)
✅ DevTools open (F12) to see console logs
✅ Microphone connected and permissions granted

---

## Test 1: Basic Manual Recording (CRITICAL)

**Goal**: Verify session doesn't auto-end immediately.

### Steps:
1. Open the app
2. Open DevTools Console (F12)
3. Click the **"Record"** button
4. **Wait 10 seconds** without speaking
5. Observe console logs
6. Check session status in UI
7. Speak for 5 seconds
8. Wait another 5 seconds
9. Click **"Stop"** button

### Expected Results:

**Console should show:**
```
[App] onStartRecording called
[App] isProviderConfigured: true/false
[App] Creating session via IPC...
[App] Session created: { id: "...", status: "active", started_at: "..." }
[App] Setting active session: <session-id>
[App] Switching view to: <session-id>
[App] Recording setup complete
[useAudioCapture] start() called for session: <session-id>
[useAudioCapture] Calling recorder.startRecording()...
[useAudioCapture] Recording started successfully!
[SessionManager] Ignoring mic inactive - session was manually started
```

**UI should show:**
- ✅ Control bar appears and stays visible
- ✅ Session shows as "Active" (NOT "Inactive")
- ✅ Timer counts up (00:01, 00:02, 00:03...)
- ✅ Microphone icon shows active state
- ✅ "Recording in progress" message visible

**After clicking Stop:**
- ✅ Control bar hides
- ✅ Session changes to "Inactive"
- ✅ Timer stops
- ✅ Window no longer stays on top

### Check Audio Files:
```bash
cd "G:\OneDrive - Geraldes\Documents\MeetingRecorder\recordings"
# Find newest session directory
ls -lt | head -5
cd <newest-session-id>
ls -lh
```

**Should see:**
```
chunk-000.ogg  (100-300 KB)
chunk-001.ogg  (100-300 KB)
chunk-002.ogg  (100-300 KB)
...
recording.ogg  (concatenated file)
```

**✅ PASS CRITERIA**: Session stays active for entire recording, audio chunks created, no auto-end.

---

## Test 2: Multiple Recordings in Sequence

**Goal**: Verify multiple recordings work without interference.

### Steps:
1. Click "Record"
2. Speak for 5 seconds
3. Click "Stop"
4. Wait 2 seconds
5. Click "Record" again
6. Speak for 5 seconds
7. Click "Stop"

### Expected Results:
- ✅ Both sessions complete successfully
- ✅ Each session has its own audio files
- ✅ No sessions marked "Inactive" prematurely
- ✅ Control bar behaves correctly both times

---

## Test 3: Recording Without AI Provider (Warning Check)

**Goal**: Verify recording works even without AI provider configured.

### Steps:
1. Go to Settings
2. Clear API key field
3. Go back to Dashboard
4. Click "Record"
5. Check for warning notification
6. Speak for 5 seconds
7. Click "Stop"

### Expected Results:
- ✅ Warning notification appears: "AI provider not configured. Recording will work but transcription will be disabled."
- ✅ Recording continues anyway
- ✅ Audio chunks still created
- ✅ Session completes successfully
- ⚠️ No transcription generated (expected)

---

## Test 4: Control Bar Buttons (New Feature)

**Goal**: Verify new pause/resume/mute buttons work.

### Steps:
1. Click "Record"
2. Speak for 3 seconds
3. Click **Pause** button in control bar
4. Wait 2 seconds
5. Click **Resume** button
6. Speak for 3 more seconds
7. Click **Mute** button
8. Speak (should not be recorded)
9. Click **Unmute** button
10. Speak for 2 seconds
11. Click "Stop"

### Expected Results:
- ✅ Pause button shows play icon when paused
- ✅ Timer stops when paused
- ✅ Timer resumes when resumed
- ✅ Mute button shows muted icon when muted
- ✅ Audio chunks continue being created (pause/mute are UI states, not recording states)

**Note**: Current implementation may not fully support pause/mute at the recorder level - this tests UI responsiveness.

---

## Test 5: AutoRecord Feature (Unchanged Behavior)

**Goal**: Verify AutoRecord still works for auto-started sessions.

### Steps:
1. Go to Settings
2. Enable "Auto Record" toggle
3. Go back to Dashboard
4. **Speak into microphone** (without clicking Record)
5. Wait 3-5 seconds
6. Check if session auto-starts
7. **Stop speaking** and wait 30 seconds (grace period)
8. Check if session auto-ends

### Expected Results:
- ✅ Session auto-starts when mic becomes active
- ✅ Session auto-ends after 30 seconds of inactivity (grace period)
- ✅ Manual recordings still work with AutoRecord enabled

**Console should show:**
```
[SessionManager] Auto-ending auto-started session (mic inactive)
```

---

## Test 6: Window Always-On-Top (Bug Check)

**Goal**: Verify window returns to normal after stopping recording.

### Steps:
1. Note current window Z-order
2. Click "Record"
3. Verify window is now always-on-top
4. Try switching to another window
5. Click "Stop"
6. Try switching to another window again

### Expected Results:
- ✅ While recording: Window stays on top of all other windows
- ✅ After stopping: Window returns to normal Z-order
- ✅ Can switch to other windows normally

---

## Test 7: Control Bar Visibility (Bug Check)

**Goal**: Verify control bar hides after stopping.

### Steps:
1. Click "Record"
2. Verify mini control bar appears
3. Click "Stop"
4. Wait 1 second
5. Check if control bar is still visible

### Expected Results:
- ✅ Control bar appears when recording starts
- ✅ Control bar disappears when recording stops
- ✅ Control bar doesn't get "stuck" visible

---

## Test 8: Multiple Sessions in History

**Goal**: Verify history shows all sessions correctly.

### Steps:
1. Record 3 short sessions (5 seconds each)
2. Go to History page
3. Check session list

### Expected Results:
- ✅ All 3 sessions appear in history
- ✅ All marked as "Inactive" (completed)
- ✅ All have timestamps
- ✅ All have audio files
- ✅ Can play back each session

---

## Test 9: Error Scenarios

**Goal**: Verify error handling works correctly.

### Test 9a: Microphone Permission Denied
1. Go to browser settings
2. Block microphone permission
3. Click "Record"
4. Expected: Clear error message about permission

### Test 9b: No Microphone Connected
1. Disconnect/disable microphone
2. Click "Record"
3. Expected: Clear error message about no microphone

### Test 9c: Already Recording
1. Click "Record"
2. Click "Record" again (while already recording)
3. Expected: Either ignore second click or show warning

---

## Test 10: Long Recording Stress Test

**Goal**: Verify recording stays stable for extended periods.

### Steps:
1. Click "Record"
2. Let it run for 2 minutes
3. Speak occasionally
4. Check console for errors
5. Check memory usage (DevTools Performance tab)
6. Click "Stop"
7. Verify audio file size

### Expected Results:
- ✅ No console errors during 2-minute recording
- ✅ Memory usage stays stable
- ✅ Audio chunks created continuously (~12 chunks for 2 minutes)
- ✅ Final recording.ogg file exists and is playable
- ✅ Session doesn't auto-end at any point

---

## Known Limitations (Document if found)

### Issues That May Still Exist:
- Pause/Resume buttons may not actually pause audio capture (UI-only)
- Mute button may not actually mute audio capture (UI-only)
- MicDetector may still report incorrect status on some systems
- Transcription may fail if API key is invalid (separate issue)

### Edge Cases to Watch:
- Very short recordings (< 1 second)
- Rapid start/stop cycles
- System audio device changes during recording
- Multiple browser tabs with microphone access

---

## Failure Patterns to Watch For

### If Recording Still Fails:

**Symptom**: Session immediately shows "Inactive"
**Check**: Console for `[SessionManager] Auto-ending auto-started session`
**Cause**: Fix didn't apply correctly, rebuild needed

**Symptom**: No audio chunks created
**Check**: Console for `[useAudioCapture] Recording started successfully!`
**Cause**: getUserMedia() may be failing silently

**Symptom**: Control bar doesn't appear
**Check**: Console for errors in window-manager.ts
**Cause**: Separate control bar bug

**Symptom**: Window stays on top after stopping
**Check**: Console for `setMainWindowAlwaysOnTop(false)` call
**Cause**: Always-on-top not being unset

---

## Success Criteria

**MINIMUM VIABLE (Must Pass)**:
- ✅ Test 1: Basic Manual Recording works end-to-end
- ✅ Test 2: Multiple recordings work
- ✅ Test 3: Recording works without AI provider

**FULL SUCCESS (Should Pass)**:
- ✅ All 10 tests pass
- ✅ No console errors during any test
- ✅ Audio files created and playable
- ✅ UI updates correctly throughout

---

## Reporting Results

### If ALL TESTS PASS:
Report back:
```
✅ ALL TESTS PASSED
- Recorded X sessions successfully
- All audio files created
- No sessions auto-ended prematurely
- Control bar behavior correct
- Window always-on-top behavior correct
```

### If ANY TEST FAILS:
Report back:
```
❌ TEST FAILED: <test name>
- What you did: <steps>
- What you expected: <expected result>
- What actually happened: <actual result>
- Console logs: <paste relevant logs>
- Screenshots: <attach if helpful>
```

---

## Quick Test (1 Minute)

If you want to do a quick sanity check:

1. `npm run dev`
2. Open DevTools (F12)
3. Click "Record"
4. Speak for 5 seconds
5. Click "Stop"
6. Check:
   - ✅ Console shows "Recording started successfully!"
   - ✅ Console shows "Ignoring mic inactive - session was manually started"
   - ✅ Session in UI shows as "Inactive" only AFTER clicking Stop
   - ✅ Audio chunks exist in recordings directory

**If these 4 things work → REC-004 fix successful.**
