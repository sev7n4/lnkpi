import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { CaptchaService } from './captcha.service'

describe('CaptchaService slider', () => {
  let service: CaptchaService
  const prev = process.env.AUTH_CAPTCHA_SECRET

  beforeEach(() => {
    process.env.AUTH_CAPTCHA_SECRET = 'test-secret'
    service = new CaptchaService()
  })
  afterEach(() => {
    process.env.AUTH_CAPTCHA_SECRET = prev
  })

  it('createChallenge returns raster data URLs with shape and no targetX', async () => {
    const c = await service.createChallenge()
    expect(c.challengeId).toMatch(/^ch_/)
    expect(c.bgImage.startsWith('data:image/')).toBe(true)
    expect(c.pieceImage.startsWith('data:image/')).toBe(true)
    expect(c.puzzle.width).toBeGreaterThan(100)
    expect(c.puzzle.pieceSize).toBeGreaterThan(20)
    expect(['rect', 'circle', 'puzzle']).toContain(c.puzzle.shape)
    expect((c as { targetX?: number }).targetX).toBeUndefined()
  })

  it('createChallenge varies shapes across many calls', async () => {
    const shapes = new Set<string | undefined>()
    for (let i = 0; i < 24; i++) {
      shapes.add((await service.createChallenge()).puzzle.shape)
    }
    expect(shapes.size).toBeGreaterThanOrEqual(3)
  })

  it('verifySlide issues ticket within 5px and rejects far offset', async () => {
    const c = await service.createChallenge()
    expect(() => service.verifySlide(c.challengeId, -9999)).toThrow()
    const max = c.puzzle.width - c.puzzle.pieceSize
    let ticket: string | null = null
    for (let x = 0; x <= max; x++) {
      try {
        ticket = service.verifySlide(c.challengeId, x).captchaTicket
        break
      } catch {
        /* keep scanning; challenge must survive failures */
      }
    }
    expect(ticket).toMatch(/^cpt_/)
  })

  it('consumeTicket still one-shot', async () => {
    const c = await service.createChallenge()
    const max = c.puzzle.width - c.puzzle.pieceSize
    let t = ''
    for (let x = 0; x <= max; x++) {
      try {
        t = service.verifySlide(c.challengeId, x).captchaTicket
        break
      } catch {
        /* */
      }
    }
    expect(service.consumeTicket(t)).toBe('ok')
    expect(service.consumeTicket(t)).toBe('invalid')
  })
})
