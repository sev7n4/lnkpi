import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasAgent } from '@lnkpi/agent'
import type { CanvasAction } from '@lnkpi/shared'
import { AgentService, deriveLinkedOutputs } from './agent.service'
import { AgentRuntimeClient } from './agent-runtime.client'

describe('deriveLinkedOutputs', () => {
  it('maps add_node actions to linked outputs', () => {
    const actions: CanvasAction[] = [
      {
        type: 'add_node',
        payload: {
          id: 'image-1',
          nodeType: 'image',
          data: { title: '主视觉海报' },
        },
      },
      {
        type: 'add_node',
        payload: {
          id: 'prompt-1',
          nodeType: 'prompt',
          data: { prompt: '唐朝宰相三视图方案' },
        },
      },
    ]

    expect(deriveLinkedOutputs(actions)).toEqual([
      { nodeId: 'image-1', title: '主视觉海报', nodeType: 'image', status: 'done' },
      { nodeId: 'prompt-1', title: '唐朝宰相三视图方案', nodeType: 'prompt', status: 'done' },
    ])
  })

  it('truncates title to 20 chars and defaults missing fields', () => {
    const actions: CanvasAction[] = [
      {
        type: 'add_node',
        payload: {
          id: 'node-1',
          data: { title: '这是一段非常非常非常非常非常非常非常非常长的标题' },
        },
      },
      {
        type: 'add_node',
        payload: { id: 'node-2' },
      },
    ]

    expect(deriveLinkedOutputs(actions)).toEqual([
      { nodeId: 'node-1', title: '这是一段非常非常非常非常非常非常非常非常', nodeType: 'image', status: 'done' },
      { nodeId: 'node-2', title: '未命名', nodeType: 'image', status: 'done' },
    ])
  })

  it('ignores non-add_node actions and add_node without id', () => {
    const actions: CanvasAction[] = [
      { type: 'update_node', payload: { id: 'x-1', data: { title: 'skip' } } },
      { type: 'add_node', payload: { nodeType: 'image' } },
    ]

    expect(deriveLinkedOutputs(actions)).toEqual([])
  })
})

