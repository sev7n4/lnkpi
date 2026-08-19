import { describe, expect, it } from 'vitest'
import {
  clampWipeRatio,
  decideAgentOpenWhileRefine,
  decideInspectorOpenWhileRefine,
  loupeSubcontrolsVisible,
  maskSubcontrolsVisible,
  nextCompareWorkspace,
  shouldApplyRefineToNode,
  wipeCompareLocked,
} from './refineChrome'

describe('clampWipeRatio', () => {
  it('clamps to [0, 1] and defaults non-finite to 0.5', () => {
    expect(clampWipeRatio(-1)).toBe(0)
    expect(clampWipeRatio(2)).toBe(1)
    expect(clampWipeRatio(0.25)).toBe(0.25)
    expect(clampWipeRatio(Number.NaN)).toBe(0.5)
  })
})

describe('decideAgentOpenWhileRefine', () => {
  it('allows when refine is closed', () => {
    expect(
      decideAgentOpenWhileRefine({
        refineOpen: false,
        refineBusy: false,
        refineChrome: 'docked',
      }),
    ).toBe('allow')
  })

  it('allows when refine is floating', () => {
    expect(
      decideAgentOpenWhileRefine({
        refineOpen: true,
        refineBusy: true,
        refineChrome: 'floating',
      }),
    ).toBe('allow')
  })

  it('dismisses idle docked refine', () => {
    expect(
      decideAgentOpenWhileRefine({
        refineOpen: true,
        refineBusy: false,
        refineChrome: 'docked',
      }),
    ).toBe('dismiss-refine')
  })

  it('blocks busy docked refine', () => {
    expect(
      decideAgentOpenWhileRefine({
        refineOpen: true,
        refineBusy: true,
        refineChrome: 'docked',
      }),
    ).toBe('block')
  })
})

describe('decideInspectorOpenWhileRefine', () => {
  it('allows when refine is closed', () => {
    expect(
      decideInspectorOpenWhileRefine({ refineOpen: false, refineBusy: false }),
    ).toBe('allow')
  })

  it('dismisses idle refine', () => {
    expect(
      decideInspectorOpenWhileRefine({ refineOpen: true, refineBusy: false }),
    ).toBe('dismiss-refine')
  })

  it('blocks while refine is busy', () => {
    expect(
      decideInspectorOpenWhileRefine({ refineOpen: true, refineBusy: true }),
    ).toBe('block')
  })
})

describe('compare workspace chrome', () => {
  it('toggles maximized compare back to the work image', () => {
    expect(nextCompareWorkspace('work')).toBe('compare')
    expect(nextCompareWorkspace('compare')).toBe('work')
  })

  it('keeps wipe switchable before After exists', () => {
    expect(wipeCompareLocked(false)).toBe(false)
    expect(wipeCompareLocked(true)).toBe(false)
  })

  it('hides loupe shape and zoom until the loupe is on', () => {
    expect(loupeSubcontrolsVisible(false)).toBe(false)
    expect(loupeSubcontrolsVisible(true)).toBe(true)
  })

  it('hides brush color, size and shape until the brush menu is open', () => {
    expect(maskSubcontrolsVisible(false)).toBe(false)
    expect(maskSubcontrolsVisible(true)).toBe(true)
  })
})

describe('shouldApplyRefineToNode', () => {
  it('allows apply only when the node url is still the session before url', () => {
    expect(
      shouldApplyRefineToNode({
        nodeUrl: 'https://cdn/before.png',
        sessionBeforeUrl: 'https://cdn/before.png',
      }),
    ).toBe(true)
    expect(
      shouldApplyRefineToNode({
        nodeUrl: 'https://cdn/after.png',
        sessionBeforeUrl: 'https://cdn/before.png',
      }),
    ).toBe(false)
  })
})
