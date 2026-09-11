import { describe, expect, it } from 'vitest'
import { applyGuideSceneToPrompt, clearGuideScene } from './guideSceneApply'

describe('applyGuideSceneToPrompt', () => {
  it('prefills when prompt empty', () => {
    const r = applyGuideSceneToPrompt({ sceneId: 'g3_exact_text', currentPrompt: '' })
    expect(r.didPrefill).toBe(true)
    expect(r.prompt.length).toBeGreaterThan(10)
    expect(r.guideSceneId).toBe('g3_exact_text')
  })

  it('does not overwrite non-empty prompt', () => {
    const r = applyGuideSceneToPrompt({ sceneId: 'g3_exact_text', currentPrompt: 'keep me' })
    expect(r.didPrefill).toBe(false)
    expect(r.prompt).toBe('keep me')
    expect(r.guideSceneId).toBe('g3_exact_text')
  })
})

describe('clearGuideScene', () => {
  it('clears guideSceneId without touching prompt', () => {
    expect(clearGuideScene()).toEqual({ guideSceneId: null })
  })
})
