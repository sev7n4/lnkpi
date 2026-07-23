import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRuntimeClient } from './agent-runtime.client'

describe('AgentRuntimeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: stream,
      }),
    )

    const client = new AgentRuntimeClient('http://runtime.test')
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
  })
})
