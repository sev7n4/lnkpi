import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentService } from './agent.service'
import { AgentRuntimeClient } from './agent-runtime.client'

describe('AgentService dock forwarding', () => {
  const agentMessageCreate = vi.fn()
  const resolveForGeneration = vi.fn()

  let service: AgentService

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.AGENT_RUNTIME_URL = 'http://127.0.0.1:8000'
    agentMessageCreate.mockResolvedValue({})
    resolveForGeneration.mockResolvedValue({
      channelId: 'platform',
      modelName: 'gpt-4o-mini',
      apiFormat: 'openai',
      credentials: { apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1' },
      source: 'platform',
    })

    service = new AgentService(
      {
        agentMessage: {
          create: agentMessageCreate,
          findMany: vi.fn(),
        },
        agentThread: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({}),
        },
        session: {
          findUnique: vi.fn(),
          update: vi.fn(),
        },
        idempotencyRecord: {
          create: vi.fn(),
          findUnique: vi.fn(),
          updateMany: vi.fn(),
          deleteMany: vi.fn(),
        },
      } as never,
      { create: vi.fn() } as never,
      { createFromAgent: vi.fn() } as never,
      { resolveForGeneration } as never,
    )
  })

  it('forwards mapped skillId and resolved model to runtime', async () => {
    const streamRun = vi.fn(async function* () {
      yield { type: 'text_delta', data: { text: 'ok' } }
      yield { type: 'done', data: {} }
    })

    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(true),
      streamRun,
    } as unknown as AgentRuntimeClient)

    for await (const _ of service.streamConversation(
      's1',
      'hello',
      'u1',
      'thread-1',
      undefined,
      undefined,
      'canvas',
      'platform::gpt-4o-mini',
    )) {
      // drain
    }

    expect(resolveForGeneration).toHaveBeenCalledWith('u1', 'platform::gpt-4o-mini', 'text')
    expect(streamRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        threadId: 'thread-1',
        message: 'hello',
        skillId: 'enterprise-marketing-campaign',
        llmModel: 'gpt-4o-mini',
        llmApiKey: 'sk-test',
        llmBaseUrl: 'https://api.example.com/v1',
      }),
    )
  })

  it('skips provider resolution when model is omitted', async () => {
    const streamRun = vi.fn(async function* () {
      yield { type: 'done', data: {} }
    })

    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(true),
      streamRun,
    } as unknown as AgentRuntimeClient)

    for await (const _ of service.streamConversation(
      's1',
      'hello',
      'u1',
      undefined,
      undefined,
      undefined,
      'storyboard',
    )) {
      // drain
    }

    expect(resolveForGeneration).not.toHaveBeenCalled()
    expect(streamRun).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: undefined,
        llmModel: undefined,
        llmApiKey: undefined,
        llmBaseUrl: undefined,
      }),
    )
  })
})