describe('AgentService streamConversation', () => {
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
    delete process.env.AGENT_RUNTIME_URL

    agentMessageCreate.mockResolvedValue({})
    agentMessageFindMany.mockResolvedValue([
      { role: 'user', content: 'hello' },
    ])
    agentThreadFindUnique.mockResolvedValue(null)
    agentThreadUpsert.mockResolvedValue({})
    agentThreadUpdate.mockResolvedValue({})
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

  it('uses CanvasAgent when AGENT_RUNTIME_URL is unset', async () => {
    const runSpy = vi
      .spyOn(CanvasAgent.prototype, 'run')
      .mockImplementation(async (_messages, onEvent) => {
        onEvent({ type: 'text_delta', data: { text: 'from-canvas-agent' } })
        onEvent({ type: 'done', data: {} })
      })

    const healthSpy = vi.spyOn(AgentRuntimeClient.prototype, 'healthOk')
    const streamSpy = vi.spyOn(AgentRuntimeClient.prototype, 'streamRun')

    const events: Array<{ type: string }> = []
    for await (const event of service.streamConversation('s1', 'hello', 'u1')) {
      events.push(event)
    }

    expect(runSpy).toHaveBeenCalledOnce()
    expect(healthSpy).not.toHaveBeenCalled()
    expect(streamSpy).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === 'text_delta')).toBe(true)
    expect(agentMessageCreate).toHaveBeenCalled()
  })

  it('uses Runtime when AGENT_RUNTIME_URL healthy', async () => {
    process.env.AGENT_RUNTIME_URL = 'http://127.0.0.1:8000'
    const runSpy = vi.spyOn(CanvasAgent.prototype, 'run')
    const streamRun = vi.fn(async function* () {
      yield { type: 'text_delta', data: { text: 'from-runtime' } }
      yield {
        type: 'canvas_action',
        data: {
          type: 'add_node',
          payload: {
            id: 'prompt-1',
            nodeType: 'prompt',
            data: { prompt: '方案' },
            position: { x: 0, y: 0 },
          },
        },
      }
      yield { type: 'done', data: {} }
    })

    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(true),
      streamRun,
    } as unknown as AgentRuntimeClient)

    const events: Array<{ type: string; data?: unknown }> = []
    for await (const event of service.streamConversation(
      's1',
      '营销',
      'u1',
      's1:thread-a',
    )) {
      events.push(event)
    }

    expect(runSpy).not.toHaveBeenCalled()
    expect(streamRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        threadId: 's1:thread-a',
        message: '营销',
      }),
    )
    expect(events.map((e) => e.type)).toEqual([
      'text_delta',
      'canvas_action',
      'done',
    ])
    // Runtime path skips canvasData rewrite (Nest tools already wrote)
    expect(sessionUpdate).not.toHaveBeenCalled()
    expect(agentMessageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: 'assistant',
        linkedOutputs: JSON.stringify([
          {
            nodeId: 'prompt-1',
            title: '方案',
            nodeType: 'prompt',
            status: 'done',
          },
        ]),
      }),
    })
  })

  it('persists linkedOutputs from CanvasAgent add_node actions', async () => {
    vi.spyOn(CanvasAgent.prototype, 'run').mockImplementation(async (_messages, onEvent) => {
      onEvent({ type: 'text_delta', data: { text: 'done' } })
      onEvent({
        type: 'canvas_action',
        data: {
          type: 'add_node',
          payload: {
            id: 'shot-1',
            nodeType: 'shot',
            data: { title: '镜头 A' },
          },
        },
      })
      onEvent({ type: 'done', data: {} })
    })

    for await (const _event of service.streamConversation('s1', 'hello', 'u1', 's1:thread-b')) {
      // drain
    }

    expect(agentMessageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: 'assistant',
        linkedOutputs: JSON.stringify([
          {
            nodeId: 'shot-1',
            title: '镜头 A',
            nodeType: 'shot',
            status: 'done',
          },
        ]),
      }),
    })
  })

  it('forwards validated sidebar attachments to runtime', async () => {
    process.env.AGENT_RUNTIME_URL = 'http://127.0.0.1:8000'
    const streamRun = vi.fn(async function* () {
      yield { type: 'text_delta', data: { text: 'ok' } }
      yield { type: 'done', data: {} }
    })
    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(true),
      streamRun,
    } as unknown as AgentRuntimeClient)

    const attachments = [
      {
        id: 'a1',
        mediaType: 'image' as const,
        sourceKind: 'upload' as const,
        label: 'p.jpg',
        url: 'https://x/a.jpg',
      },
    ]

    for await (const _event of service.streamConversation(
      's1',
      '营销',
      'u1',
      's1:thread-a',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      attachments,
      ['a1'],
    )) {
      // drain
    }

    expect(streamRun).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments,
        refOrder: ['a1'],
      }),
    )
    expect(agentMessageCreate).toHaveBeenCalledWith({
      data: {
        sessionId: 's1',
        threadId: 's1:thread-a',
        role: 'user',
        content: '营销',
        attachments: JSON.stringify(attachments),
      },
    })
  })

  it('falls back to CanvasAgent when Runtime health fails', async () => {
    process.env.AGENT_RUNTIME_URL = 'http://127.0.0.1:8000'
    const runSpy = vi
      .spyOn(CanvasAgent.prototype, 'run')
      .mockImplementation(async (_messages, onEvent) => {
        onEvent({ type: 'text_delta', data: { text: 'fallback' } })
        onEvent({ type: 'done', data: {} })
      })

    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(false),
      streamRun: vi.fn(),
    } as unknown as AgentRuntimeClient)

    const events: Array<{ type: string }> = []
    for await (const event of service.streamConversation('s1', 'hello', 'u1')) {
      events.push(event)
    }

    expect(runSpy).toHaveBeenCalledOnce()
    expect(events.some((e) => e.type === 'text_delta')).toBe(true)
  })
})

