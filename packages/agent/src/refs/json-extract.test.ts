import { describe, expect, it } from 'vitest'
import { extractJsonObject } from './json-extract'
import { parseVisionQaJson } from './vision-qa-json'

describe('extractJsonObject', () => {
  it('parses fenced JSON', () => {
    const raw = '说明\n```json\n{"pass": true, "reason": "ok"}\n```'
    expect(extractJsonObject(raw)).toEqual({ pass: true, reason: 'ok' })
  })

  it('parses JSON embedded in prose', () => {
    const raw = '分析如下：{"pass": false, "reason": "模糊", "product_summary": "疑似保温杯"} 完毕'
    expect(extractJsonObject(raw)?.product_summary).toBe('疑似保温杯')
  })
})

describe('parseVisionQaJson', () => {
  it('maps product_summary and QA fields', () => {
    const out = parseVisionQaJson(
      JSON.stringify({
        pass: true,
        reason: '清晰白底',
        product_summary: '不锈钢保温杯，圆柱形，银色',
        is_white_bg: true,
        is_sharp_enough: true,
        product_identifiable: true,
      }),
    )
    expect(out.pass).toBe(true)
    expect(out.productSummary).toContain('保温杯')
    expect(out.isWhiteBg).toBe(true)
  })

  it('returns format error when JSON missing', () => {
    const out = parseVisionQaJson('这是 Markdown 方案，不是 JSON')
    expect(out.pass).toBe(false)
    expect(out.reason).toContain('格式异常')
  })
})
