import { describe, expect, it, vi } from 'vitest'
import {
  confidenceMaskToRgba,
  resetMediaPipeSegmentSession,
  segmentPointLocal,
} from './mediapipeSegment'

describe('confidenceMaskToRgba', () => {
  it('thresholds confidence into alpha mask', () => {
    const out = confidenceMaskToRgba([0.1, 0.9], 2, 1, 0.5)
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...out.slice(4, 8)]).toEqual([255, 255, 255, 255])
  })
})

describe('segmentPointLocal', () => {
  it('uses injected segmenter and caches setImage per imageKey', async () => {
    await resetMediaPipeSegmentSession()
    const setImage = vi.fn()
    const getAsFloat32Array = vi.fn(() => new Float32Array([0, 1, 0, 1]))
    const segment = vi.fn(() => ({ getAsFloat32Array }))
    const loadSegmenter = vi.fn(async () => ({ setImage, segment }))

    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2

    const a = await segmentPointLocal({
      image: canvas,
      imageKey: 'img-a',
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      deps: { loadSegmenter },
    })
    expect(loadSegmenter).toHaveBeenCalledTimes(1)
    expect(setImage).toHaveBeenCalledTimes(1)
    expect(a.length).toBe(16)
    expect(segment).toHaveBeenCalledWith([
      expect.objectContaining({ brushMode: 1 }),
    ])

    await segmentPointLocal({
      image: canvas,
      imageKey: 'img-a',
      x: 1,
      y: 1,
      width: 2,
      height: 2,
      deps: { loadSegmenter },
    })
    expect(loadSegmenter).toHaveBeenCalledTimes(1)
    expect(setImage).toHaveBeenCalledTimes(1)

    await segmentPointLocal({
      image: canvas,
      imageKey: 'img-b',
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      deps: { loadSegmenter },
    })
    expect(setImage).toHaveBeenCalledTimes(2)
  })

  it('closes the cached segmenter when resetting the session', async () => {
    await resetMediaPipeSegmentSession()
    const close = vi.fn()
    const loadSegmenter = vi.fn(async () => ({
      setImage: vi.fn(),
      segment: vi.fn(() => ({
        getAsFloat32Array: () => new Float32Array([1]),
      })),
      close,
    }))
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1

    await segmentPointLocal({
      image: canvas,
      imageKey: 'img-close',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      deps: { loadSegmenter },
    })
    await resetMediaPipeSegmentSession()

    expect(close).toHaveBeenCalledTimes(1)
  })
})
