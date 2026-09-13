import { Injectable, UnauthorizedException } from '@nestjs/common'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type { SliderCaptchaChallengePublic, SliderPuzzleMeta } from './captcha.types'

type TicketRecord = { expiresAt: number; consumed: boolean }

type ChallengeRecord = {
  targetX: number
  puzzle: SliderPuzzleMeta
}

const WIDTH = 280
const HEIGHT = 160
const PIECE_SIZE = 44
const TOLERANCE = 5

@Injectable()
export class CaptchaService {
  private readonly challenges = new Map<string, ChallengeRecord>()
  private readonly tickets = new Map<string, TicketRecord>()
  private readonly ttlMs = 5 * 60 * 1000

  private get secret(): string {
    return process.env.AUTH_CAPTCHA_SECRET?.trim() || 'dev-captcha-secret'
  }

  createChallenge(): SliderCaptchaChallengePublic {
    const challengeId = `ch_${randomBytes(8).toString('hex')}`
    const minX = PIECE_SIZE
    const maxX = WIDTH - 2 * PIECE_SIZE
    const targetX = minX + (randomBytes(2).readUInt16BE(0) % (maxX - minX + 1))
    const y =
      Math.floor(HEIGHT * 0.2) +
      (randomBytes(1)[0]! % Math.max(1, Math.floor(HEIGHT * 0.5) - PIECE_SIZE))

    const puzzle: SliderPuzzleMeta = {
      width: WIDTH,
      height: HEIGHT,
      pieceSize: PIECE_SIZE,
      y,
    }

    this.challenges.set(challengeId, { targetX, puzzle })

    return {
      challengeId,
      bgImage: this.buildBgSvg(targetX, y),
      pieceImage: this.buildPieceSvg(targetX, y),
      puzzle,
    }
  }

  verifySlide(challengeId: string, offsetX: number) {
    const challenge = this.challenges.get(challengeId)
    if (!challenge) throw new UnauthorizedException('验证已过期，请重试')

    if (Math.abs(offsetX - challenge.targetX) > TOLERANCE) {
      throw new UnauthorizedException('滑块位置不正确')
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

  private buildBgSvg(holeX: number, holeY: number): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5b8def"/>
      <stop offset="100%" stop-color="#3d6fd9"/>
    </linearGradient>
    <mask id="hole">
      <rect width="${WIDTH}" height="${HEIGHT}" fill="white"/>
      <rect x="${holeX}" y="${holeY}" width="${PIECE_SIZE}" height="${PIECE_SIZE}" rx="4" fill="black"/>
    </mask>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" mask="url(#hole)"/>
  <rect x="${holeX}" y="${holeY}" width="${PIECE_SIZE}" height="${PIECE_SIZE}" rx="4" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1"/>
</svg>`
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  }

  private buildPieceSvg(sourceX: number, sourceY: number): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PIECE_SIZE}" height="${PIECE_SIZE}" viewBox="0 0 ${PIECE_SIZE} ${PIECE_SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5b8def"/>
      <stop offset="100%" stop-color="#3d6fd9"/>
    </linearGradient>
    <clipPath id="piece">
      <rect width="${PIECE_SIZE}" height="${PIECE_SIZE}" rx="4"/>
    </clipPath>
  </defs>
  <g clip-path="url(#piece)">
    <rect x="${-sourceX}" y="${-sourceY}" width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  </g>
  <rect width="${PIECE_SIZE}" height="${PIECE_SIZE}" rx="4" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
</svg>`
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
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
