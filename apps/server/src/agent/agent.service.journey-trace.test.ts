import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JourneyTraceSnapshot } from '@lnkpi/shared'
import { JOURNEY_STEP_LABELS } from '@lnkpi/shared'
import { AgentService } from './agent.service'
import { AgentRuntimeClient } from './agent-runtime.client'

const JOURNEY_STEP_ORDER = [
  'image_qa',
  'scheme_draft',
  'macro_select',
  'ssot_persist',
  'shot_plan',
  'topo_preview',
  'generating',
  'delivery',
  'done',
] as const

function buildMockJourneySnapshot(current: (typeof JOURNEY_STEP_ORDER)[number] = 'macro_select'): JourneyTraceSnapshot {
  const now = '2026-08-13T04:00:00Z'
  return {
    version: 1,
    flowMode: 'product_visual',
    current,
    startedAt: now,
    updatedAt: now,
    steps: JOURNEY_STEP_ORDER.map((id) => ({
      id,
      label: JOURNEY_STEP_LABELS[id],
      status: id === current ? 'running' : JOURNEY_STEP_ORDER.indexOf(id) < JOURNEY_STEP_ORDER.indexOf(current) ? 'done' : 'pending',
    })),
  }
}

describe('AgentService journey trace persistence', () => {
  const agentMessageCreate = vi.fn()
  const agentMessageFindMany = vi.fn()
  const agentThreadFindUnique = vi.fn()
  const agentThreadUpsert = vi.fn()
  const agentThreadUpdate = vi.fn()
  const sessionFindUnique = vi.fn()
  const sessionUpdate = vi.fn()
  const idempotencyRecordCreate = vi.fn()
  const idempotencyRecordFindUnique = vi.fn()
  const idempotencyRecordUpdateMany = vi.fn()
  const idempotencyRecordDeleteMany = vi.fn()

  let service: AgentService

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.AGENT_RUNTIME_URL = 'http://127.0.0.1:8000'

    agentMessageCreate.mockResolvedValue({})
    agentMessageFindMany.mockResolvedValue([])
    agentThreadFindUnique.mockResolvedValue({ id: 's1:thread-a' })
    agentThreadUpdate.mockResolvedValue({})
    agentThreadUpsert.mockResolvedValue({})
    sessionFindUnique.mockResolvedValue({ id: 's1', canvasData: null })
    sessionUpdate.mockResolvedValue({})
    idempotencyRecordCreate.mockResolvedValue({})
    idempotencyRecordFindUnique.mockResolvedValue(null)
    idempotencyRecordUpdateMany.mockResolvedValue({ count: 1 })
    idempotencyRecordDeleteMany.mockResolvedValue({ count: 0 })

    service = new AgentService(
      {
        agentMessage: {
          create: agentMessageCreate,
          findMany: agentMessageFindMany,
        },
        agentThread: {
          findUnique: agentThreadFindUnique,
          upsert: agentThreadUpsert,
          update: agentThreadUpdate,
        },
        session: {
          findUnique: sessionFindUnique,
          update: sessionUpdate,
        },
        idempotencyRecord: {
          create: idempotencyRecordCreate,
          findUnique: idempotencyRecordFindUnique,
          updateMany: idempotencyRecordUpdateMany,
          deleteMany: idempotencyRecordDeleteMany,
        },
      } as never,
      { create: vi.fn() } as never,
      { createFromAgent: vi.fn() } as never,
      { resolveForGeneration: vi.fn() } as never,
    )
  })

  it('persists journeyTrace in assistant message metadata on finalizeTurn', async () => {
    const snapshot = buildMockJourneySnapshot()
    const streamRun = vi.fn(async function* () {
      yield { type: 'journey_update', data: { snapshot } }
      yield { type: 'text_delta', data: { text: '方案已生成' } }
      yield { type: 'done', data: {} }
    })

    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(true),
      streamRun,
    } as unknown as AgentRuntimeClient)

    for await (const _event of service.streamConversation('s1', '营销', 'u1', 's1:thread-a')) {
      // drain
    }

    const assistantCreate = agentMessageCreate.mock.calls.find(
      (call) => (call[0] as { data: { role: string } }).data.role === 'assistant',
    )
    expect(assistantCreate).toBeDefined()

    const metadataRaw = (assistantCreate![0] as { data: { metadata?: string } }).data.metadata
    expect(metadataRaw).toBeTruthy()
    const metadata = JSON.parse(metadataRaw!) as { journeyTrace?: JourneyTraceSnapshot }
    expect(metadata.journeyTrace?.steps).toHaveLength(9)
    expect(metadata.journeyTrace?.flowMode).toBe('product_visual')
  })

  it('creates placeholder assistant message when text empty but journeyTrace exists', async () => {
    const snapshot = buildMockJourneySnapshot('image_qa')
    const streamRun = vi.fn(async function* () {
      yield { type: 'journey_update', data: { snapshot } }
      yield { type: 'done', data: {} }
    })

    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(true),
      streamRun,
    } as unknown as AgentRuntimeClient)

    for await (const _event of service.streamConversation('s1', '营销', 'u1', 's1:thread-a')) {
      // drain
    }

    const assistantCreate = agentMessageCreate.mock.calls.find(
      (call) => (call[0] as { data: { role: string } }).data.role === 'assistant',
    )
    expect(assistantCreate).toBeDefined()
    expect((assistantCreate![0] as { data: { content: string } }).data.content).toBe(' ')
  })

  it('uses last journey_update snapshot when multiple events arrive', async () => {
    const first = buildMockJourneySnapshot('image_qa')
    const last = buildMockJourneySnapshot('generating')
    const streamRun = vi.fn(async function* () {
      yield { type: 'journey_update', data: { snapshot: first } }
      yield { type: 'journey_update', data: { snapshot: last } }
      yield { type: 'done', data: {} }
    })

    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(true),
      streamRun,
    } as unknown as AgentRuntimeClient)

    for await (const _event of service.streamConversation('s1', '营销', 'u1', 's1:thread-a')) {
      // drain
    }

    const assistantCreate = agentMessageCreate.mock.calls.find(
      (call) => (call[0] as { data: { role: string } }).data.role === 'assistant',
    )
    const metadata = JSON.parse(
      (assistantCreate![0] as { data: { metadata: string } }).data.metadata,
    ) as { journeyTrace?: JourneyTraceSnapshot }
    expect(metadata.journeyTrace?.current).toBe('generating')
  })
})
