import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateVisionQaJson } from './vision-qa-json'

describe('generateVisionQaJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENAI_API_KEY
  })

  it('uses QA system prompt and json_object response_format', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"pass":true,"reason":"ok","product_summary":"礼盒"}' } }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateVisionQaJson(
      '你是审核员，只输出 JSON',
      '用户上传 1 张图',
      ['https://example.com/p.jpg'],
      { apiKey: 'k', model: 'gemini-3.5-flash-lite' },
    )

    expect(result.visionUsed).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.temperature).toBe(0)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toBe('你是审核员，只输出 JSON')
    expect(body.messages[1].content[0]).toEqual({ type: 'text', text: '用户上传 1 张图' })
  })

  it('retries on 500 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"pass":true,"reason":"ok","product_summary":"x"}' } }],
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateVisionQaJson('sys', 'user', ['https://example.com/a.jpg'], {
      apiKey: 'k',
      model: 'gpt-4o',
      maxRetries: 2,
    })
    expect(result.visionUsed).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
