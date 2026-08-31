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
    resetMediaPipeSegmentSession()
    const setImage = vi.fn()
    const getAsFloat32Array = vi.fn(() => new Float32Array([0, 1, 0, 1]))
    const segment = vi.fn(() => ({ confidenceMasks: [{ getAsFloat32Array }] }))
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
})
