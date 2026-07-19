/**
 * Shared FAIL-CLOSED evaluation of a `shouldGenerate` eligibility gate.
 *
 * ADV42-2 (round-44) introduced this at the BrainRouter boundary; ADV43-2
 * (round-45) threads the SAME callback INTO the embed adapters' internal
 * batch/request loops, so both the router and the adapters must evaluate it
 * identically. The source is treated as eligible ONLY when the callback returns
 * EXACTLY `true`. A `false` return OR any thrown error ⇒ ineligible (do NOT send
 * content to a provider — fail closed). A missing callback ⇒ eligible (no gate
 * configured — legacy behaviour).
 */
export function eligibleToGenerate(shouldGenerate?: () => boolean): boolean {
  if (!shouldGenerate) return true
  try {
    return shouldGenerate() === true
  } catch (e) {
    console.warn('[brains] shouldGenerate threw — treating source as ineligible (fail closed):', e)
    return false
  }
}
