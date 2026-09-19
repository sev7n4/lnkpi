import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateVisionQaJson, parseVisionQaJson } from './vision-qa-json'

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

  it('does not retry on empty content even when maxRetries is 2 (format error)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '   ' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateVisionQaJson('sys', 'user', ['https://example.com/a.jpg'], {
        apiKey: 'k',
        model: 'gpt-4o',
        maxRetries: 2,
      }),
    ).rejects.toThrow(/空内容/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry on 500 (D-RETRY: 5xx hard fail)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'err' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateVisionQaJson('sys', 'user', ['https://example.com/a.jpg'], {
        apiKey: 'k',
        model: 'gpt-4o',
        maxRetries: 2,
      }),
    ).rejects.toThrow(/Vision API 500/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries on 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limit' })
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

  it('retries on timeout then succeeds', async () => {
    const timeoutErr = new Error('request timeout')
    timeoutErr.name = 'TimeoutError'
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeoutErr)
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

  it('decodes channel-prefixed Flash before posting model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"pass":true,"reason":"ok","product_summary":"桶"}' } }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await generateVisionQaJson('sys', 'user', ['https://example.com/a.jpg'], {
      apiKey: 'k',
      model: 'ch_x::deepseek-flash',
    })
    expect(result.visionUsed).toBe(true)
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.model).toBe('deepseek-flash')
  })
})

describe('parseVisionQaJson', () => {
  it('parses sidebar parse fields from QA json', () => {
    const parsed = parseVisionQaJson(
      JSON.stringify({
        pass: true,
        reason: '清晰白底',
        product_summary: '不锈钢水杯',
        user_facing_summary: '一只带提手的不锈钢水杯',
        category: '水杯',
        appearance: '银白圆柱，塑料提手',
        material_hint: '不锈钢',
        text_in_image: '',
        unknown: ['price_band', 'platform'],
        is_white_bg: true,
        is_sharp_enough: true,
        product_identifiable: true,
      }),
    )
    expect(parsed.userFacingSummary).toBe('一只带提手的不锈钢水杯')
    expect(parsed.category).toBe('水杯')
    expect(parsed.appearance).toBe('银白圆柱，塑料提手')
    expect(parsed.materialHint).toBe('不锈钢')
    expect(parsed.unknown).toEqual(['price_band', 'platform'])
    expect(parsed.isWhiteBg).toBe(true)
  })

  it('falls back userFacingSummary to productSummary when empty', () => {
    const parsed = parseVisionQaJson(
      JSON.stringify({
        pass: true,
        reason: 'ok',
        product_summary: '不锈钢水杯',
        user_facing_summary: '  ',
      }),
    )
    expect(parsed.userFacingSummary).toBe('不锈钢水杯')
  })

  it('keeps unknown only when it is a string array', () => {
    const parsed = parseVisionQaJson(
      JSON.stringify({
        pass: true,
        reason: 'ok',
        unknown: [1, 'price_band'],
      }),
    )
    expect(parsed.unknown).toBeUndefined()
  })
})
