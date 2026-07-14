// @vitest-environment node

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { createRequire } from 'node:module'
import { DatabaseEngine } from '@hidock/database'
import { KnowledgeGraphStore } from '../src/graph-store.js'
import { ingestExtraction } from '../src/ingest.js'
import {
  lensGraph,
  pickDefaultCenter,
  provenance,
  stratumOf,
  formatDateMs,
  ownDateMs,
  STRATA,
  STRATUM_OF,
  DAY_MS,
  LENS_STRATUM_BUDGET,
} from '../src/queries.js'
import type { ExtractionResult, ExtractionMeta } from '../src/extract.js'

// The engine requires the app-owned better-sqlite3 native module. Resolve the
// database package's OWN copy (the one CI's "npm rebuild better-sqlite3"
// Node-ABI restore step targets) so resolution never depends on hoisting.
const requireFromDatabase = createRequire(new URL('../../database/package.json', import.meta.url))
const BetterSqlite3 = requireFromDatabase('better-sqlite3')

/** Engines opened by makeStore — closed in afterEach so temp DBs can be deleted. */
const openEngines: DatabaseEngine[] = []

function tempPath(name: string) {
  return join(tmpdir(), `hidock-kg-lens-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`)
}

async function makeStore(name: string) {
  const dbPath = tempPath(name)
  const engine = new DatabaseEngine({
    betterSqlite3: BetterSqlite3,
    dbPathProvider: () => dbPath,
    schemaVersion: 1,
    schema: 'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)',
    migrations: {},
  })
  await engine.initialize()
  openEngines.push(engine)
  const store = new KnowledgeGraphStore(engine)
  store.initSchema()
  return { store, dbPath }
}

/** A full extraction with a decision, action, risk, next step, topic, project. */
function richExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    people: [
      { name: 'Alice', skills: ['SQL'] },
      { name: 'Bob', skills: [] },
    ],
    topics: ['Roadmap'],
    projects: ['Phoenix'],
    decisions: ['Adopt weekly releases'],
    action_items: [{ text: 'Draft the release plan', owner: 'Alice' }],
    risks: [{ text: 'Timeline is tight', raised_by: 'Bob' }],
    next_steps: ['Schedule the retro'],
    ...overrides,
  }
}

describe('Lens: strata assignment by type', () => {
  it('maps every node type to a stratum band', () => {
    expect(stratumOf('decision')).toBe('strategic')
    expect(stratumOf('risk')).toBe('strategic')
    expect(stratumOf('project')).toBe('operational')
    expect(stratumOf('action_item')).toBe('operational')
    expect(stratumOf('next_step')).toBe('operational')
    expect(stratumOf('topic')).toBe('operational')
    expect(stratumOf('person')).toBe('people')
    expect(stratumOf('skill')).toBe('people')
    expect(stratumOf('meeting')).toBe('evidence')
    // Unknown types fall to the work band, never crash.
    expect(stratumOf('mystery')).toBe('operational')
  })

  it('STRATA is ordered top-down and covers every mapped stratum', () => {
    expect(STRATA).toEqual(['strategic', 'operational', 'people', 'evidence'])
    for (const s of Object.values(STRATUM_OF)) {
      expect(STRATA).toContain(s)
    }
  })
})

