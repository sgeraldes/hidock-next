/**
 * Meeting-category → Tailwind class maps. Single source of truth for the color
 * language shared by the Today ribbon and the Calendar surface, so a "1:1" reads
 * the same violet everywhere and there is only ONE category palette to reason
 * about. Category itself is derived by `categorizeMeeting` in `meeting-timing.ts`.
 *
 * The dot/chip variants power small glyphs and time-chips; the block variant is
 * for a full calendar event block: a soft tint with dark (light-theme) / light
 * (dark-theme) text — chosen so block text keeps ≥4.5:1 contrast in both themes,
 * which tinted-background-with-dark-text does more reliably than a saturated fill
 * with white text. A thin inset ring gives edge definition WITHOUT a side stripe.
 */

import type { MeetingCategory } from './meeting-timing'

/** Semantic category → dot color (a data dimension the eye can read). */
export const CATEGORY_DOT: Record<MeetingCategory, string> = {
  recurring: 'bg-sky-500',
  one_on_one: 'bg-violet-500',
  external: 'bg-amber-500',
  personal: 'bg-emerald-500',
  general: 'bg-slate-400 dark:bg-slate-500'
}

/** Category → tinted time-chip (carries the color without a thick side border). */
export const CATEGORY_CHIP: Record<MeetingCategory, string> = {
  recurring: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  one_on_one: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  external: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  personal: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  general: 'bg-slate-500/10 text-slate-600 dark:text-slate-300'
}

/**
 * Category → full calendar-block styling (tinted fill + readable text + inset
 * ring for edge definition). No side-stripe border. Used by the recording-centric
 * week/day blocks and the month-view chips.
 */
export const CATEGORY_BLOCK: Record<MeetingCategory, string> = {
  recurring:
    'bg-sky-500/15 text-sky-900 ring-1 ring-inset ring-sky-500/30 dark:bg-sky-500/25 dark:text-sky-50 dark:ring-sky-400/25',
  one_on_one:
    'bg-violet-500/15 text-violet-900 ring-1 ring-inset ring-violet-500/30 dark:bg-violet-500/25 dark:text-violet-50 dark:ring-violet-400/25',
  external:
    'bg-amber-500/20 text-amber-900 ring-1 ring-inset ring-amber-500/30 dark:bg-amber-500/25 dark:text-amber-50 dark:ring-amber-400/25',
  personal:
    'bg-emerald-500/15 text-emerald-900 ring-1 ring-inset ring-emerald-500/30 dark:bg-emerald-500/25 dark:text-emerald-50 dark:ring-emerald-400/25',
  general:
    'bg-slate-500/15 text-slate-800 ring-1 ring-inset ring-slate-500/25 dark:bg-slate-400/20 dark:text-slate-50 dark:ring-slate-400/20'
}

/**
 * An unmatched recording (captured audio that fell on no calendar meeting) is NOT
 * a category — it's an exception the user should resolve. It gets its own amber
 * treatment, distinct from the category palette and from the "not recorded" ghost.
 */
export const UNMATCHED_BLOCK =
  'bg-amber-500/15 text-amber-900 ring-1 ring-inset ring-amber-500/40 dark:bg-amber-500/25 dark:text-amber-100 dark:ring-amber-400/30'

/** Legend order (recurring → general). */
export const CATEGORY_ORDER: MeetingCategory[] = ['recurring', 'one_on_one', 'external', 'personal', 'general']
