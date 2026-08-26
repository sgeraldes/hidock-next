/**
 * Brand — the app identity lockup: the "knowledge nexus" mark + a two-line
 * "Meeting Intelligence" wordmark.
 *
 * Self-contained and PLACEMENT-AGNOSTIC on purpose. The product owner is still
 * validating WHERE the brand lives (fully in the titlebar, fully in the sidebar
 * header, or the "corner/both" option this app ships by default), so this
 * component can be dropped into either surface with a single prop:
 *
 *   <Brand placement="titlebar" collapsed={!sidebarOpen} />   // default (option c)
 *   <Brand placement="sidebar"  collapsed={!sidebarOpen} />   // sidebar header
 *
 * Alignment contract (identical in both placements): the mark sits in a 64px
 * (w-16) slot and is centred, so its horizontal CENTRE lands on the shared 32px
 * nav-rail axis — the same x as every nav icon (Today / Library / Assistant …).
 * The mark is intentionally LARGER than a nav icon, but centering it in the 64px
 * slot keeps its centre on that axis, so the app mark and all nav icons form one
 * perfectly aligned vertical line.
 */

import { cn } from '@/lib/utils'

/**
 * Corner-cell divider treatment. The brand is ALWAYS the top-left corner cell
 * (icon on the nav-rail axis in every mode); these three values only change which
 * of the corner cell's two dividers are drawn, so the owner can preview how the
 * brand reads as part of the titlebar, the sidebar, or a boxed corner:
 *
 *  - 'titlebar' → drop the VERTICAL divider (brand cell's right border) so the
 *                 brand flows into the titlebar as one continuous bar; keep the
 *                 HORIZONTAL line below the brand (titlebar separated from sidebar).
 *  - 'sidebar'  → drop the HORIZONTAL line below the brand so the icon column
 *                 flows straight down into the nav rail; keep the VERTICAL divider
 *                 on the right (brand+sidebar separated from the titlebar content).
 *  - 'both'     → keep BOTH dividers → a boxed corner cell.
 *
 * Flip BRAND_DIVIDER_MODE to preview each treatment live. TitleBar (vertical
 * divider) and Layout (horizontal line below the brand) both read from it.
 */
export type BrandDividerMode = 'titlebar' | 'sidebar' | 'both'

export const BRAND_DIVIDER_MODE: BrandDividerMode = 'titlebar'

/** Vertical divider (brand cell right border) is shown for 'sidebar' + 'both'. */
export const showBrandVerticalDivider = (mode: BrandDividerMode = BRAND_DIVIDER_MODE): boolean => mode !== 'titlebar'

/** Horizontal line below the brand is shown for 'titlebar' + 'both'. */
export const showBrandHorizontalDivider = (mode: BrandDividerMode = BRAND_DIVIDER_MODE): boolean => mode !== 'sidebar'

interface BrandProps {
  /** Which surface hosts the brand — lets the owner swap placement trivially. */
  placement?: 'titlebar' | 'sidebar'
  /** Sidebar collapsed → show only the mark (hide the wordmark, like nav labels). */
  collapsed?: boolean
  /**
   * When provided, the whole lockup becomes a "home" affordance: a real button
   * (role/aria + hover cue) that runs this on click — the titlebar wires it to
   * navigate home. Opted-out of the titlebar drag region so the click lands.
   * When omitted, the brand renders as a plain, non-interactive lockup (default).
   */
  onHome?: () => void
  className?: string
}

export function Brand({ placement = 'titlebar', collapsed = false, onHome, className }: BrandProps) {
  const inner = (
    <>
      {/* Icon slot — 64px wide so the (larger) mark's CENTRE lands on the 32px
          nav-rail axis, lining the app mark up with every nav icon below it. */}
      <div className="flex h-full w-16 shrink-0 items-center justify-center">
        <AppMark />
      </div>

      {/* Two-line wordmark — the FULL product name ("Meeting Intelligence"; this
          app is the intelligence hub, not the device). Hidden when the sidebar is
          collapsed, exactly like the nav labels. `truncate` + `min-w-0` keep it
          from overflowing the brand cell at narrow widths. */}
      {!collapsed && (
        <div className="flex min-w-0 flex-col justify-center pr-2 leading-none">
          <span className="truncate text-[13px] font-semibold leading-[1.15] tracking-tight text-white">
            Meeting
          </span>
          <span className="truncate text-[13px] font-semibold leading-[1.15] tracking-tight text-white">
            Intelligence
          </span>
        </div>
      )}
    </>
  )

  // Interactive "home" lockup — a button (keyboard + screen-reader reachable) with
  // a subtle hover cue. `titlebar-no-drag` keeps the click from being swallowed by
  // the titlebar drag region.
  if (onHome) {
    return (
      <button
        type="button"
        onClick={onHome}
        aria-label="Go to home"
        title="Meeting Intelligence — go to home"
        data-placement={placement}
        data-testid="app-brand"
        className={cn(
          'titlebar-no-drag flex h-full items-center rounded-md transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
          className
        )}
      >
        {inner}
      </button>
    )
  }

  return (
    <div className={cn('flex h-full items-center', className)} data-placement={placement} data-testid="app-brand">
      {inner}
    </div>
  )
}

/**
 * The "knowledge nexus" mark — a central node with orbiting sources (per the
 * app-icon branding: a hub where every knowledge source connects). Rendered as a
 * 32px gradient tile (larger than a 20px nav icon) so it reads as the brand, but
 * kept centred in Brand's 64px slot so its centre stays on the 32px rail axis.
 */
export function AppMark() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 shadow-sm">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="3.4" fill="white" />
        <circle cx="4.5" cy="6" r="1.7" fill="white" fillOpacity="0.85" />
        <circle cx="19.5" cy="7.5" r="1.7" fill="white" fillOpacity="0.85" />
        <circle cx="18" cy="18.5" r="1.7" fill="white" fillOpacity="0.85" />
        <g stroke="white" strokeOpacity="0.6" strokeWidth="1.2">
          <line x1="10" y1="10.5" x2="5.5" y2="7" />
          <line x1="14" y1="10.3" x2="18.7" y2="8.4" />
          <line x1="13.6" y1="14" x2="17.3" y2="17.6" />
        </g>
      </svg>
    </span>
  )
}

export default Brand
