import { Injectable, UnauthorizedException } from '@nestjs/common'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type {
  CaptchaBlockShape,
  CaptchaChallenge,
  CaptchaPlacement,
} from './captcha.types'

type TicketRecord = { expiresAt: number; consumed: boolean }

@Injectable()
export class CaptchaService {
  private readonly challenges = new Map<string, CaptchaChallenge>()
  private readonly tickets = new Map<string, TicketRecord>()
  private readonly ttlMs = 5 * 60 * 1000

  private get secret(): string {
    return process.env.AUTH_CAPTCHA_SECRET?.trim() || 'dev-captcha-secret'
  }

  createChallenge(): CaptchaChallenge {
    const shapes: CaptchaBlockShape[] = ['rect', 'l', 'rect', 'l']
    const n = 3 + (randomBytes(1)[0]! % 2) // 3 or 4
    const chosen = shapes.slice(0, n)
    const challengeId = `ch_${randomBytes(8).toString('hex')}`
    const canvas = { w: 280, h: 200 }
    const slots = chosen.map((shape, i) => ({
      id: `slot_${i}`,
      shape,
      x: 40 + (i % 2) * 120,
      y: 40 + Math.floor(i / 2) * 80,
    }))
    const blocks = chosen.map((shape, i) => ({
      id: `blk_${i}`,
      shape,
      home: {
        x: 20 + i * 48,
        y: 160,
      },
    }))
    // shuffle block order for home scatter only (ids stay)
    for (let i = blocks.length - 1; i > 0; i--) {
      const j = randomBytes(1)[0]! % (i + 1)
      const tmp = blocks[i]!.home
      blocks[i]!.home = blocks[j]!.home
      blocks[j]!.home = tmp
    }
    const challenge: CaptchaChallenge = { challengeId, canvas, blocks, slots }
    this.challenges.set(challengeId, challenge)
    return challenge
  }

  verifyPlacement(challengeId: string, placements: CaptchaPlacement[]) {
    const challenge = this.challenges.get(challengeId)
    if (!challenge) throw new UnauthorizedException('验证已过期，请重试')
    if (placements.length !== challenge.slots.length) {
      throw new UnauthorizedException('拼图不正确')
    }
    const usedBlocks = new Set<string>()
    const usedSlots = new Set<string>()
    for (const p of placements) {
      const block = challenge.blocks.find((b) => b.id === p.blockId)
      const slot = challenge.slots.find((s) => s.id === p.slotId)
      if (!block || !slot || block.shape !== slot.shape) {
        throw new UnauthorizedException('拼图不正确')
      }
      if (usedBlocks.has(p.blockId) || usedSlots.has(p.slotId)) {
        throw new UnauthorizedException('拼图不正确')
      }
      usedBlocks.add(p.blockId)
      usedSlots.add(p.slotId)
    }
    this.challenges.delete(challengeId)
    const expiresAt = Date.now() + this.ttlMs
    const captchaTicket = this.signTicket(challengeId, expiresAt)
    this.tickets.set(captchaTicket, { expiresAt, consumed: false })
    return { captchaTicket, expiresAt: new Date(expiresAt).toISOString() }
  }

  consumeTicket(ticket: string | undefined | null): 'ok' | 'missing' | 'invalid' {
    if (!ticket) return 'missing'
    if (!this.verifySignature(ticket)) return 'invalid'
    const rec = this.tickets.get(ticket)
    if (!rec || rec.consumed || rec.expiresAt < Date.now()) return 'invalid'
    rec.consumed = true
    return 'ok'
  }

  private signTicket(challengeId: string, expiresAt: number): string {
    const payload = `${challengeId}.${expiresAt}.${randomBytes(4).toString('hex')}`
    const sig = createHmac('sha256', this.secret).update(payload).digest('hex').slice(0, 24)
    return `cpt_${Buffer.from(`${payload}.${sig}`).toString('base64url')}`
  }

  private verifySignature(ticket: string): boolean {
    if (!ticket.startsWith('cpt_')) return false
    try {
      const raw = Buffer.from(ticket.slice(4), 'base64url').toString('utf8')
      const parts = raw.split('.')
      if (parts.length !== 4) return false
      const [challengeId, exp, nonce, sig] = parts as [string, string, string, string]
      const payload = `${challengeId}.${exp}.${nonce}`
      const expect = createHmac('sha256', this.secret).update(payload).digest('hex').slice(0, 24)
      const a = Buffer.from(sig)
      const b = Buffer.from(expect)
      return a.length === b.length && timingSafeEqual(a, b)
    } catch {
      return false
    }
  }
}