describe('Lens: date derivation', () => {
  const paths: string[] = []
  afterEach(() => {
    // better-sqlite3 holds the DB file open — close engines first, or rmSync
    // EPERMs on Windows and stale state leaks into the next run.
    for (const e of openEngines) {
      try { e.closeDatabase() } catch { /* already closed */ }
    }
    openEngines.length = 0
    for (const p of paths) {
      for (const f of [p, `${p}-wal`, `${p}-shm`]) {
        if (existsSync(f)) rmSync(f, { force: true })
      }
    }
    paths.length = 0
  })

  it('meetings use their own props.date; work nodes inherit the meeting date', async () => {
    const { store, dbPath } = await makeStore('dates')
    paths.push(dbPath)
    const meta: ExtractionMeta = { meetingId: 'm1', title: 'Kickoff', date: '2026-06-01' }
    ingestExtraction(store, richExtraction(), meta, { now: '2026-06-01T00:00:00Z' })

    const lens = lensGraph(store, null, { cap: 100, windowDays: null })
    const meeting = lens.nodes.find((n) => n.type === 'meeting')!
    expect(formatDateMs(meeting.dateMs)).toBe('2026-06-01')

    // The decision has no own date, but MADE_IN the meeting → inherits 2026-06-01.
    const decision = lens.nodes.find((n) => n.type === 'decision')!
    expect(formatDateMs(decision.dateMs)).toBe('2026-06-01')

    // referenceMs equals the newest activity (the meeting date).
    expect(formatDateMs(lens.referenceMs)).toBe('2026-06-01')
  })

  it('ownDateMs falls back to created_at when no props.date', async () => {
    const { store, dbPath } = await makeStore('owndate')
    paths.push(dbPath)
    const id = store.upsertNode({ type: 'topic', label: 'Solo', now: '2026-05-05T00:00:00Z' })
    const node = store.getNode(id)!
    expect(formatDateMs(ownDateMs(node))).toBe('2026-05-05')
  })
})

describe('Lens: scoping (centered vs whole-graph)', () => {
  const paths: string[] = []
  afterEach(() => {
    // better-sqlite3 holds the DB file open — close engines first, or rmSync
    // EPERMs on Windows and stale state leaks into the next run.
    for (const e of openEngines) {
      try { e.closeDatabase() } catch { /* already closed */ }
    }
    openEngines.length = 0
    for (const p of paths) {
      for (const f of [p, `${p}-wal`, `${p}-shm`]) {
        if (existsSync(f)) rmSync(f, { force: true })
      }
    }
    paths.length = 0
  })

  it('a person-centered lens (2 hops) reaches evidence, work and strategy strata', async () => {
    const { store, dbPath } = await makeStore('centered')
    paths.push(dbPath)
    const meta: ExtractionMeta = { meetingId: 'm1', title: 'Kickoff', date: '2026-06-01' }
    ingestExtraction(store, richExtraction(), meta)

    const alice = store.findNodes({ type: 'person' }).find((n) => n.label === 'Alice')!
    const lens = lensGraph(store, alice.id, { hops: 2, windowDays: null })

    expect(lens.center?.id).toBe(alice.id)
    const strata = new Set(lens.nodes.map((n) => n.stratum))
    expect(strata.has('people')).toBe(true) // Alice + Bob
    expect(strata.has('evidence')).toBe(true) // the meeting
    expect(strata.has('operational')).toBe(true) // project/topic/action
    expect(strata.has('strategic')).toBe(true) // decision reachable via the meeting
    // Every kept edge connects two kept nodes.
    const kept = new Set(lens.nodes.map((n) => n.id))
    expect(lens.edges.every((e) => kept.has(e.source_id) && kept.has(e.target_id))).toBe(true)
  })

  it('a whole-graph lens (center null) caps to the highest-degree nodes', async () => {
    const { store, dbPath } = await makeStore('whole')
    paths.push(dbPath)
    const hub = store.upsertNode({ type: 'meeting', label: 'Hub' })
    for (let i = 0; i < 6; i++) {
      const leaf = store.upsertNode({ type: 'person', label: `P${i}` })
      store.upsertEdge({ sourceId: leaf, targetId: hub, type: 'ATTENDED' })
    }
    const lens = lensGraph(store, null, { cap: 3, windowDays: null })
    expect(lens.center).toBeUndefined()
    expect(lens.nodes).toHaveLength(3)
    expect(lens.nodes.some((n) => n.id === hub)).toBe(true)
  })
})