describe('AgentService idempotency', () => {
  const idempotencyRecordCreate = vi.fn()
  const idempotencyRecordFindUnique = vi.fn()
  const idempotencyRecordUpdateMany = vi.fn()
  const idempotencyRecordDeleteMany = vi.fn()
  const agentMessageCreate = vi.fn()
  const agentMessageFindMany = vi.fn()
  const agentThreadFindUnique = vi.fn()
  const agentThreadUpsert = vi.fn()
  const agentThreadUpdate = vi.fn()
  const sessionFindUnique = vi.fn()
  const sessionUpdate = vi.fn()

  let service: AgentService

  beforeEach(() => {
    vi.restoreAllMocks()
    delete process.env.AGENT_RUNTIME_URL
    agentMessageCreate.mockResolvedValue({})
    agentMessageFindMany.mockResolvedValue([])
    sessionFindUnique.mockResolvedValue(null)
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
        session: { findUnique: sessionFindUnique, update: sessionUpdate },
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

  it('checkIdempotencyKey returns null for unknown key', async () => {
    idempotencyRecordFindUnique.mockResolvedValue(null)
    const result = await service.checkIdempotencyKey('unknown-key')
    expect(result).toBeNull()
  })

  it('checkIdempotencyKey returns processing for active key', async () => {
    idempotencyRecordFindUnique.mockResolvedValue({
      idempotencyKey: 'ik-test',
      status: 'processing',
      resultSummary: null,
    })
    const result = await service.checkIdempotencyKey('ik-test')
    expect(result).toEqual({ status: 'processing', resultSummary: undefined })
  })

  it('checkIdempotencyKey returns completed for finished key', async () => {
    idempotencyRecordFindUnique.mockResolvedValue({
      idempotencyKey: 'ik-test',
      status: 'completed',
      resultSummary: '方案已确认',
    })
    const result = await service.checkIdempotencyKey('ik-test')
    expect(result).toEqual({ status: 'completed', resultSummary: '方案已确认' })
  })

  it('checkIdempotencyKey lazily cleans expired records', async () => {
    await service.checkIdempotencyKey('any-key')
    expect(idempotencyRecordDeleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    })
  })

  it('registerIdempotencyKey creates record with 5-min TTL', async () => {
    await service.registerIdempotencyKey('ik-123', 's1', 't1')
    expect(idempotencyRecordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: 'ik-123',
        sessionId: 's1',
        threadId: 't1',
        status: 'processing',
      }),
    })
    const call = idempotencyRecordCreate.mock.calls[0][0] as { data: { expiresAt: Date } }
    const ttl = call.data.expiresAt.getTime() - Date.now()
    expect(ttl).toBeGreaterThan(4 * 60 * 1000) // > 4 min
    expect(ttl).toBeLessThanOrEqual(6 * 60 * 1000) // <= 6 min (buffer)
  })

  it('registerIdempotencyKey ignores unique constraint conflict', async () => {
    idempotencyRecordCreate.mockRejectedValue(new Error('Unique constraint failed'))
    // Should not throw
    await expect(service.registerIdempotencyKey('ik-dupe', 's1', 't1')).resolves.toBeUndefined()
  })

  it('completeIdempotencyKey updates status and resultSummary', async () => {
    await service.completeIdempotencyKey('ik-123', '方案已确认，正在拆解画布')
    expect(idempotencyRecordUpdateMany).toHaveBeenCalledWith({
      where: { idempotencyKey: 'ik-123', status: 'processing' },
      data: { status: 'completed', resultSummary: '方案已确认，正在拆解画布' },
    })
  })

  it('completeIdempotencyKey truncates resultSummary to 500 chars', async () => {
    const longText = 'x'.repeat(600)
    await service.completeIdempotencyKey('ik-123', longText)
    const call = idempotencyRecordUpdateMany.mock.calls[0][0] as { data: { resultSummary: string } }
    expect(call.data.resultSummary.length).toBe(500)
  })
})

describe('AgentService checkRuntimeHealth', () => {
  const agentMessageCreate = vi.fn()
  const agentMessageFindMany = vi.fn()
  const sessionFindUnique = vi.fn()
  const sessionUpdate = vi.fn()
  const idempotencyRecordCreate = vi.fn()
  const idempotencyRecordFindUnique = vi.fn()
  const idempotencyRecordUpdateMany = vi.fn()
  const idempotencyRecordDeleteMany = vi.fn()

  let service: AgentService

  beforeEach(() => {
    vi.restoreAllMocks()
    delete process.env.AGENT_RUNTIME_URL

    service = new AgentService(
      {
        agentMessage: { create: agentMessageCreate, findMany: agentMessageFindMany },
        session: { findUnique: sessionFindUnique, update: sessionUpdate },
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

  it('returns ok:false when AGENT_RUNTIME_URL is unset', async () => {
    const result = await service.checkRuntimeHealth()
    expect(result).toEqual({ ok: false })
  })

  it('returns ok:true when runtime is healthy', async () => {
    process.env.AGENT_RUNTIME_URL = 'http://127.0.0.1:8000'
    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(true),
    } as unknown as AgentRuntimeClient)

    const result = await service.checkRuntimeHealth()
    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('returns ok:false when runtime is unreachable', async () => {
    process.env.AGENT_RUNTIME_URL = 'http://127.0.0.1:8000'
    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(false),
    } as unknown as AgentRuntimeClient)

    const result = await service.checkRuntimeHealth()
    expect(result).toEqual({ ok: false })
  })
})
