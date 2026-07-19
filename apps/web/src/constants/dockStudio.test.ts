import { describe, expect, it } from 'vitest'
import { isNodeGenerating, NODE_GENERATION_STATUS } from '@/constants/dockStudio'

describe('isNodeGenerating', () => {
  it('treats generating as busy', () => {
    expect(isNodeGenerating(NODE_GENERATION_STATUS.generating)).toBe(true)
  })

  it('treats fallback_pending as busy/readonly', () => {
    expect(isNodeGenerating(NODE_GENERATION_STATUS.fallback_pending)).toBe(true)
  })

  it('does not treat completed/error/draft as busy', () => {
    expect(isNodeGenerating(NODE_GENERATION_STATUS.completed)).toBe(false)
    expect(isNodeGenerating(NODE_GENERATION_STATUS.error)).toBe(false)
    expect(isNodeGenerating(NODE_GENERATION_STATUS.draft)).toBe(false)
    expect(isNodeGenerating(undefined)).toBe(false)
  })
})