describe('Lens: time-window filtering', () => {
  const paths: string[] = []
  afterEach(() => {
    // better-sqlite3 holds the DB file open — close engines first, or rmSync
    // EPERMs on Windows and stale state leaks into the next run.
    for (const e of openEngines) {
      try { e.closeDatabase() } catch { /* already closed */ }
    }
    openEngines.length = 0
    for (const p of paths) {
      for (const f of [p, `${p}-wal`, `${p}-shm`]) {
        if (existsSync(f)) rmSync(f, { force: true })
      }
    }
    paths.length = 0
  })

  it('drops nodes older than the window, anchored to newest activity', async () => {
    const { store, dbPath } = await makeStore('window')
    paths.push(dbPath)

    // Two meetings 60 days apart, each with its own topic.
    const recent: ExtractionMeta = { meetingId: 'm-new', title: 'Recent', date: '2026-06-30' }
    const old: ExtractionMeta = { meetingId: 'm-old', title: 'Old', date: '2026-05-01' }
    ingestExtraction(store, { people: [], topics: ['RecentTopic'], projects: [], decisions: [], action_items: [], risks: [], next_steps: [] }, recent)
    ingestExtraction(store, { people: [], topics: ['OldTopic'], projects: [], decisions: [], action_items: [], risks: [], next_steps: [] }, old)

    // No filter → both meetings present.
    const all = lensGraph(store, null, { cap: 100, windowDays: null })
    expect(all.nodes.filter((n) => n.type === 'meeting')).toHaveLength(2)
    expect(formatDateMs(all.referenceMs)).toBe('2026-06-30')

    // 30-day window from 2026-06-30 (cutoff 2026-05-31) → the May meeting drops.
    const recentOnly = lensGraph(store, null, { cap: 100, windowDays: 30 })
    const meetings = recentOnly.nodes.filter((n) => n.type === 'meeting')
    expect(meetings).toHaveLength(1)
    expect(meetings[0].label).toBe('Recent')
    // OldTopic (dated via the old meeting) is filtered; RecentTopic remains.
    expect(recentOnly.nodes.some((n) => n.label === 'OldTopic')).toBe(false)
    expect(recentOnly.nodes.some((n) => n.label === 'RecentTopic')).toBe(true)
  })

  it('always keeps the center node even if it falls outside the window', async () => {
    const { store, dbPath } = await makeStore('keep-center')
    paths.push(dbPath)
    const old: ExtractionMeta = { meetingId: 'm-old', title: 'Old', date: '2026-01-01' }
    const recent: ExtractionMeta = { meetingId: 'm-new', title: 'Recent', date: '2026-06-30' }
    // Alice attends only the OLD meeting; Bob attends the recent one → newest ref.
    ingestExtraction(store, { people: [{ name: 'Alice', skills: [] }], topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [] }, old)
    ingestExtraction(store, { people: [{ name: 'Bob', skills: [] }], topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [] }, recent)

    const alice = store.findNodes({ type: 'person' }).find((n) => n.label === 'Alice')!
    const lens = lensGraph(store, alice.id, { hops: 2, windowDays: 7 })
    // Alice is the center → kept despite her only meeting being far in the past.
    expect(lens.nodes.some((n) => n.id === alice.id)).toBe(true)
  })

  it('DAY_MS is one day of milliseconds', () => {
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('Lens: default center selection', () => {
  const paths: string[] = []
  afterEach(() => {
    // better-sqlite3 holds the DB file open — close engines first, or rmSync
    // EPERMs on Windows and stale state leaks into the next run.
    for (const e of openEngines) {
      try { e.closeDatabase() } catch { /* already closed */ }
    }
    openEngines.length = 0
    for (const p of paths) {
      for (const f of [p, `${p}-wal`, `${p}-shm`]) {
        if (existsSync(f)) rmSync(f, { force: true })
      }
    }
    paths.length = 0
  })

  it('prefers the owner contact when provided', async () => {
    const { store, dbPath } = await makeStore('owner')
    paths.push(dbPath)
    ingestExtraction(store, richExtraction(), { meetingId: 'm1', title: 'K', date: '2026-06-01' }, {
      resolvePerson: (name) => (/alice/i.test(name) ? { id: 'c-alice', label: 'Alice' } : null),
    })
    const center = pickDefaultCenter(store, 'c-alice')
    expect(center?.norm_key).toBe('contact:c-alice')
  })

  it('falls back to the highest-degree person', async () => {
    const { store, dbPath } = await makeStore('highest')
    paths.push(dbPath)
    // Alice attends 2 meetings, Bob 1 → Alice is the higher-degree person.
    ingestExtraction(store, { people: [{ name: 'Alice', skills: [] }, { name: 'Bob', skills: [] }], topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [] }, { meetingId: 'm1', title: 'One', date: '2026-06-01' })
    ingestExtraction(store, { people: [{ name: 'Alice', skills: [] }], topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [] }, { meetingId: 'm2', title: 'Two', date: '2026-06-02' })

    const center = pickDefaultCenter(store)
    expect(center?.label).toBe('Alice')
  })

  it('returns undefined when the graph has no people', async () => {
    const { store, dbPath } = await makeStore('nopeople')
    paths.push(dbPath)
    store.upsertNode({ type: 'topic', label: 'Lonely' })
    expect(pickDefaultCenter(store)).toBeUndefined()
  })
})

describe('Lens: per-stratum node budget', () => {
  const paths: string[] = []
  afterEach(() => {
    // better-sqlite3 holds the DB file open — close engines first, or rmSync
    // EPERMs on Windows and stale state leaks into the next run.
    for (const e of openEngines) {
      try { e.closeDatabase() } catch { /* already closed */ }
    }
    openEngines.length = 0
    for (const p of paths) {
      for (const f of [p, `${p}-wal`, `${p}-shm`]) {
        if (existsSync(f)) rmSync(f, { force: true })
      }
    }
    paths.length = 0
  })

  /** Seed `n` meetings dated 2026-01-01 … 2026-01-<n> (M-01 oldest … newest). */
  function seedMeetings(store: KnowledgeGraphStore, n: number): string[] {
    const ids: string[] = []
    for (let i = 1; i <= n; i++) {
      const dd = String(i).padStart(2, '0')
      ids.push(store.upsertNode({ type: 'meeting', label: `M-${dd}`, props: { date: `2026-01-${dd}` } }))
    }
    return ids
  }

  it('exposes a positive budget for every stratum', () => {
    for (const s of STRATA) expect(LENS_STRATUM_BUDGET[s]).toBeGreaterThan(0)
  })

  it('caps a stratum to its budget and reports total-vs-shown', async () => {
    const { store, dbPath } = await makeStore('budget-cap')
    paths.push(dbPath)
    seedMeetings(store, 30) // 30 meetings → evidence band, budget 20

    const lens = lensGraph(store, null, { cap: 500, windowDays: null })
    const evidence = lens.nodes.filter((n) => n.stratum === 'evidence')
    expect(evidence).toHaveLength(LENS_STRATUM_BUDGET.evidence)

    const count = lens.strata.find((s) => s.stratum === 'evidence')!
    expect(count.total).toBe(30)
    expect(count.shown).toBe(LENS_STRATUM_BUDGET.evidence)
    // Bands under budget report shown === total.
    const emptyBands = lens.strata.filter((s) => s.stratum !== 'evidence')
    expect(emptyBands.every((s) => s.shown === s.total)).toBe(true)
  })

  it('keeps the NEWEST nodes when a band is over budget', async () => {
    const { store, dbPath } = await makeStore('budget-newest')
    paths.push(dbPath)
    seedMeetings(store, 30)

    const lens = lensGraph(store, null, { cap: 500, windowDays: null })
    const shown = new Set(lens.nodes.filter((n) => n.stratum === 'evidence').map((n) => n.label))
    // Newest 20 (days 11–30) kept; oldest 10 (days 1–10) dropped.
    for (let i = 11; i <= 30; i++) expect(shown.has(`M-${String(i).padStart(2, '0')}`)).toBe(true)
    for (let i = 1; i <= 10; i++) expect(shown.has(`M-${String(i).padStart(2, '0')}`)).toBe(false)
  })

  it('prunes edges to only those between shown nodes', async () => {
    const { store, dbPath } = await makeStore('budget-edges')
    paths.push(dbPath)
    const topic = store.upsertNode({ type: 'topic', label: 'Hub' })
    const ids = seedMeetings(store, 30)
    for (const m of ids) store.upsertEdge({ sourceId: m, targetId: topic, type: 'ABOUT' })

    const lens = lensGraph(store, null, { cap: 500, windowDays: null })
    const kept = new Set(lens.nodes.map((n) => n.id))
    expect(lens.edges.every((e) => kept.has(e.source_id) && kept.has(e.target_id))).toBe(true)
    // 30 ABOUT edges collapse to only the 20 shown meetings' edges.
    expect(lens.edges).toHaveLength(20)
  })

  it('always keeps the lens center even when its band is over budget and it is oldest', async () => {
    const { store, dbPath } = await makeStore('budget-center')
    paths.push(dbPath)
    const topic = store.upsertNode({ type: 'topic', label: 'Hub' })
    const ids = seedMeetings(store, 30) // M-01 oldest … M-30 newest
    for (const m of ids) store.upsertEdge({ sourceId: m, targetId: topic, type: 'ABOUT' })
    const oldest = ids[0]

    const lens = lensGraph(store, oldest, { hops: 2, windowDays: null })
    expect(lens.center?.id).toBe(oldest)
    // Center kept despite being the oldest in an over-budget band…
    expect(lens.nodes.some((n) => n.id === oldest)).toBe(true)
    expect(lens.nodes.filter((n) => n.stratum === 'evidence')).toHaveLength(20)
    // …at the cost of one newer meeting (center + 19 newest = 20 shown).
    expect(lens.nodes.some((n) => n.label === 'M-02')).toBe(false)
  })

  it('is deterministic — identical scope yields identical picks', async () => {
    const { store, dbPath } = await makeStore('budget-determinism')
    paths.push(dbPath)
    seedMeetings(store, 30)

    const a = lensGraph(store, null, { cap: 500, windowDays: null })
    const b = lensGraph(store, null, { cap: 500, windowDays: null })
    expect(a.nodes.map((n) => n.id)).toEqual(b.nodes.map((n) => n.id))
  })
})

describe('Provenance: path derivation', () => {
  const paths: string[] = []
  afterEach(() => {
    // better-sqlite3 holds the DB file open — close engines first, or rmSync
    // EPERMs on Windows and stale state leaks into the next run.
    for (const e of openEngines) {
      try { e.closeDatabase() } catch { /* already closed */ }
    }
    openEngines.length = 0
    for (const p of paths) {
      for (const f of [p, `${p}-wal`, `${p}-shm`]) {
        if (existsSync(f)) rmSync(f, { force: true })
      }
    }
    paths.length = 0
  })

  it('derives a decision path: meeting, people and a narrative', async () => {
    const { store, dbPath } = await makeStore('prov-decision')
    paths.push(dbPath)
    ingestExtraction(store, richExtraction(), { meetingId: 'm1', title: 'Kickoff', date: '2026-06-01' })

    const decision = store.findNodes({ type: 'decision' })[0]
    const prov = provenance(store, decision.id)

    expect(prov.node?.type).toBe('decision')
    expect(prov.meetings.some((m) => m.label === 'Kickoff')).toBe(true)
    // People present in the meeting are on the path.
    expect(prov.people.length).toBeGreaterThan(0)
    expect(prov.dateMs).not.toBeNull()
    expect(formatDateMs(prov.dateMs)).toBe('2026-06-01')
    // Narrative names the evidence meeting and date.
    expect(prov.narrative).toContain('Kickoff')
    expect(prov.narrative).toContain('2026-06-01')
    expect(prov.narrative.startsWith('Decided')).toBe(true)
    // pathIds include the decision itself and are unique.
    expect(prov.pathIds).toContain(decision.id)
    expect(new Set(prov.pathIds).size).toBe(prov.pathIds.length)
  })

  it('derives a risk path naming the raiser', async () => {
    const { store, dbPath } = await makeStore('prov-risk')
    paths.push(dbPath)
    ingestExtraction(store, richExtraction(), { meetingId: 'm1', title: 'Kickoff', date: '2026-06-01' })

    const risk = store.findNodes({ type: 'risk' })[0]
    const prov = provenance(store, risk.id)
    expect(prov.node?.type).toBe('risk')
    expect(prov.narrative.startsWith('Raised')).toBe(true)
    // Bob raised the risk → he's among the people.
    expect(prov.people.some((p) => p.label === 'Bob')).toBe(true)
  })

  it('returns an empty provenance for an unknown node', async () => {
    const { store, dbPath } = await makeStore('prov-missing')
    paths.push(dbPath)
    const prov = provenance(store, 'decision:does-not-exist')
    expect(prov.node).toBeNull()
    expect(prov.pathIds).toHaveLength(0)
    expect(prov.narrative).toBe('')
  })
})
