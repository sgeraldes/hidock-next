import { describe, expect, it } from 'vitest'
import {
  channelToSourceContainer,
  messageToSourceItems,
  parseMentions,
  renderText,
  tsToIso,
  userToEnrichment,
  userToExternalPerson,
  type MappingContext
} from '../src/entity-mapping.js'
import type { SlackChannel, SlackMessage, SlackUser } from '../src/types.js'

const ctx: MappingContext = {
  connectorId: 'slack:abc',
  userNames: new Map([
    ['U1', 'Alice'],
    ['U2', 'Bob']
  ]),
  fetchAuthorization: 'Bearer tok'
}

describe('parseMentions', () => {
  it('extracts unique user ids from <@U> and <@U|label> forms', () => {
    expect(parseMentions('hey <@U1> and <@U2|bob> and <@U1> again')).toEqual(['U1', 'U2'])
  })
  it('returns [] for text without mentions', () => {
    expect(parseMentions('no mentions here')).toEqual([])
    expect(parseMentions(undefined)).toEqual([])
  })
})

describe('renderText (mrkdwn → markdown)', () => {
  it('resolves user mentions to names, falling back to id', () => {
    expect(renderText('hi <@U1> and <@U9>', ctx.userNames)).toBe('hi @Alice and @U9')
  })
  it('uses the inline label when the id is unknown', () => {
    expect(renderText('yo <@U9|charlie>', ctx.userNames)).toBe('yo @charlie')
  })
  it('unwraps channel refs, links, and special mentions; decodes entities', () => {
    expect(renderText('see <#C1|general>', ctx.userNames)).toBe('see #general')
    expect(renderText('<https://x.io|docs>', ctx.userNames)).toBe('[docs](https://x.io)')
    expect(renderText('<https://x.io>', ctx.userNames)).toBe('https://x.io')
    expect(renderText('ping <!here> now', ctx.userNames)).toBe('ping @here now')
    expect(renderText('a &amp; b &lt;c&gt;', ctx.userNames)).toBe('a & b <c>')
  })
})

describe('messageToSourceItems', () => {
  it('emits a markdown message item with author, mentions, and metadata', () => {
    const msg: SlackMessage = { type: 'message', user: 'U1', text: 'hello <@U2>', ts: '1700000000.000100' }
    const items = messageToSourceItems('C1', msg, ctx)
    expect(items).toHaveLength(1)
    const it0 = items[0]
    expect(it0.kind).toBe('message')
    expect(it0.mime).toBe('text/markdown')
    expect(it0.externalId).toBe('C1:1700000000.000100')
    expect(it0.text).toBe('**Alice:** hello @Bob')
    expect(it0.authorExternalId).toBe('U1')
    expect(it0.mentions).toEqual(['U2'])
    expect(it0.createdAt).toBe(tsToIso('1700000000.000100'))
  })

  it('emits an image item per image attachment, parented to the message', () => {
    const msg: SlackMessage = {
      type: 'message',
      user: 'U1',
      text: '',
      ts: '1700000000.000200',
      files: [
        { id: 'F1', mimetype: 'image/png', url_private_download: 'https://files/F1.png', title: 'shot' },
        { id: 'F2', mimetype: 'application/pdf', url_private: 'https://files/F2.pdf' }
      ]
    }
    const items = messageToSourceItems('C1', msg, ctx)
    // message + one image (pdf skipped — not an image type)
    expect(items.map((i) => i.kind)).toEqual(['message', 'image'])
    const img = items[1]
    expect(img.externalId).toBe('C1:1700000000.000200:file:F1')
    expect(img.url).toBe('https://files/F1.png')
    expect(img.fetchAuthorization).toBe('Bearer tok')
    expect(img.parentExternalId).toBe('C1:1700000000.000200')
    expect(items[0].text).toBe('**Alice:** _(no text)_')
  })

  it('sets parentExternalId for a threaded reply', () => {
    const reply: SlackMessage = { type: 'message', user: 'U2', text: 'reply', ts: '1700000100.000000', thread_ts: '1700000000.000100' }
    const items = messageToSourceItems('C1', reply, ctx, '1700000000.000100')
    expect(items[0].parentExternalId).toBe('C1:1700000000.000100')
  })
})

describe('user mapping', () => {
  const alice: SlackUser = {
    id: 'U1',
    name: 'alice',
    real_name: 'Alice Anderson',
    profile: { display_name: 'Alice', email: 'ALICE@acme.io', title: 'CTO', image_512: 'https://av/512' }
  }

  it('maps to ExternalPerson with best name, email, avatar, title', () => {
    const p = userToExternalPerson(alice)
    expect(p).toMatchObject({ externalId: 'U1', name: 'Alice', email: 'ALICE@acme.io', title: 'CTO', avatarUrl: 'https://av/512' })
  })

  it('enriches with confidence 1.0 when matched by email, 0.5 otherwise', () => {
    expect(userToEnrichment('slack:abc', alice, true)).toMatchObject({ confidence: 1.0, externalId: 'U1', fields: { role: 'CTO' } })
    expect(userToEnrichment('slack:abc', alice, false).confidence).toBe(0.5)
  })
})

describe('channelToSourceContainer', () => {
  it('maps public/private/dm kinds and metadata', () => {
    const ch: SlackChannel = { id: 'C1', name: 'general', is_private: false, is_member: true, num_members: 12, topic: { value: 'chat' } }
    const c = channelToSourceContainer(ch)
    expect(c).toMatchObject({ externalId: 'C1', name: 'general', kind: 'channel' })
    expect(c.metadata).toMatchObject({ isMember: true, numMembers: 12, topic: 'chat' })
    expect(channelToSourceContainer({ id: 'D1', is_im: true } as SlackChannel).kind).toBe('dm')
    expect(channelToSourceContainer({ id: 'G1', is_private: true } as SlackChannel).kind).toBe('private_channel')
  })
})
