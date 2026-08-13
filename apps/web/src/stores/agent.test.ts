import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AgentChatMessage, SidebarAttachment } from '@lnkpi/shared'
import { JOURNEY_STEP_LABELS } from '@/components/agent/journeyTraceTypes'
import { useAgentStore } from './agent'

type PersistedAgentMessage = AgentChatMessage & { linkedOutputs?: string }

describe('useAgentStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('preserves an attachment snapshot on user messages', () => {
    const store = useAgentStore()
    const attachments: SidebarAttachment[] = [
      {
        id: 'attachment-1',
        mediaType: 'image',
        sourceKind: 'upload',
        label: 'product.png',
        url: 'https://cdn.example.com/product.png',
      },
    ]

    store.addUserMessage('参考这张图生成海报', {
      attachments,
      attachmentRefKeys: ['I1'],
    })
    attachments[0].label = 'changed.png'

    expect(store.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: '参考这张图生成海报',
        attachments: [
          expect.objectContaining({ label: 'product.png' }),
        ],
        attachmentRefKeys: ['I1'],
      }),
    ])
  })

  it('restores persisted attachment snapshots from message history', () => {
    const store = useAgentStore()
    const attachments: SidebarAttachment[] = [
      {
        id: 'attachment-1',
        mediaType: 'image',
        sourceKind: 'canvasNode',
        label: 'canvas output',
        url: 'https://cdn.example.com/output.png',
        sourceNodeId: 'image-1',
      },
    ]

    store.loadHistory([
      {
        id: 'message-1',
        sessionId: 'session-1',
        role: 'user',
        content: '用这张图继续生成',
        attachments: JSON.stringify(attachments),
        createdAt: '2026-08-07T00:00:00.000Z',
      },
    ])

    expect(store.messages).toEqual([
      expect.objectContaining({
        id: 'message-1',
        attachments,
      }),
    ])
  })

  it('restores persisted linkedOutputs from message history', () => {
    const store = useAgentStore()
    const linkedOutputs = [
      {
        nodeId: 'image-1',
        title: '主图',
        nodeType: 'image',
        status: 'done' as const,
      },
    ]

    store.loadHistory([
      {
        id: 'message-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: '已生成主图',
        linkedOutputs: JSON.stringify(linkedOutputs),
        createdAt: '2026-08-07T00:00:00.000Z',
      } satisfies PersistedAgentMessage,
    ])

    expect(store.messages).toEqual([
      expect.objectContaining({
        id: 'message-1',
        role: 'assistant',
        linkedOutputs,
      }),
    ])
  })

  it('replaces existing messages when loading history', () => {
    const store = useAgentStore()
    store.addUserMessage('old message')

    store.loadHistory([
      {
        id: 'message-2',
        sessionId: 'session-1',
        role: 'user',
        content: 'new message',
        createdAt: '2026-08-07T00:00:00.000Z',
      },
    ])

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]).toEqual(
      expect.objectContaining({
        id: 'message-2',
        content: 'new message',
      }),
    )
  })

  it('restores journeyTrace and executionTrace from assistant metadata', () => {
    const store = useAgentStore()
    const journeyTrace = {
      version: 1 as const,
      flowMode: 'product_visual' as const,
      current: 'macro_select' as const,
      startedAt: '2026-08-13T04:00:00Z',
      updatedAt: '2026-08-13T04:00:00Z',
      steps: [
        {
          id: 'macro_select' as const,
          label: JOURNEY_STEP_LABELS.macro_select,
          status: 'running' as const,
        },
      ],
    }

    store.loadHistory([
      {
        id: 'message-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: ' ',
        metadata: JSON.stringify({ journeyTrace }),
        createdAt: '2026-08-07T00:00:00.000Z',
      },
    ])

    expect(store.messages[0]?.journeyTrace).toEqual(journeyTrace)
    expect(store.messages[0]?.executionTrace?.steps.some((step) => step.journeyStepId === 'macro_select')).toBe(true)
  })

  it('applies live journey updates to the latest assistant trace', () => {
    const store = useAgentStore()
    store.startAssistantMessage()
    const snapshot = {
      version: 1 as const,
      flowMode: 'product_visual' as const,
      current: 'generating' as const,
      startedAt: '2026-08-13T04:00:00Z',
      updatedAt: '2026-08-13T04:00:00Z',
      steps: [
        {
          id: 'generating' as const,
          label: JOURNEY_STEP_LABELS.generating,
          status: 'running' as const,
        },
      ],
    }

    store.trackJourneyUpdate(snapshot)

    const last = store.messages[store.messages.length - 1]
    expect(last?.journeyTrace).toEqual(snapshot)
    expect(last?.executionTrace?.steps.some((step) => step.journeyStepId === 'generating')).toBe(true)
  })
})
