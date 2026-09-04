/**
 * Littlebird adapter: `LittlebirdSource` -> `Canonical_Capture_Model` (Req 8.4, 8.5).
 *
 * Implements, as real runtime code, the design-only interface from
 * `.kiro/specs/hidock-graph-extraction-hardening/littlebird-adapter-interface.md`
 * (task 12.4). This module contains NO live-connection logic: per the
 * integration-surface investigation (task 12.1) and the interactive
 * read-only fallback decision (task 12.2), Littlebird's only publicly
 * documented programmatic surface is an interactive, per-user, OAuth-gated
 * MCP server with no confirmed unattended access path. So this adapter is a
 * pure mapping/classification function — it never fetches, authenticates,
 * connects, or schedules anything. A caller invokes `toCanonical` with items
 * already retrieved through a live, human-driven MCP session.
 *
 * Reuses the spec-wide `Category` enum from `./extract.js` verbatim (Work |
 * Personal | Unknown) — the same fail-closed personal-content boundary
 * applied everywhere else in this package (design.md Property 1).
 *
 * Not authorised by this module, and not performed by it: live connection,
 * export, ingestion, Mem integration, or settings changes (architecture note
 * §8 / notes/littlebird-interactive-read-only-fallback.md §4).
 */

import { Category } from './extract.js'

/**
 * Shared canonical shape every capture source (`hidock` | `hinotes` |
 * `littlebird`) maps onto. Reused verbatim across the spec — do not fork
 * this definition per source (littlebird-adapter-interface.md §2).
 */
export interface CanonicalCaptureModel {
  source: 'hidock' | 'hinotes' | 'littlebird'
  nativeEventId: string
  originatingApp?: string
  appContext?: string
  sourceTimestamp: string
  participants: string[]
  permalink?: string
  captureTimestamp: string
  classification: Category
  connectorVersion: string
  contentHash: string
  tombstone: boolean
}

/**
 * Raw item shape as retrieved from Littlebird (design-level placeholder —
 * concrete live MCP tool-schema field names are UNCONFIRMED per task 12.1
 * and must be verified, under separate authorisation, before any live
 * retrieval is attempted).
 *
 * `source`, `captureTimestamp`, and `classification` are NOT part of this
 * raw shape: they are adapter-produced at mapping time (see `toCanonical`).
 */
export interface LittlebirdSource {
  /** UNCONFIRMED stability (task 12.1) — must not be required for correctness. */
  nativeEventId: string
  originatingApp: string
  appContext?: string
  sourceTimestamp: string
  participants: string[]
  /** UNCONFIRMED stability (task 12.1) — must not be required for correctness. */
  permalink?: string
  connectorVersion: string
  contentHash: string
  tombstone: boolean
}

/** Reason an item was mapped to a private / non-retainable outcome. */
export type PrivateReason =
  | 'excluded_app' // originating app is on Littlebird's exclusion list
  | 'paused_capture' // captured while capture was paused
  | 'non_exportable' // category Littlebird marks non-exportable (banking/health/etc.)
  | 'unclassifiable' // could not be confidently classified as Work -> fail closed
  | 'hidock_owned_meeting' // HiDock owns this meeting: no second raw transcript (Req 8.5)

/** Fail-closed result of mapping one `LittlebirdSource` item. */
export type AdapterResult =
  | { ok: true; record: CanonicalCaptureModel }
  | { ok: false; classification: Category.Personal | Category.Unknown; reason: PrivateReason }

/** Adapter-supplied context needed to complete the canonical mapping. */
export interface AdapterMappingContext {
  /** Build identity of this adapter -> record.connectorVersion. */
  connectorVersion: string
  /** Set at retrieval/normalise time -> record.captureTimestamp. */
  captureTimestamp: string
  /**
   * Fail-closed classifier. Returns Work only when the item is confidently
   * work-scoped and not excluded/paused/non-exportable. Any other outcome
   * (missing, malformed, unknown, personal) resolves to a non-Work Category.
   * Caller-supplied by design — see `createFailClosedClassifier` below for a
   * minimal reference implementation and its documented limits.
   */
  classify(item: LittlebirdSource): { category: Category; reason?: PrivateReason }
  /**
   * True when HiDock Next owns this meeting. When true the adapter must NOT
   * emit a competing raw transcript (Req 8.5); equivalence is represented by
   * dedup (see `./littlebird-dedup.js`), not by materialising a second
   * record here.
   */
  isHiDockOwnedMeeting(item: LittlebirdSource): boolean
}

