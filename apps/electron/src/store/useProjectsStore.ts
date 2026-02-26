/**
 * Re-export from canonical location to prevent dual Zustand instances.
 * See FIX-007 in STABILITY_FIXES.md for why this pattern is necessary.
 */
export { useProjectsStore } from './domain/useProjectsStore'
