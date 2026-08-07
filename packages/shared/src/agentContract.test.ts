import { describe, expect, it } from 'vitest'
import { AgentConversationRequestSchema } from './agentContract'

describe('AgentConversationRequestSchema mentionedKeys', () => {
  it('accepts valid mentionedKeys', () => {
    const parsed = AgentConversationRequestSchema.parse({
      sessionId: 's1',
      message: '@I1 风格',
      mentionedKeys: ['I1', 'T2'],
    })
    expect(parsed.mentionedKeys).toEqual(['I1', 'T2'])
  })

  it('rejects invalid ref key format', () => {
    expect(() =>
      AgentConversationRequestSchema.parse({
        sessionId: 's1',
        message: 'x',
        mentionedKeys: ['image1'],
      }),
    ).toThrow()
  })
})
