# Manual Verification Checklist - Phase 1 Library Fixes

## Pre-Start: Launch Application

```bash
cd apps/electron
npm run dev
```

Navigate to Library page and switch to **Compact/List View** (not Card View).

---

## AUD5-001 Verification (Already Fixed)

### ✅ Pre-Verified via Code Search
- [x] No RecordingRow references exist
- [x] SourceRow properly imported
- [x] Application launches without import errors

### Visual Check
- [ ] Library page loads without crashes
- [ ] Recording rows render in list view
- [ ] No console errors about missing components

**Expected Result**: Library loads normally with recording rows displayed.

---

## AUD5-002 Verification (Action Buttons)

### 1. Button Rendering
Switch to Compact/List View if not already there.

- [ ] Each recording row shows action buttons after the content area
- [ ] Buttons are visible and properly sized (compact 7x7)
- [ ] Button order (left to right):
  - [ ] Mic icon (Ask Assistant)
  - [ ] FileText icon (Generate Output)
  - [ ] Wand2 icon (Transcribe) - only if recording not transcribed
  - [ ] Download icon - only for device-only recordings
  - [ ] Play/Stop icon (X or Play)
  - [ ] Trash2 icon (Delete)

**Expected**: All buttons render with correct icons in compact size.

---

### 2. Ask Assistant Button
- [ ] Click "Mic" icon on any recording
- [ ] Navigates to `/assistant` page
- [ ] Context includes recording ID in URL or state
- [ ] Can navigate back to Library

**Expected**: Opens Assistant page with recording context.

---

### 3. Generate Output Button
- [ ] Click "FileText" icon on any recording
- [ ] Navigates to `/actionables` page
- [ ] Source ID includes recording ID
- [ ] Can navigate back to Library

**Expected**: Opens Actionables page with recording as source.

---

### 4. Transcribe Button
Find a recording without complete transcription.

- [ ] "Wand2" icon visible for local recordings
- [ ] Click Transcribe button
- [ ] Button shows spinner (RefreshCw with animate-spin)
- [ ] Button disabled during processing
- [ ] Toast notification confirms transcription queued

**Expected**: Transcription starts, button shows loading state.

---

### 5. Download Button (Device-Only Recordings)
Connect a HiDock device with recordings. Find a device-only recording.

- [ ] "Download" icon visible for device-only recordings
- [ ] Click Download button
- [ ] Button changes to spinner with percentage (e.g., "42%")
- [ ] Progress updates in real-time
- [ ] Button returns to normal after completion
- [ ] Recording location changes to "synced" or "local-only"

**Expected**: Download starts, shows progress, completes successfully.

---

### 6. Download Button Disabled State
Disconnect HiDock device. Find a device-only recording.

- [ ] Download button visible but grayed out
- [ ] Hover shows tooltip: "Device not connected"
- [ ] Button click does nothing
- [ ] No errors in console

**Expected**: Button disabled when device not connected.

---

### 7. Play/Stop Button
- [ ] Click Play icon on a local recording
- [ ] Icon changes to "X" (Stop)
- [ ] Audio playback starts
- [ ] Click "X" icon
- [ ] Playback stops
- [ ] Icon returns to Play

**Expected**: Playback controls work correctly.

---

### 8. Delete Button - Device-Only Recording
Find a device-only recording (should show red delete button).

- [ ] Delete button visible with RED color (text-destructive)
- [ ] Hover shows tooltip: "Delete from device (permanent)"
- [ ] Click Delete button
- [ ] Confirmation dialog appears
- [ ] Confirm deletion
- [ ] Recording removed from list
- [ ] Toast notification confirms deletion

**Expected**: Red delete button, confirmation dialog, recording deleted from device.

---

### 9. Delete Button - Local-Only Recording
Find a local-only recording (imported file, not synced).

- [ ] Delete button visible with ORANGE color
- [ ] Hover shows tooltip: "Delete from computer (permanent)"
- [ ] Click Delete button
- [ ] Confirmation dialog appears
- [ ] Confirm deletion
- [ ] Recording removed from list
- [ ] Toast notification confirms deletion

**Expected**: Orange delete button, confirmation dialog, recording deleted locally.

---

### 10. Delete Button - Synced Recording
Find a synced recording (exists on both device and computer).

- [ ] Delete button visible with DEFAULT color (muted-foreground)
- [ ] Hover shows tooltip: "Delete from device and computer"
- [ ] Click Delete button
- [ ] Confirmation dialog appears
- [ ] Confirm deletion
- [ ] Recording removed from list
- [ ] Toast notification confirms deletion

**Expected**: Default color button, confirmation dialog, recording deleted from both locations.

---

### 11. Event Propagation Prevention
- [ ] Click any action button (Ask Assistant, Delete, etc.)
- [ ] Recording row does NOT get selected
- [ ] Action executes without triggering row click
- [ ] Click on recording row (not on button)
- [ ] Recording row DOES get selected (normal behavior)

**Expected**: Button clicks do not trigger row selection.

---

### 12. Tooltips
Hover over each button and verify tooltips:

- [ ] Ask Assistant: "Ask Assistant about this capture"
- [ ] Generate Output: "Generate artifact from this capture"
- [ ] Transcribe: "Transcribe this capture" (or "Transcription queued"/"Transcription in progress")
- [ ] Download: "Download to computer" or "Device not connected"
- [ ] Play: "Play capture" or "Download to play" or "File missing"
- [ ] Stop: "Stop playback"
- [ ] Delete: Varies by location (see above)

**Expected**: All tooltips display correctly on hover.

---

## Console Errors Check

Open DevTools Console (Ctrl+Shift+I or Cmd+Option+I).

- [ ] No errors about missing components
- [ ] No errors about undefined props
- [ ] No React warnings about missing keys
- [ ] No TypeScript type errors in console
- [ ] No warnings about event handler issues

**Expected**: Clean console with no errors or warnings.

---

## Accessibility Check

### Keyboard Navigation
- [ ] Tab key moves focus through action buttons
- [ ] Focus indicator visible on each button
- [ ] Enter key activates focused button
- [ ] Tab order is logical (left to right)

### Screen Reader (Optional)
- [ ] Button labels are announced
- [ ] Tooltips are read as accessible descriptions
- [ ] Disabled state announced for disabled buttons

**Expected**: Buttons are keyboard-accessible and screen-reader friendly.

---

## Final Checklist

- [ ] All 10 verification tests passed
- [ ] No console errors or warnings
- [ ] No visual glitches or layout issues
- [ ] Action buttons work identically to Card View
- [ ] Application stable after multiple actions

---

## If Tests Fail

### Debug Steps
1. Check browser console for errors
2. Verify correct branch: `git branch` → should show `fix/phase1-library`
3. Verify latest commit: `git log --oneline -1` → should be `827a0a2f`
4. Rebuild app: `npm run dev` (restart dev server)
5. Clear browser cache: Hard refresh (Ctrl+Shift+R)

### Report Issues
If tests fail, document:
- Which test failed
- Error message in console
- Screenshot of issue
- Steps to reproduce

---

## Sign-Off

**Tester Name**: ___________________

**Date**: ___________________

**Result**: [ ] PASS  [ ] FAIL (see notes)

**Notes**:
