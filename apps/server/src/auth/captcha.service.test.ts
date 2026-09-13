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

  it('createChallenge returns images and puzzle meta without targetX', () => {
    const c = service.createChallenge()
    expect(c.challengeId).toMatch(/^ch_/)
    expect(c.bgImage.startsWith('data:image/svg+xml')).toBe(true)
    expect(c.pieceImage.startsWith('data:image/svg+xml')).toBe(true)
    expect(c.puzzle.width).toBeGreaterThan(100)
    expect(c.puzzle.pieceSize).toBeGreaterThan(20)
    expect((c as { targetX?: number }).targetX).toBeUndefined()
  })

  it('verifySlide issues ticket within 5px and rejects far offset', () => {
    const c = service.createChallenge()
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

  it('consumeTicket still one-shot', () => {
    const c = service.createChallenge()
    const max = c.puzzle.width - c.puzzle.pieceSize
    let t = ''
    for (let x = 0; x <= max; x++) {
      try {
        t = service.verifySlide(c.challengeId, x).captchaTicket
        break
      } catch { /* */ }
    }
    expect(service.consumeTicket(t)).toBe('ok')
    expect(service.consumeTicket(t)).toBe('invalid')
  })
})
