/**
 * UI Store - Re-export from canonical location
 *
 * The canonical UI store lives at @/store/ui/useUIStore.
 * This file re-exports to maintain backward compatibility with imports
 * from @/store/useUIStore.
 *
 * WARNING: Do NOT create a separate create() call here.
 * Both paths MUST resolve to the same Zustand store instance.
 */

export { useUIStore } from './ui/useUIStore'
