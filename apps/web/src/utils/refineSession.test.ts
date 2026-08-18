import { describe, expect, it } from 'vitest'
import {
  CX_IMAGE_EDIT_ENABLED,
  STAIN_PRESET_PROMPT,
  canOpenRefineForNode,
  decideRefineDismiss,
} from './refineSession'

describe('refine session constants', () => {
  it('exports stain preset prompt and feature flag', () => {
    expect(STAIN_PRESET_PROMPT).toBe(
      '去除选区内的污渍、瑕疵、多余物体，其余像素保持不变',
    )
    expect(CX_IMAGE_EDIT_ENABLED).toBe(true)
  })
})

describe('decideRefineDismiss', () => {
  it('blocks switching nodes while a refine request is busy', () => {
    expect(
      decideRefineDismiss({
        busy: true,
        targetNodeId: 'node-a',
        selectedNodeId: 'node-b',
      }),
    ).toBe('block')
  })

  it('blocks when busy even if selection is cleared', () => {
    expect(
      decideRefineDismiss({
        busy: true,
        targetNodeId: 'node-a',
        selectedNodeId: null,
      }),
    ).toBe('block')
  })

  it('dismisses when idle and the selected node is not the target', () => {
    expect(
      decideRefineDismiss({
        busy: false,
        targetNodeId: 'node-a',
        selectedNodeId: 'node-b',
      }),
    ).toBe('dismiss')
  })

  it('dismisses when idle and selection is cleared', () => {
    expect(
      decideRefineDismiss({
        busy: false,
        targetNodeId: 'node-a',
        selectedNodeId: null,
      }),
    ).toBe('dismiss')
  })

  it('keeps the session when the same node stays selected', () => {
    expect(
      decideRefineDismiss({
        busy: false,
        targetNodeId: 'node-a',
        selectedNodeId: 'node-a',
      }),
    ).toBe('keep')
  })

  it('keeps the session when busy on the same node', () => {
    expect(
      decideRefineDismiss({
        busy: true,
        targetNodeId: 'node-a',
        selectedNodeId: 'node-a',
      }),
    ).toBe('keep')
  })
})

describe('canOpenRefineForNode', () => {
  it('allows image nodes', () => {
    expect(canOpenRefineForNode({ type: 'image' })).toBe(true)
  })

  it('allows mediaInput when mediaKind is image', () => {
    expect(canOpenRefineForNode({ type: 'mediaInput', mediaKind: 'image' })).toBe(true)
  })

  it('allows mediaInput when mimeType is an image', () => {
    expect(canOpenRefineForNode({ type: 'mediaInput', mimeType: 'image/png' })).toBe(true)
  })

  it('rejects video and audio mediaInput even when a url exists', () => {
    expect(canOpenRefineForNode({ type: 'mediaInput', mediaKind: 'video' })).toBe(false)
    expect(canOpenRefineForNode({ type: 'mediaInput', mediaKind: 'audio' })).toBe(false)
    expect(canOpenRefineForNode({ type: 'mediaInput', mimeType: 'video/mp4' })).toBe(false)
    expect(canOpenRefineForNode({ type: 'mediaInput', mimeType: 'audio/mpeg' })).toBe(false)
  })

  it('rejects other node types', () => {
    expect(canOpenRefineForNode({ type: 'video' })).toBe(false)
    expect(canOpenRefineForNode({ type: 'text' })).toBe(false)
  })
})
