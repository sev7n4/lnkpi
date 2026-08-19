import { describe, expect, it } from 'vitest'
import {
  clampWipeRatio,
  decideAgentOpenWhileRefine,
  decideInspectorOpenWhileRefine,
  shouldApplyRefineToNode,
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
