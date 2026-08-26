/**
 * Main ↔ preload BrainId contract — the renderer-facing union in
 * `electron/preload/index.ts` is a deliberate MIRROR of the main-process
 * `BrainId` (it can't import it — see the preload header). Mirrors drift: the
 * 'kiro' addition initially landed only on the main side. These are COMPILE-TIME
 * guards (checked by `npm run typecheck:node`, whose program includes both this
 * file and the preload): adding/removing a member on either side without the
 * other breaks the mutual-assignability assertions below.
 *
 * The imports are type-only, so the preload module (which touches Electron's
 * contextBridge at load) is never executed at test runtime.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import type { BrainId, BrainCapability, BrainTask } from '../types'
import type {
  BrainId as PreloadBrainId,
  BrainCapability as PreloadBrainCapability,
  BrainTask as PreloadBrainTask,
} from '../../../../preload/index'

/** Resolves to `true` only when A and B are mutually assignable (identical unions). */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

// COMPILE-TIME exhaustiveness guards — a drift on either side turns the type
// into `never` and the assignment (and typecheck) fails.
const brainIdContract: AssertEqual<BrainId, PreloadBrainId> = true
const brainCapabilityContract: AssertEqual<BrainCapability, PreloadBrainCapability> = true
const brainTaskContract: AssertEqual<BrainTask, PreloadBrainTask> = true

describe('main ↔ preload brains type contract', () => {
  it('BrainId, BrainCapability and BrainTask unions are identical on both sides', () => {
    // The real assertion is the compile-time AssertEqual above; this runtime
    // check just keeps the constants referenced and the suite non-empty.
    expect(brainIdContract).toBe(true)
    expect(brainCapabilityContract).toBe(true)
    expect(brainTaskContract).toBe(true)
  })
})
