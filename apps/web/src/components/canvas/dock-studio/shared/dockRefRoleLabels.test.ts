import { describe, expect, it } from 'vitest'
import type { NodeRef } from '@/composables/useNodeRefs'
import {
  countValidImageRefs,
  hasUnsupportedMediaRefs,
  resolveRefRoleLabel,
} from './dockRefRoleLabels'

function imageRef(refKey: string, refId = refKey): NodeRef {
  return {
    refId,
    refKey,
    mediaType: 'image',
    sourceKind: 'upload',
    label: refKey,
    preview: '',
    payload: { url: `https://example.com/${refKey}.jpg` },
  }
}

function videoRef(refKey: string): NodeRef {
  return {
    refId: refKey,
    refKey,
    mediaType: 'video',
    sourceKind: 'upload',
    label: refKey,
    preview: '',
    payload: { url: 'https://example.com/clip.mp4' },
  }
}

function audioRef(refKey: string): NodeRef {
  return {
    refId: refKey,
    refKey,
    mediaType: 'audio',
    sourceKind: 'upload',
    label: refKey,
    preview: '',
    payload: { url: 'https://example.com/track.mp3' },
  }
}

describe('resolveRefRoleLabel', () => {
  it('first_last_frame with 2 image refs shows 首帧/末帧 labels', () => {
    const refs = [imageRef('I1'), imageRef('I2')]
    expect(resolveRefRoleLabel(refs[0], refs, 'first_last_frame')).toBe('首帧')
    expect(resolveRefRoleLabel(refs[1], refs, 'first_last_frame')).toBe('末帧')
  })

  it('image_to_video labels all images as 参考', () => {
    const refs = [imageRef('I1'), imageRef('I2'), imageRef('I3')]
    for (const ref of refs) {
      expect(resolveRefRoleLabel(ref, refs, 'image_to_video')).toBe('参考')
    }
  })

  it('labels video and audio refs as 运镜 and 音频', () => {
    const refs = [imageRef('I1'), videoRef('V1'), audioRef('A1')]
    expect(resolveRefRoleLabel(refs[1], refs, 'first_last_frame')).toBe('运镜')
    expect(resolveRefRoleLabel(refs[2], refs, 'image_to_video')).toBe('音频')
  })

  it('skips stale or url-less image refs for first_last_frame ordering', () => {
    const stale: NodeRef = { ...imageRef('I0'), stale: true }
    const refs = [stale, imageRef('I1'), imageRef('I2')]
    expect(resolveRefRoleLabel(refs[1], refs, 'first_last_frame')).toBe('首帧')
    expect(resolveRefRoleLabel(refs[2], refs, 'first_last_frame')).toBe('末帧')
  })
})

describe('countValidImageRefs', () => {
  it('counts only non-stale images with urls', () => {
    const refs = [
      imageRef('I1'),
      { ...imageRef('I2'), stale: true },
      { ...imageRef('I3'), payload: {} },
      videoRef('V1'),
    ]
    expect(countValidImageRefs(refs)).toBe(1)
  })
})

describe('hasUnsupportedMediaRefs', () => {
  it('warns when video ref present but model lacks support', () => {
    const refs = [videoRef('V1')]
    expect(hasUnsupportedMediaRefs(refs, false, true)).toEqual({
      hasVideo: true,
      hasAudio: false,
      showWarning: true,
    })
  })

  it('no warning when capabilities match refs', () => {
    const refs = [videoRef('V1'), audioRef('A1')]
    expect(hasUnsupportedMediaRefs(refs, true, true)).toEqual({
      hasVideo: true,
      hasAudio: true,
      showWarning: false,
    })
  })
})
