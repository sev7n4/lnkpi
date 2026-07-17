import { describe, it, expect, vi, afterEach } from 'vitest'
import { mergeRefsToPrompt } from './merge-refs'

describe('mergeRefsToPrompt skip', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY
  })

  it('returns localPrompt only when no sources', async () => {
    const result = await mergeRefsToPrompt({
      sources: [],
      localPrompt: 'hello',
      downstreamType: 'text',
    })
    expect(result).toEqual({ mergedText: 'hello', skippedMerge: true })
  })

  it('returns single ref text when no localPrompt', async () => {
    const result = await mergeRefsToPrompt({
      sources: [{ refKey: 'T1', label: '剧本', text: 'content' }],
      downstreamType: 'image',
    })
    expect(result).toEqual({ mergedText: 'content', skippedMerge: true })
  })

  it('skips merge when only whitespace localPrompt', async () => {
    const result = await mergeRefsToPrompt({
      sources: [{ refKey: 'T1', label: '剧本', text: 'only' }],
      localPrompt: '   ',
      downstreamType: 'text',
    })
    expect(result).toEqual({ mergedText: 'only', skippedMerge: true })
  })
})

describe('mergeRefsToPrompt fallback concat', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY
  })

  it('concatenates with refKey labels when no apiKey', async () => {
    const result = await mergeRefsToPrompt({
      sources: [{ refKey: 'T1', label: '剧本', text: 'A' }],
      localPrompt: 'B',
      downstreamType: 'text',
    })
    expect(result.skippedMerge).toBe(false)
    expect(result.mergedText).toContain('【T1·剧本】')
    expect(result.mergedText).toContain('A')
    expect(result.mergedText).toContain('【local·本节点】')
    expect(result.mergedText).toContain('B')
  })
})

describe('mergeRefsToPrompt LLM merge', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENAI_API_KEY
  })

  it('calls chat API when apiKey provided and multiple sources', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'merged result' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await mergeRefsToPrompt({
      sources: [{ refKey: 'T1', label: 'L1', text: 'A' }],
      localPrompt: 'B',
      downstreamType: 'video',
      apiKey: 'test-key',
    })

    expect(result).toEqual({ mergedText: 'merged result', skippedMerge: false })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { temperature: number; messages: unknown[] }
    expect(body.temperature).toBe(0.3)
    expect(body.messages.length).toBeGreaterThanOrEqual(2)
  })

  it('throws when API returns !ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }))
    await expect(
      mergeRefsToPrompt({
        sources: [
          { refKey: 'T1', label: 'A', text: 'one' },
          { refKey: 'T2', label: 'B', text: 'two' },
        ],
        downstreamType: 'text',
        apiKey: 'test-key',
      }),
    ).rejects.toThrow(/LLM 请求失败/)
  })
})
