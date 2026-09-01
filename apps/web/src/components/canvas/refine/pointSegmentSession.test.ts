import { describe, expect, it, vi } from 'vitest'
import {
  createPointSegmentSession,
  resetPointSegmentSession,
  resolvePointMaskRgba,
} from './pointSegmentSession'

const rgba = () => new Uint8ClampedArray([1, 2, 3, 255])

describe('resolvePointMaskRgba', () => {
  it('uses remote when healthy', async () => {
    const session = createPointSegmentSession()
    const remoteSegment = vi.fn(async () => ({ maskUrl: 'https://m' }))
    const loadRemoteRgba = vi.fn(async () => rgba())
    const localSegment = vi.fn(async () => rgba())
    const out = await resolvePointMaskRgba({
      session,
      remoteSegment,
      loadRemoteRgba,
      localSegment,
    })
    expect([...out]).toEqual([1, 2, 3, 255])
    expect(localSegment).not.toHaveBeenCalled()
    expect(session.preferLocal).toBe(false)
  })

  it('falls back once and sticks to local', async () => {
    const session = createPointSegmentSession()
    const toast = vi.fn()
    const remoteSegment = vi.fn(async () => {
      throw { response: { status: 502 } }
    })
    const loadRemoteRgba = vi.fn()
    const localSegment = vi.fn(async () => rgba())

    await resolvePointMaskRgba({
      session,
      remoteSegment,
      loadRemoteRgba,
      localSegment,
      onFallbackToast: toast,
    })
    expect(toast).toHaveBeenCalledTimes(1)
    expect(session.preferLocal).toBe(true)

    remoteSegment.mockClear()
    localSegment.mockClear()
    toast.mockClear()

    await resolvePointMaskRgba({
      session,
      remoteSegment,
      loadRemoteRgba,
      localSegment,
      onFallbackToast: toast,
    })
    expect(remoteSegment).not.toHaveBeenCalled()
    expect(localSegment).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalled()
  })

  it('does not fallback on 429', async () => {
    const session = createPointSegmentSession()
    const localSegment = vi.fn(async () => rgba())
    await expect(
      resolvePointMaskRgba({
        session,
        remoteSegment: async () => {
          throw { response: { status: 429, data: { message: '点选过于频繁，请稍后再试' } } }
        },
        loadRemoteRgba: async () => rgba(),
        localSegment,
      }),
    ).rejects.toMatchObject({ response: { status: 429 } })
    expect(localSegment).not.toHaveBeenCalled()
  })

  it('reset clears stickiness', () => {
    const session = createPointSegmentSession()
    session.preferLocal = true
    session.fallbackToastShown = true
    resetPointSegmentSession(session)
    expect(session).toEqual({ preferLocal: false, fallbackToastShown: false })
  })
})