/** Maps retrieved Littlebird items onto the shared canonical capture model. */
export interface LittlebirdSourceAdapter {
  /** Constant discriminator for everything this adapter emits. */
  readonly source: 'littlebird'

  /**
   * Map one raw item to a canonical evidence record, fail-closed.
   * - `source` is always `'littlebird'`.
   * - `classification` resolves to `Work` only when confidently work-scoped;
   *   otherwise `ok:false` with a `Personal | Unknown` outcome.
   * - Does not require `nativeEventId` or `permalink` to be present/stable
   *   for a correct mapping (their stability is UNCONFIRMED, task 12.1).
   * - When `ctx.isHiDockOwnedMeeting(item)` is true, returns `ok:false` /
   *   `reason: 'hidock_owned_meeting'` — no second raw transcript (Req 8.5) —
   *   independent of and checked before classification.
   */
  toCanonical(item: LittlebirdSource, ctx: AdapterMappingContext): AdapterResult
}

/**
 * Create the Littlebird adapter. Pure mapping logic only — no I/O, no
 * network, no MCP client, no credential handling, no scheduling. This
 * satisfies the interactive-read-only guardrails (notes/
 * littlebird-interactive-read-only-fallback.md §4): the adapter itself
 * cannot be invoked from a scheduler or background worker because it has no
 * mechanism to obtain items on its own — every item is handed to it by a
 * caller who already retrieved it inside a live, human-driven session.
 */
export function createLittlebirdSourceAdapter(): LittlebirdSourceAdapter {
  return {
    source: 'littlebird',

    toCanonical(item, ctx) {
      // Req 8.5: HiDock owns this meeting -> no second raw transcript, ever,
      // independent of and checked before classification.
      if (ctx.isHiDockOwnedMeeting(item)) {
        return { ok: false, classification: Category.Unknown, reason: 'hidock_owned_meeting' }
      }

      const { category, reason } = ctx.classify(item)

      if (category !== Category.Work) {
        return {
          ok: false,
          classification: category === Category.Personal ? Category.Personal : Category.Unknown,
          reason: reason ?? 'unclassifiable',
        }
      }

      const record: CanonicalCaptureModel = {
        source: 'littlebird',
        nativeEventId: item.nativeEventId,
        originatingApp: item.originatingApp,
        appContext: item.appContext,
        sourceTimestamp: item.sourceTimestamp,
        participants: item.participants,
        permalink: item.permalink,
        captureTimestamp: ctx.captureTimestamp,
        classification: Category.Work,
        connectorVersion: ctx.connectorVersion,
        contentHash: item.contentHash,
        tombstone: item.tombstone,
      }
      return { ok: true, record }
    },
  }
}

/**
 * Reference fail-closed classifier — NOT the only valid implementation;
 * `AdapterMappingContext.classify` is caller-supplied by design. This
 * reference operates ONLY on the documented-safe `originatingApp` signal
 * against a configurable exclusion set.
 *
 * Honest limitation, stated explicitly rather than papered over: the
 * design-level `LittlebirdSource` shape carries no content/category signal
 * at all (no text field, no upstream category flag — both would depend on
 * live MCP tool-schema fields that are UNCONFIRMED per task 12.1). So this
 * reference classifier structurally CANNOT distinguish work from personal
 * content beyond the exclusion-list check; every item that isn't on the
 * excluded-app list still fails closed to `Personal`/`unclassifiable`,
 * exactly as the spec requires ("if unsure, tag personal"). A caller with a
 * richer, live-verified item shape (e.g. one that does carry an upstream
 * category or paused-state flag) should supply its own `classify` instead
 * of this reference implementation.
 */
export function createFailClosedClassifier(options?: {
  excludedApps?: ReadonlySet<string>
}): AdapterMappingContext['classify'] {
  const excludedApps = options?.excludedApps ?? new Set<string>()
  return (item: LittlebirdSource) => {
    if (excludedApps.has(item.originatingApp)) {
      return { category: Category.Personal, reason: 'excluded_app' }
    }
    return { category: Category.Personal, reason: 'unclassifiable' }
  }
}
