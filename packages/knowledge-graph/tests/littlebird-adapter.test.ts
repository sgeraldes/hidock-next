// @vitest-environment node

/**
 * Synthetic-fixture tests for the Littlebird adapter (task 12.6, Req 8.4,
 * 8.5). Exercises `toCanonical` against the design in
 * `.kiro/specs/hidock-graph-extraction-hardening/littlebird-adapter-interface.md`.
 *
 * PRIVACY: every fixture below is invented. No real transcript, meeting, app
 * name, participant name, or Littlebird content appears anywhere in this
 * file. `classify`/`isHiDockOwnedMeeting` are stub functions supplied
 * per-test — this suite never connects to Littlebird and never will (no
 * network, no MCP client, no OAuth): the adapter under test is pure mapping
 * logic only.
 */

import { describe, it, expect } from 'vitest'
import { Category } from '../src/extract.js'
import {
  createLittlebirdSourceAdapter,
  createFailClosedClassifier,
  type LittlebirdSource,
  type AdapterMappingContext,
} from '../src/littlebird-adapter.js'

const SYNTHETIC_ITEM: LittlebirdSource = {
  nativeEventId: 'synthetic-native-id-001',
  originatingApp: 'synthetic-chat-app',
  appContext: 'synthetic-channel-42',
  sourceTimestamp: '2099-01-01T10:00:00.000Z',
  participants: ['Synthetic Alpha', 'Synthetic Beta'],
  permalink: 'https://synthetic.invalid/evidence/001',
  connectorVersion: 'test-connector-0.0.0',
  contentHash: 'sha256:synthetic-hash-aaaa',
  tombstone: false,
}

function baseCtx(overrides: Partial<AdapterMappingContext> = {}): AdapterMappingContext {
  return {
    connectorVersion: 'test-connector-0.0.0',
    captureTimestamp: '2099-01-01T10:05:00.000Z',
    classify: () => ({ category: Category.Work }),
    isHiDockOwnedMeeting: () => false,
    ...overrides,
  }
}

describe('createLittlebirdSourceAdapter — identity', () => {
  it('exposes the constant source discriminator', () => {
    expect(createLittlebirdSourceAdapter().source).toBe('littlebird')
  })
})

describe('toCanonical — work-classified item is mapped in full', () => {
  it('maps every field named in Req 8.4', () => {
    const adapter = createLittlebirdSourceAdapter()
    const ctx = baseCtx()
    const result = adapter.toCanonical(SYNTHETIC_ITEM, ctx)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true')
    expect(result.record).toEqual({
      source: 'littlebird',
      nativeEventId: SYNTHETIC_ITEM.nativeEventId,
      originatingApp: SYNTHETIC_ITEM.originatingApp,
      appContext: SYNTHETIC_ITEM.appContext,
      sourceTimestamp: SYNTHETIC_ITEM.sourceTimestamp,
      participants: SYNTHETIC_ITEM.participants,
      permalink: SYNTHETIC_ITEM.permalink,
      captureTimestamp: ctx.captureTimestamp,
      classification: Category.Work,
      connectorVersion: ctx.connectorVersion,
      contentHash: SYNTHETIC_ITEM.contentHash,
      tombstone: false,
    })
  })

  it('does not require nativeEventId or permalink stability — a missing permalink still maps cleanly', () => {
    const adapter = createLittlebirdSourceAdapter()
    const { permalink: _drop, ...withoutPermalink } = SYNTHETIC_ITEM
    const result = adapter.toCanonical(withoutPermalink as LittlebirdSource, baseCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true')
    expect(result.record.permalink).toBeUndefined()
    expect(result.record.nativeEventId).toBe(SYNTHETIC_ITEM.nativeEventId)
  })
})

describe('toCanonical — fail-closed on non-work classification', () => {
  it('personal classification -> ok:false, classification:Personal, reason passed through', () => {
    const adapter = createLittlebirdSourceAdapter()
    const ctx = baseCtx({ classify: () => ({ category: Category.Personal, reason: 'non_exportable' }) })
    const result = adapter.toCanonical(SYNTHETIC_ITEM, ctx)
    expect(result).toEqual({ ok: false, classification: Category.Personal, reason: 'non_exportable' })
  })

  it('unknown classification -> ok:false, classification:Unknown', () => {
    const adapter = createLittlebirdSourceAdapter()
    const ctx = baseCtx({ classify: () => ({ category: Category.Unknown }) })
    const result = adapter.toCanonical(SYNTHETIC_ITEM, ctx)
    expect(result).toEqual({ ok: false, classification: Category.Unknown, reason: 'unclassifiable' })
  })

  it('classifier omitting a reason defaults to "unclassifiable"', () => {
    const adapter = createLittlebirdSourceAdapter()
    const ctx = baseCtx({ classify: () => ({ category: Category.Personal }) })
    const result = adapter.toCanonical(SYNTHETIC_ITEM, ctx)
    expect(result).toEqual({ ok: false, classification: Category.Personal, reason: 'unclassifiable' })
  })
})

describe('toCanonical — Req 8.5: HiDock-owned meeting overrides classification', () => {
  it('returns ok:false / hidock_owned_meeting even when classify would say Work', () => {
    const adapter = createLittlebirdSourceAdapter()
    const ctx = baseCtx({
      classify: () => ({ category: Category.Work }), // would otherwise retain
      isHiDockOwnedMeeting: () => true,
    })
    const result = adapter.toCanonical(SYNTHETIC_ITEM, ctx)
    expect(result).toEqual({ ok: false, classification: Category.Unknown, reason: 'hidock_owned_meeting' })
  })

  it('checks isHiDockOwnedMeeting before calling classify at all', () => {
    const adapter = createLittlebirdSourceAdapter()
    let classifyCalled = false
    const ctx = baseCtx({
      classify: () => {
        classifyCalled = true
        return { category: Category.Work }
      },
      isHiDockOwnedMeeting: () => true,
    })
    adapter.toCanonical(SYNTHETIC_ITEM, ctx)
    expect(classifyCalled).toBe(false)
  })
})

describe('createFailClosedClassifier — reference implementation', () => {
  it('excluded app -> Personal / excluded_app', () => {
    const classify = createFailClosedClassifier({ excludedApps: new Set(['synthetic-banking-app']) })
    const item: LittlebirdSource = { ...SYNTHETIC_ITEM, originatingApp: 'synthetic-banking-app' }
    expect(classify(item)).toEqual({ category: Category.Personal, reason: 'excluded_app' })
  })

  it('non-excluded app still fails closed to Personal / unclassifiable (no content signal to classify on)', () => {
    const classify = createFailClosedClassifier({ excludedApps: new Set(['synthetic-banking-app']) })
    expect(classify(SYNTHETIC_ITEM)).toEqual({ category: Category.Personal, reason: 'unclassifiable' })
  })

  it('with no config at all, every item fails closed to Personal', () => {
    const classify = createFailClosedClassifier()
    expect(classify(SYNTHETIC_ITEM).category).toBe(Category.Personal)
  })
})
