import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRuntimeClient } from './agent-runtime.client'

describe('AgentRuntimeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.AGENT_RUNTIME_SERVICE_TOKEN
  })

  it('healthOk returns true when /health ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, service: 'agent-runtime' }),
      }),
    )
    const client = new AgentRuntimeClient('http://127.0.0.1:8000')
    await expect(client.healthOk()).resolves.toBe(true)
  })

  it('healthOk returns false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const client = new AgentRuntimeClient('http://127.0.0.1:8000')
    await expect(client.healthOk()).resolves.toBe(false)
  })

  it('streamRun parses NDJSON events', async () => {
    const payload =
      JSON.stringify({ type: 'text_delta', data: { text: 'hi' } }) +
      '\n' +
      JSON.stringify({ type: 'done', data: {} }) +
      '\n'

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload))
        controller.close()
      },
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new AgentRuntimeClient('http://runtime.test', 'dev-token')
    const events = []
    for await (const event of client.streamRun({
      sessionId: 's1',
      userId: 'u1',
      message: 'hello',
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'text_delta', data: { text: 'hi' } },
      { type: 'done', data: {} },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://runtime.test/v1/runs',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-lnkpi-service-token': 'dev-token',
        }),
      }),
    )
  })

  it('streamRun emits error event for bad NDJSON lines without killing stream', async () => {
    const payload =
      JSON.stringify({ type: 'text_delta', data: { text: 'ok' } }) +
      '\n' +
      '{not-json\n' +
      JSON.stringify({ type: 'done', data: {} }) +
      '\n'

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload))
        controller.close()
      },
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: stream,
      }),
    )

    const client = new AgentRuntimeClient('http://runtime.test', 'tok')
    const events = []
    for await (const event of client.streamRun({
      sessionId: 's1',
      userId: 'u1',
      message: 'hello',
    })) {
      events.push(event)
    }

    expect(events[0]).toEqual({ type: 'text_delta', data: { text: 'ok' } })
    expect(events[1]?.type).toBe('error')
    expect(events[2]).toEqual({ type: 'done', data: {} })
  })
})
