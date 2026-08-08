import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentService } from './agent.service'
import { AgentRuntimeClient } from './agent-runtime.client'

function makeMessages(sessionId: string, threadId: string, count: number) {
  const base = new Date('2026-01-01T00:00:00Z')
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i + 1}`,
    sessionId,
    threadId,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `msg-${i + 1}`,
    createdAt: new Date(base.getTime() + i * 1000),
  }))
}

describe('AgentService messages & threads', () => {
  const agentMessageFindMany = vi.fn()
  const agentMessageCreate = vi.fn()
  const agentThreadFindMany = vi.fn()
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
          findMany: agentThreadFindMany,
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

  it('getMessages rejects missing threadId before querying prisma', async () => {
    await expect(service.getMessages('s1', '')).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.getMessages('s1', '   ')).rejects.toBeInstanceOf(BadRequestException)
    expect(agentMessageFindMany).not.toHaveBeenCalled()
  })

  it('listThreads rejects missing sessionId before querying prisma', async () => {
    await expect(service.listThreads('')).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.listThreads('   ')).rejects.toBeInstanceOf(BadRequestException)
    expect(agentThreadFindMany).not.toHaveBeenCalled()
  })

  it('returns latest messages for thread in asc order', async () => {
    const all = makeMessages('s1', 's1:abc', 120)
    agentMessageFindMany.mockImplementation(async (args: {
      where: { sessionId: string; threadId: string }
      orderBy: { createdAt: 'asc' | 'desc' }
      take: number
    }) => {
      const filtered = all.filter(
        (m) => m.sessionId === args.where.sessionId && m.threadId === args.where.threadId,
      )
      const desc = [...filtered].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return desc.slice(0, args.take)
    })

    const rows = await service.getMessages('s1', 's1:abc', 100)

    expect(agentMessageFindMany).toHaveBeenCalledWith({
      where: { sessionId: 's1', threadId: 's1:abc' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    expect(rows).toHaveLength(100)
    expect(rows[0].content).toBe('msg-21')
    expect(rows[99].content).toBe('msg-120')
  })

  it('listThreads orders by updatedAt desc and takes 50', async () => {
    const threads = [
      { id: 's1:a', sessionId: 's1', title: 'A', updatedAt: new Date('2026-01-03') },
      { id: 's1:b', sessionId: 's1', title: 'B', updatedAt: new Date('2026-01-02') },
    ]
    agentThreadFindMany.mockResolvedValue(threads)

    const rows = await service.listThreads('s1')

    expect(agentThreadFindMany).toHaveBeenCalledWith({
      where: { sessionId: 's1' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })
    expect(rows).toEqual(threads)
  })

  it('upsertAgentThread slices title to 40 chars and defaults empty to 新对话', async () => {
    const longTitle = '这是一段非常非常非常非常非常非常非常非常非常非常长的首条用户消息'
    agentThreadUpsert.mockResolvedValue({ id: 's1:t1', title: longTitle.slice(0, 40) })

    await service.upsertAgentThread({ id: 's1:t1', sessionId: 's1', title: longTitle })

    expect(agentThreadUpsert).toHaveBeenCalledWith({
      where: { id: 's1:t1' },
      create: { id: 's1:t1', sessionId: 's1', title: longTitle.slice(0, 40) },
      update: { title: longTitle.slice(0, 40), updatedAt: expect.any(Date) },
    })

    await service.upsertAgentThread({ id: 's1:t2', sessionId: 's1', title: '   ' })
    expect(agentThreadUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ title: '新对话' }),
        update: expect.objectContaining({ title: '新对话' }),
      }),
    )
  })

  it('streamConversation upserts thread and passes threadId on first user message', async () => {
    process.env.AGENT_RUNTIME_URL = 'http://127.0.0.1:8000'
    agentMessageFindMany.mockResolvedValue([])
    agentThreadFindUnique.mockResolvedValue(null)

    const streamRun = vi.fn(async function* () {
      yield { type: 'text_delta', data: { text: 'hi' } }
      yield { type: 'done', data: {} }
    })
    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(true),
      streamRun,
    } as unknown as AgentRuntimeClient)

    for await (const _event of service.streamConversation(
      's1',
      '帮我生成唐朝宰相三视图',
      'u1',
      's1:new-thread',
    )) {
      // drain
    }

    expect(agentThreadFindUnique).toHaveBeenCalledWith({
      where: { id: 's1:new-thread' },
      select: { id: true },
    })
    expect(agentThreadUpsert).toHaveBeenCalledWith({
      where: { id: 's1:new-thread' },
      create: {
        id: 's1:new-thread',
        sessionId: 's1',
        title: '帮我生成唐朝宰相三视图',
      },
      update: {
        title: '帮我生成唐朝宰相三视图',
        updatedAt: expect.any(Date),
      },
    })
    expect(agentMessageCreate).toHaveBeenCalledWith({
      data: {
        sessionId: 's1',
        threadId: 's1:new-thread',
        role: 'user',
        content: '帮我生成唐朝宰相三视图',
      },
    })
    expect(streamRun).toHaveBeenCalled()
  })

  it('streamConversation touches thread updatedAt when thread already exists', async () => {
    process.env.AGENT_RUNTIME_URL = 'http://127.0.0.1:8000'
    agentMessageFindMany.mockResolvedValue([])
    agentThreadFindUnique.mockResolvedValue({ id: 's1:existing' })

    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(true),
      streamRun: vi.fn(async function* () {
        yield { type: 'done', data: {} }
      }),
    } as unknown as AgentRuntimeClient)

    for await (const _event of service.streamConversation(
      's1',
      'follow up',
      'u1',
      's1:existing',
    )) {
      // drain
    }

    expect(agentThreadUpsert).not.toHaveBeenCalled()
    expect(agentThreadUpdate).toHaveBeenCalledWith({
      where: { id: 's1:existing' },
      data: { updatedAt: expect.any(Date) },
    })
  })
})
