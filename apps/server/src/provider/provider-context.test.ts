import { describe, expect, it, vi } from 'vitest'
import { buildTextProviderContext, providerContextFromResolved } from './provider-context'

describe('buildTextProviderContext', () => {
  it('buildTextProviderContext keeps providerRef and source=user for BYOK', async () => {
    const resolver = {
      resolveForGeneration: vi.fn().mockResolvedValue({
        channelId: 'ch_byok',
        modelName: 'deepseek-flash',
        apiFormat: 'openai',
        credentials: { apiKey: 'sk-byok', baseUrl: 'https://byok.example/v1' },
        source: 'user',
      }),
    }
    const ctx = await buildTextProviderContext(resolver as never, 'u1', 'ch_byok::deepseek-flash')
    expect(ctx).toEqual({
      providerRef: 'ch_byok::deepseek-flash',
      model: 'deepseek-flash',
      apiKey: 'sk-byok',
      baseUrl: 'https://byok.example/v1',
      source: 'user',
    })
  })

  it('rejects empty apiKey or baseUrl after resolve', async () => {
    const resolver = {
      resolveForGeneration: vi.fn().mockResolvedValue({
        channelId: 'platform',
        modelName: 'x',
        apiFormat: 'openai',
        credentials: { apiKey: undefined, baseUrl: '' },
        source: 'platform',
      }),
    }
    await expect(
      buildTextProviderContext(resolver as never, 'u1', 'platform::x'),
    ).rejects.toThrow(/apiKey|baseUrl|incomplete/i)
  })

  it('AC-8: same providerRef yields same source and baseUrl via shared helper', async () => {
    const resolved = {
      channelId: 'ch_byok',
      modelName: 'deepseek-flash',
      apiFormat: 'openai' as const,
      credentials: { apiKey: 'sk-byok', baseUrl: 'https://byok.example/v1' },
      source: 'user' as const,
    }
    const resolver = {
      resolveForGeneration: vi.fn().mockResolvedValue(resolved),
    }
    // Agent 启 run path
    const agentCtx = await buildTextProviderContext(
      resolver as never,
      'u1',
      'ch_byok::deepseek-flash',
    )
    // Canvas / studio text path (same resolve result → same helper)
    const canvasCtx = providerContextFromResolved('ch_byok::deepseek-flash', resolved)
    expect(canvasCtx.source).toBe(agentCtx.source)
    expect(canvasCtx.baseUrl).toBe(agentCtx.baseUrl)
    expect(canvasCtx.providerRef).toBe(agentCtx.providerRef)
    expect(canvasCtx.apiKey).toBe(agentCtx.apiKey)
  })
})
