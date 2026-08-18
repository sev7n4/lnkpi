import { describe, expect, it } from 'vitest'
import {
  IMAGE_EDIT_GATEWAY_MODEL_ID,
  P1_IMAGE_EDIT_MODEL_KEY,
  resolveImageEditProfile,
} from './imageEditProfiles'

describe('resolveImageEditProfile', () => {
  it('returns Image2 apimart_mask profile for P1 key', () => {
    const p = resolveImageEditProfile(P1_IMAGE_EDIT_MODEL_KEY)
    expect(p.editWire).toBe('apimart_mask')
    expect(p.gatewayModelId).toBe(IMAGE_EDIT_GATEWAY_MODEL_ID)
    expect(p.responseMode).toBe('async_task')
    expect(p.size).toBe('auto')
    expect(p.pollIntervalMs).toBe(8000)
    expect(p.maxPollMs).toBe(360000)
  })
})
