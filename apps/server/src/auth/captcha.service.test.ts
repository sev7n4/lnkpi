import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { CaptchaService } from './captcha.service'

describe('CaptchaService', () => {
  let service: CaptchaService
  const prevSecret = process.env.AUTH_CAPTCHA_SECRET

  beforeEach(() => {
    process.env.AUTH_CAPTCHA_SECRET = 'test-secret'
    service = new CaptchaService()
  })

  afterEach(() => {
    process.env.AUTH_CAPTCHA_SECRET = prevSecret
  })

  it('createChallenge returns 3–4 blocks matching slot shapes', () => {
    const c = service.createChallenge()
    expect(c.challengeId).toBeTruthy()
    expect(c.blocks.length).toBeGreaterThanOrEqual(3)
    expect(c.blocks.length).toBeLessThanOrEqual(4)
    expect(c.slots).toHaveLength(c.blocks.length)
    for (const slot of c.slots) {
      expect(c.blocks.some((b) => b.shape === slot.shape)).toBe(true)
    }
  })

  it('verifyPlacement issues ticket only when each block maps to a matching-shape slot once', () => {
    const c = service.createChallenge()
    expect(() => service.verifyPlacement(c.challengeId, [])).toThrow()

    const used = new Set<string>()
    const placements = c.slots.map((slot) => {
      const block = c.blocks.find((b) => b.shape === slot.shape && !used.has(b.id))!
      used.add(block.id)
      return { blockId: block.id, slotId: slot.id }
    })
    const out = service.verifyPlacement(c.challengeId, placements)
    expect(out.captchaTicket).toMatch(/^cpt_/)
    expect(Date.parse(out.expiresAt)).toBeGreaterThan(Date.now())
  })

  it('consumeTicket validates once then invalidates', () => {
    const c = service.createChallenge()
    const used = new Set<string>()
    const placements = c.slots.map((slot) => {
      const block = c.blocks.find((b) => b.shape === slot.shape && !used.has(b.id))!
      used.add(block.id)
      return { blockId: block.id, slotId: slot.id }
    })
    const { captchaTicket } = service.verifyPlacement(c.challengeId, placements)
    expect(service.consumeTicket(captchaTicket)).toBe('ok')
    expect(service.consumeTicket(captchaTicket)).toBe('invalid')
    expect(service.consumeTicket(null)).toBe('missing')
  })
})
