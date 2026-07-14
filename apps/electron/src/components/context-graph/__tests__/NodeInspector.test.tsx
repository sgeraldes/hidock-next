import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NodeInspector } from '../NodeInspector'
import { ToastProvider } from '@/components/ui/toaster'
import type { NodeDetail, Provenance } from '../types'

const nodeDetail = vi.fn()
const provenance = vi.fn()
const rename = vi.fn()
const convertToContact = vi.fn()
const linkContact = vi.fn()
const setPronouns = vi.fn()
const mergePreview = vi.fn()
const mergeNodes = vi.fn()
const deleteNode = vi.fn()
const search = vi.fn()
const contactsGetAll = vi.fn()

global.window.electronAPI = {
  contextGraph: {
    nodeDetail,
    provenance,
    rename,
    convertToContact,
    linkContact,
    setPronouns,
    mergePreview,
    mergeNodes,
    deleteNode,
    search,
  },
  contacts: { getAll: contactsGetAll },
} as unknown as typeof window.electronAPI

const EXTRACTED: NodeDetail = {
  node: { id: 'person:jiarabi', type: 'person', label: 'Jiarabi' },
  linked: false,
  contactId: null,
  pronouns: null,
  role: null,
  company: null,
  email: null,
  meetingCount: 2,
  firstSeenMs: Date.parse('2026-01-10'),
  lastSeenMs: Date.parse('2026-01-26'),
  peopleCount: 1,
  projectCount: 1,
  degree: 3,
  aliases: [],
  narrative: 'Meeting · 2026-01-26 · 2 people',
}

const LINKED: NodeDetail = {
  node: { id: 'person:contact_c-yar', type: 'person', label: 'Yaraví', contactId: 'c-yar' },
  linked: true,
  contactId: 'c-yar',
  pronouns: 'He/Him',
  role: 'Engineer',
  company: 'Acme',
  email: 'y@acme.com',
  meetingCount: 5,
  firstSeenMs: Date.parse('2026-01-01'),
  lastSeenMs: Date.parse('2026-02-01'),
  peopleCount: 3,
  projectCount: 2,
  degree: 9,
  aliases: ['jiarabi'],
  narrative: 'Meeting · 2026-02-01',
}

const PROV_WITH_MEETING: Provenance = {
  node: { id: 'person:jiarabi', type: 'person', label: 'Jiarabi', dateMs: null },
  meetings: [{ id: 'meeting:mtg-1', type: 'meeting', label: 'Kickoff', dateMs: Date.parse('2026-01-26'), meetingId: 'mtg-1' }],
  people: [],
  projects: [],
  actions: [],
  pathIds: ['person:jiarabi', 'meeting:mtg-1'],
  narrative: 'Meeting · 2026-01-26',
  dateMs: Date.parse('2026-01-26'),
}

const EMPTY_PROV: Provenance = {
  node: null,
  meetings: [],
  people: [],
  projects: [],
  actions: [],
  pathIds: [],
  narrative: '',
  dateMs: null,
}

function renderInspector(overrides: Partial<React.ComponentProps<typeof NodeInspector>> = {}) {
  const props = {
    nodeId: 'person:jiarabi',
    fallback: null,
    isDark: false,
    onLocate: vi.fn(),
    onOpenEntity: vi.fn(),
    canOpen: (t: { type: string; meetingId?: string; contactId?: string; projectId?: string }) =>
      (t.type === 'meeting' && !!t.meetingId) || (t.type === 'person' && !!t.contactId),
    onFocusEntity: vi.fn(),
    onChanged: vi.fn(),
    onProvenanceLoaded: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(
    <ToastProvider>
      <NodeInspector {...props} />
    </ToastProvider>
  )
  return props
}

beforeEach(() => {
  vi.clearAllMocks()
  nodeDetail.mockResolvedValue({ success: true, data: EXTRACTED })
  provenance.mockResolvedValue({ success: true, data: EMPTY_PROV })
})

describe('NodeInspector — discoverability', () => {
  it('shows a name-only person as an EXTRACTED name with net-new identity facts', async () => {
    renderInspector()
    // Badge distinguishes extracted vs linked.
    expect(await screen.findByText('Extracted name')).toBeInTheDocument()
    // Net-new facts, not a re-print of the label.
    expect(screen.getByText('Meetings')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Seen')).toBeInTheDocument()
    expect(screen.getByText(/not a saved contact yet/i)).toBeInTheDocument()
    // Convert + set-identity affordances are offered for a name-only node.
    expect(screen.getByRole('button', { name: /To contact/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Set identity/i })).toBeInTheDocument()
  })

  it('shows a linked contact with role/org/email + aliases + pronouns', async () => {
    nodeDetail.mockResolvedValue({ success: true, data: LINKED })
    provenance.mockResolvedValue({ success: true, data: EMPTY_PROV })
    renderInspector({ nodeId: 'person:contact_c-yar' })
    expect(await screen.findByText('Linked contact')).toBeInTheDocument()
    expect(screen.getByText('Engineer')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('y@acme.com')).toBeInTheDocument()
    expect(screen.getByText('He/Him')).toBeInTheDocument()
    // Known aliases surfaced.
    expect(screen.getByText('jiarabi')).toBeInTheDocument()
    // A linked contact does NOT offer convert/set-identity.
    expect(screen.queryByRole('button', { name: /To contact/i })).not.toBeInTheDocument()
  })
})

describe('NodeInspector — clickability (source navigation)', () => {
  it('navigates to the meeting when a source line is clicked', async () => {
    provenance.mockResolvedValue({ success: true, data: PROV_WITH_MEETING })
    const props = renderInspector()
    const row = await screen.findByRole('button', { name: /Open Kickoff/i })
    fireEvent.click(row)
    expect(props.onOpenEntity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'meeting', meetingId: 'mtg-1' })
    )
  })
})

describe('NodeInspector — editability (rename as correction)', () => {
  it('wires Rename through contextGraph.rename with the node id + new label', async () => {
    rename.mockResolvedValue({
      success: true,
      data: { outcome: 'renamed', scope: 'graph', nodeId: 'person:yaraví' },
    })
    const props = renderInspector()
    fireEvent.click(await screen.findByRole('button', { name: /^Rename$/i }))
    const input = await screen.findByLabelText('New name')
    fireEvent.change(input, { target: { value: 'Yaraví' } })
    fireEvent.click(screen.getByRole('button', { name: /Save correction/i }))
    await waitFor(() => expect(rename).toHaveBeenCalledWith('person:jiarabi', 'Yaraví'))
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled())
  })
})

describe('NodeInspector — navigability', () => {
  it('Locate calls back with the node so the canvas can center on it', async () => {
    const props = renderInspector()
    fireEvent.click(await screen.findByRole('button', { name: /Locate/i }))
    expect(props.onLocate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'person:jiarabi', type: 'person', label: 'Jiarabi' })
    )
  })
})
