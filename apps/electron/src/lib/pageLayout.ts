/**
 * Shared page-content width scale for the non-Library surfaces.
 *
 * Problem this solves: each page used to hard-code its own narrow `max-w-*`
 * (max-w-3xl / 4xl / 5xl), so on a wide/maximized window the content collapsed
 * to a small centered column with large dead gutters. These class strings give
 * every surface ONE consistent, responsive width strategy that uses wide
 * windows sensibly while keeping long prose readable.
 *
 * Usage: apply to the `mx-auto` content wrapper of a page.
 *   <div className={cn(pageContent, 'space-y-6')}>…</div>
 *
 * Keep the full class strings literal (no interpolation) so Tailwind's JIT can
 * see them during the source scan.
 */

/**
 * Detail / prose surfaces (meeting detail, project detail, actionables list).
 * Grows a step at a time so it stays a comfortable reading column at 1280px
 * yet fills more of a 2200px+ window than the old 768/896px caps.
 * 896px → 1024px → 1152px.
 */
export const pageContent = 'mx-auto w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl'

/**
 * Dashboard / card-grid surfaces (Today, People). These lay content out in
 * multiple columns, so they can and should use much more of a wide window.
 * 1152px → 1344px → 1600px.
 */
export const pageWide = 'mx-auto w-full max-w-6xl xl:max-w-[84rem] 2xl:max-w-[100rem]'

/**
 * Readable measure (~70ch) for a long prose block that lives inside one of the
 * wider containers above, so summaries/transcripts don't stretch to unreadable
 * line lengths.
 */
export const proseMeasure = 'max-w-[70ch]'
