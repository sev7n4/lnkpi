import { describe, expect, it } from 'vitest'
import {
  classifyRefSize,
  evaluateMediaRefPreflight,
  maxEdge,
  VIDEO_REF_ERROR_BYTES,
  VIDEO_REF_ERROR_MAX_EDGE,
  VIDEO_REF_WARN_BYTES,
  VIDEO_REF_WARN_MAX_EDGE,
} from './mediaInfo'

describe('maxEdge', () => {
  it('returns the longer side', () => {
    expect(maxEdge(3072, 4096)).toBe(4096)
    expect(maxEdge(1024, 1024)).toBe(1024)
  })

  it('treats missing dimensions as zero', () => {
    expect(maxEdge(undefined, 800)).toBe(800)
    expect(maxEdge()).toBe(0)
  })
})

describe('classifyRefSize', () => {
  it('errors on 3072x4096 13MB poster (prod case)', () => {
    expect(classifyRefSize({ width: 3072, height: 4096, bytes: 13_367_984 })).toBe('error')
  })
  it('warns on 1024x1024 6MB', () => {
    expect(classifyRefSize({ width: 1024, height: 1024, bytes: 6 * 1024 * 1024 })).toBe('warn')
  })
  it('none on 1024x1024 1MB', () => {
    expect(classifyRefSize({ width: 1024, height: 1024, bytes: 1_000_000 })).toBe('none')
  })

  it('errors when max edge exceeds error threshold', () => {
    expect(
      classifyRefSize({
        width: VIDEO_REF_ERROR_MAX_EDGE + 1,
        height: 1000,
        bytes: 1_000_000,
      }),
    ).toBe('error')
  })

  it('warns when max edge exceeds warn threshold only', () => {
    expect(
      classifyRefSize({
        width: VIDEO_REF_WARN_MAX_EDGE + 1,
        height: 1000,
        bytes: 1_000_000,
      }),
    ).toBe('warn')
  })

  it('errors when bytes exceed error threshold only', () => {
    expect(
      classifyRefSize({
        width: 1024,
        height: 1024,
        bytes: VIDEO_REF_ERROR_BYTES + 1,
      }),
    ).toBe('error')
  })

  it('warns when bytes exceed warn threshold only', () => {
    expect(
      classifyRefSize({
        width: 1024,
        height: 1024,
        bytes: VIDEO_REF_WARN_BYTES + 1,
      }),
    ).toBe('warn')
  })

  it('none at exact warn thresholds', () => {
    expect(
      classifyRefSize({
        width: VIDEO_REF_WARN_MAX_EDGE,
        height: 1000,
        bytes: VIDEO_REF_WARN_BYTES,
      }),
    ).toBe('none')
  })
})

describe('evaluateMediaRefPreflight', () => {
  it('returns error level when any ref exceeds error threshold', () => {
    const r = evaluateMediaRefPreflight([
      { url: 'a', refKey: 'I1', width: 1024, height: 1024, bytes: 900_000, probeStatus: 'ok' },
      {
        url: 'b',
        refKey: 'I3',
        width: 3072,
        height: 4096,
        bytes: VIDEO_REF_ERROR_BYTES + 1,
        probeStatus: 'ok',
      },
    ])
    expect(r.level).toBe('error')
    expect(r.message).toMatch(/I3/)
  })

  it('returns none when all refs are within limits', () => {
    const r = evaluateMediaRefPreflight([
      { url: 'a', refKey: 'I1', width: 1024, height: 1024, bytes: 900_000, probeStatus: 'ok' },
    ])
    expect(r.level).toBe('none')
    expect(r.message).toBe('')
    expect(r.refs).toHaveLength(1)
    expect(r.refs[0].level).toBe('none')
  })

  it('returns warn when only warn thresholds are exceeded', () => {
    const r = evaluateMediaRefPreflight([
      {
        url: 'a',
        refKey: 'I2',
        width: 1024,
        height: 1024,
        bytes: VIDEO_REF_WARN_BYTES + 1,
        probeStatus: 'ok',
      },
    ])
    expect(r.level).toBe('warn')
    expect(r.message).toMatch(/I2/)
  })

  it('uses agnes_keyframes message when blockWire is set', () => {
    const r = evaluateMediaRefPreflight(
      [
        {
          url: 'b',
          refKey: 'I3',
          width: 3072,
          height: 4096,
          bytes: VIDEO_REF_ERROR_BYTES + 1,
          probeStatus: 'ok',
        },
      ],
      { blockWire: 'agnes_keyframes' },
    )
    expect(r.message).toMatch(/Agnes/)
    expect(r.message).toMatch(/I3/)
  })

  it('marks probe failures as error', () => {
    const r = evaluateMediaRefPreflight([
      {
        url: 'bad',
        refKey: 'I4',
        probeStatus: 'failed',
        probeError: 'timeout',
      },
    ])
    expect(r.level).toBe('error')
    expect(r.code).toBe('ref_probe_failed')
    expect(r.message).toMatch(/I4/)
  })
})
