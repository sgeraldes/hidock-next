# WAVE2-002 + WAVE2-003: Waveform Canvas & Enhanced Audio Player

## Summary

Implemented waveform visualization and enhanced audio player controls for the Audio Insights Electron app. This includes a simple vertical bar waveform with optional sentiment coloring, click-to-seek functionality, playback speed controls, and skip buttons.

## Files Created

### 1. `apps/electron/src/utils/audioUtils.ts`
Audio processing utilities module providing:
- **`generateWaveformData()`** - Generates waveform data from AudioBuffer by sampling amplitude peaks
- **`decodeAudioData()`** - Decodes base64-encoded audio into AudioBuffer
- **`formatTimestamp()`** - Formats time in seconds to HH:MM:SS or MM:SS
- **`formatFileSize()`** - Formats file size in bytes to human-readable string (e.g., "1.5 MB")

**Key Features:**
- Peak amplitude sampling for efficient waveform generation
- Configurable sample count (default: 1000 samples)
- Handles long recordings with HH:MM:SS format
- Proper error handling for invalid time values

### 2. `apps/electron/src/components/WaveformCanvas.tsx`
Simple canvas-based waveform visualization component.

**Features:**
- Vertical bars (3px wide, 1px gap) based on audio amplitude
- Monochromatic gray/blue by default (`#94A3B8` - Tailwind slate-400)
- Sentiment coloring support:
  - Red (`#EF4444`) for negative sentiment
  - Green (`#22C55E`) for positive sentiment
  - Gray for neutral or no sentiment data
- Click-to-seek functionality
- Optional playhead indicator (subtle dark line)
- Sharp rendering with `imageRendering: 'crisp-edges'`

**Props:**
- `audioData: Float32Array | null` - PCM samples for amplitude-based bars
- `sentimentData?: SentimentSegment[]` - Optional sentiment analysis data
- `currentTime?: number` - Current playback position for playhead
- `duration: number` - Total audio duration in seconds
- `onSeek: (time: number) => void` - Seek callback
- `height?: number` - Canvas height (default: 60px)
- `width?: number` - Canvas width (default: 800px)

## Files Modified

### 3. `apps/electron/src/types/stores.ts`
Added types for waveform and sentiment data to UIStore interface:
- **`SentimentSegment`** interface with startTime, endTime, and sentiment label
- **`playbackWaveformData: Float32Array | null`** - Waveform amplitude data
- **`playbackSentimentData: SentimentSegment[] | null`** - Sentiment segments
- **`setWaveformData()`** action to update waveform data
- **`setSentimentData()`** action to update sentiment segments

### 4. `apps/electron/src/store/ui/useUIStore.ts`
Updated UIStore implementation to include:
- Initial state for `playbackWaveformData: null`
- Initial state for `playbackSentimentData: null`
- `setWaveformData()` action implementation
- `setSentimentData()` action implementation

### 5. `apps/electron/src/store/index.ts`
Added `SentimentSegment` to exported types for external use.

### 6. `apps/electron/src/components/AudioPlayer.tsx`
Enhanced audio player with waveform visualization and new controls.

**Major Changes:**
- Replaced `<Slider>` progress bar with `<WaveformCanvas>` component
- Added skip buttons (±10 seconds) using `<SkipBack>` and `<SkipForward>` icons
- Added playback speed selector (0.5×, 1×, 1.5×, 2×) using `<Select>` component
- Improved time display using `formatTimestamp()` for HH:MM:SS formatting
- Added waveform data and sentiment data from UIStore
- Added loading state placeholder when waveform is not yet available

**New Controls:**
- `skipBackward()` - Seeks backward 10 seconds (disabled at start)
- `skipForward()` - Seeks forward 10 seconds (disabled at end)
- `handlePlaybackRateChange()` - Updates playback speed (UI state, backend implementation pending)

**Layout:**
```
┌─────────────────────────────────────────────┐
│ Filename (if provided)                      │
├─────────────────────────────────────────────┤
│ [Waveform Canvas with sentiment colors]    │
├─────────────────────────────────────────────┤
│ 0:00                                  3:45  │
├─────────────────────────────────────────────┤
│ [<10s] [Play/Pause] [+10s] [Stop]          │
│                        [Speed▼] [Close]    │
└─────────────────────────────────────────────┘
```

## TypeScript Compilation

All changes compile successfully with no new TypeScript errors:
- ✅ `npm run typecheck:node` passes
- ✅ `npm run typecheck:web` passes
- ✅ No errors in newly created/modified files

**Note:** Pre-existing TypeScript errors in unrelated test files remain (library filters, Actionables page).

## Integration Notes

### For Future Work

The enhanced AudioPlayer is now ready to display waveforms, but requires integration with the `OperationController` to populate waveform data. The next step is to:

1. **Update `OperationController.tsx`** to generate waveform data when playing audio:
   ```typescript
   import { decodeAudioData, generateWaveformData } from '@/utils/audioUtils'

   const playAudio = async (recordingId: string, filePath: string) => {
     // ... existing audio loading code ...

     // Decode audio for waveform
     const audioBuffer = await decodeAudioData(base64Data, mimeType)
     const waveformData = await generateWaveformData(audioBuffer, 1000)

     // Update UIStore
     useUIStore.getState().setWaveformData(waveformData)

     // ... rest of playback code ...
   }
   ```

2. **Optional: Add sentiment analysis** during transcription:
   - Extract sentiment segments from transcript timestamps
   - Store in transcript metadata JSON
   - Load and display in waveform when available

3. **Optional: Implement playback rate control**:
   - Add `setPlaybackRate()` to audio controls in `OperationController`
   - Use HTML5 Audio API's `playbackRate` property
   - Wire up `handlePlaybackRateChange()` in AudioPlayer

## Testing Checklist

- [ ] AudioPlayer renders with waveform when waveform data is available
- [ ] AudioPlayer shows "Loading waveform..." when data is null
- [ ] Click on waveform seeks to correct time position
- [ ] Skip buttons work correctly (±10 seconds)
- [ ] Skip buttons disabled at boundaries (start/end)
- [ ] Playback speed selector displays all options (0.5×, 1×, 1.5×, 2×)
- [ ] Time display formats correctly (MM:SS for short, HH:MM:SS for long)
- [ ] Play/Pause button toggles correctly
- [ ] Stop button stops playback and closes player (if onClose provided)
- [ ] Sentiment colors appear when sentiment data is provided
- [ ] Playhead indicator moves during playback

## Commits

1. **09eae5dd** - feat(audio): add audio processing utilities
2. **5cffd518** - feat(audio): add WaveformCanvas component
3. **de642b76** - feat(store): add waveform and sentiment data to UIStore
4. **76d3791f** - feat(audio): enhance AudioPlayer with waveform and playback controls

## Related Specifications

- **SPEC-WAVE2-002**: Waveform Canvas Implementation
- **SPEC-WAVE2-003**: Enhanced Audio Player UI
- **Plan**: `melodic-jumping-kurzweil.md` (lines 525-833)

---

**Implementation Status:** ✅ Complete (UI components and state management)
**Next Steps:** Integration with OperationController for waveform data population
