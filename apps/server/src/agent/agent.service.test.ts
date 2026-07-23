import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasAgent } from '@lnkpi/agent'
import { AgentService } from './agent.service'
import { AgentRuntimeClient } from './agent-runtime.client'

describe('AgentService streamConversation', () => {
  const agentMessageCreate = vi.fn()
  const agentMessageFindMany = vi.fn()
  const sessionFindUnique = vi.fn()
  const sessionUpdate = vi.fn()

  let service: AgentService

  beforeEach(() => {
    vi.restoreAllMocks()
    delete process.env.AGENT_RUNTIME_URL

    agentMessageCreate.mockResolvedValue({})
    agentMessageFindMany.mockResolvedValue([
      { role: 'user', content: 'hello' },
    ])
    sessionFindUnique.mockResolvedValue({ id: 's1', canvasData: null })
    sessionUpdate.mockResolvedValue({})

    service = new AgentService(
      {
        agentMessage: {
          create: agentMessageCreate,
          findMany: agentMessageFindMany,
        },
        session: {
          findUnique: sessionFindUnique,
          update: sessionUpdate,
        },
      } as never,
      { create: vi.fn() } as never,
      { createFromAgent: vi.fn() } as never,
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

    vi.spyOn(service, 'createRuntimeClient').mockReturnValue({
      healthOk: vi.fn().mockResolvedValue(true),
      streamRun: async function* () {
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
      },
    } as unknown as AgentRuntimeClient)

    const events: Array<{ type: string; data?: unknown }> = []
    for await (const event of service.streamConversation('s1', '营销', 'u1')) {
      events.push(event)
    }

    expect(runSpy).not.toHaveBeenCalled()
    expect(events.map((e) => e.type)).toEqual([
      'text_delta',
      'canvas_action',
      'done',
    ])
    // Runtime path skips canvasData rewrite (Nest tools already wrote)
    expect(sessionUpdate).not.toHaveBeenCalled()
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
