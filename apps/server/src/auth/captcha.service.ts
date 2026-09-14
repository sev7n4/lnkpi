import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import sharp from 'sharp'
import {
  CAPTCHA_SHAPES,
  buildHoleMaskSvg,
  buildShapeMaskSvg,
  shapePadding,
  type CaptchaShapeId,
} from './captcha.shapes'
import type { SliderCaptchaChallengePublic, SliderPuzzleMeta } from './captcha.types'

type TicketRecord = { expiresAt: number; consumed: boolean }
type ChallengeRecord = { targetX: number; puzzle: SliderPuzzleMeta }

const WIDTH = 280
const HEIGHT = 160
const PIECE_SIZE = 44
const TOLERANCE = 5
const MAX_POOL = 10
const WEBP_QUALITY = 68

@Injectable()
export class CaptchaService implements OnModuleInit {
  private readonly challenges = new Map<string, ChallengeRecord>()
  private readonly tickets = new Map<string, TicketRecord>()
  private readonly ttlMs = 5 * 60 * 1000
  /** Pre-resized 280×160 RGBA PNG buffers */
  private pool: Buffer[] = []
  private poolReady: Promise<void>

  constructor() {
    this.poolReady = this.warmPool()
  }

  async onModuleInit() {
    await this.poolReady
  }

  private get secret(): string {
    return process.env.AUTH_CAPTCHA_SECRET?.trim() || 'dev-captcha-secret'
  }

  async createChallenge(): Promise<SliderCaptchaChallengePublic> {
    await this.poolReady
    const challengeId = `ch_${randomBytes(8).toString('hex')}`
    const shape = CAPTCHA_SHAPES[randomBytes(1)[0]! % CAPTCHA_SHAPES.length]!
    const pad = shapePadding(shape)
    const minX = PIECE_SIZE + pad
    const maxX = WIDTH - 2 * PIECE_SIZE - pad
    const targetX = minX + (randomBytes(2).readUInt16BE(0) % Math.max(1, maxX - minX + 1))
    const minY = pad + 8
    const maxY = HEIGHT - PIECE_SIZE - pad - 8
    const y = minY + (randomBytes(1)[0]! % Math.max(1, maxY - minY + 1))

    const puzzle: SliderPuzzleMeta = {
      width: WIDTH,
      height: HEIGHT,
      pieceSize: PIECE_SIZE,
      y,
      shape,
      piecePad: pad,
    }

    this.challenges.set(challengeId, { targetX, puzzle })

    try {
      const images = await this.cutImages(shape, targetX, y)
      return { challengeId, ...images, puzzle }
    } catch {
      return {
        challengeId,
        bgImage: this.buildFallbackBgSvg(targetX, y, shape),
        pieceImage: this.buildFallbackPieceSvg(targetX, y, shape),
        puzzle,
      }
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

  private loadPoolFiles(): Buffer[] {
    const dir = join(__dirname, '..', '..', 'assets', 'captcha')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort()
      .slice(0, MAX_POOL)
      .map((f) => readFileSync(join(dir, f)))
  }

  private async warmPool() {
    const files = this.loadPoolFiles()
    if (files.length === 0) {
      this.pool = []
      return
    }
    this.pool = await Promise.all(
      files.map((buf) =>
        sharp(buf).resize(WIDTH, HEIGHT, { fit: 'cover' }).ensureAlpha().png().toBuffer(),
      ),
    )
  }

  private pickBg(): Buffer {
    if (this.pool.length === 0) {
      // Sync SVG fallback — rare when assets missing
      return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
          <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#1a1d24"/><stop offset="100%" stop-color="#12141a"/>
          </linearGradient></defs>
          <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g)"/>
        </svg>`,
      )
    }
    return this.pool[randomBytes(1)[0]! % this.pool.length]!
  }

  private async toDataUrl(buf: Buffer, preferWebp = true): Promise<string> {
    if (preferWebp) {
      try {
        const webp = await sharp(buf).webp({ quality: WEBP_QUALITY, alphaQuality: 80 }).toBuffer()
        return `data:image/webp;base64,${webp.toString('base64')}`
      } catch {
        /* fall through */
      }
    }
    const png = await sharp(buf).png({ compressionLevel: 8 }).toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  }

  private async cutImages(shape: CaptchaShapeId, targetX: number, y: number) {
    let base = this.pickBg()
    // If SVG fallback (no warm pool), rasterize once
    if (base[0] === 0x3c /* '<' */) {
      base = await sharp(base).resize(WIDTH, HEIGHT).ensureAlpha().png().toBuffer()
    }

    const holeSvg = Buffer.from(buildHoleMaskSvg(shape, WIDTH, HEIGHT, targetX, y, PIECE_SIZE))
    const ring =
      shape === 'circle'
        ? `<circle cx="${targetX + PIECE_SIZE / 2}" cy="${y + PIECE_SIZE / 2}" r="${PIECE_SIZE / 2}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>`
        : shape === 'rect'
          ? `<rect x="${targetX}" y="${y}" width="${PIECE_SIZE}" height="${PIECE_SIZE}" rx="8" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>`
          : ''
    const ringSvg = ring
      ? Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${ring}</svg>`)
      : null

    const bgPromise = (async () => {
      let bgBuf = await sharp(base)
        .composite([{ input: holeSvg, blend: 'dest-out' }])
        .png()
        .toBuffer()
      if (ringSvg) {
        bgBuf = await sharp(bgBuf).composite([{ input: ringSvg, blend: 'over' }]).png().toBuffer()
      }
      return this.toDataUrl(bgBuf)
    })()

    const pad = shapePadding(shape)
    const left = Math.max(0, targetX - pad)
    const top = Math.max(0, y - pad)
    const width = Math.min(WIDTH - left, PIECE_SIZE + pad * 2)
    const height = Math.min(HEIGHT - top, PIECE_SIZE + pad * 2)

    const piecePromise = (async () => {
      const cropped = await sharp(base).extract({ left, top, width, height }).ensureAlpha().png().toBuffer()
      const localMask = Buffer.from(buildShapeMaskSvg(shape, PIECE_SIZE, pad))
      const maskLeft = targetX - left - pad
      const maskTop = y - top - pad
      const positionedMask = await sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{ input: localMask, left: maskLeft, top: maskTop }])
        .png()
        .toBuffer()
      const pieceBuf = await sharp(cropped)
        .composite([{ input: positionedMask, blend: 'dest-in' }])
        .png()
        .toBuffer()
      return this.toDataUrl(pieceBuf)
    })()

    const [bgImage, pieceImage] = await Promise.all([bgPromise, piecePromise])
    return { bgImage, pieceImage }
  }

  private buildFallbackBgSvg(holeX: number, holeY: number, shape: CaptchaShapeId): string {
    const hole =
      shape === 'circle'
        ? `<circle cx="${holeX + PIECE_SIZE / 2}" cy="${holeY + PIECE_SIZE / 2}" r="${PIECE_SIZE / 2}" fill="black"/>`
        : `<rect x="${holeX}" y="${holeY}" width="${PIECE_SIZE}" height="${PIECE_SIZE}" rx="8" fill="black"/>`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#1c1e26"/><stop offset="100%" stop-color="#12141a"/>
  </linearGradient>
  <mask id="m"><rect width="${WIDTH}" height="${HEIGHT}" fill="white"/>${hole}</mask></defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" mask="url(#m)"/>
</svg>`
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  }

  private buildFallbackPieceSvg(sourceX: number, sourceY: number, shape: CaptchaShapeId): string {
    const pad = shapePadding(shape)
    const w = PIECE_SIZE + pad * 2
    const h = PIECE_SIZE + pad * 2
    const clipInner = buildShapeMaskSvg(shape, PIECE_SIZE, pad).replace(/<\/?svg[^>]*>/g, '')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1c1e26"/><stop offset="100%" stop-color="#12141a"/>
    </linearGradient>
    <clipPath id="c">${clipInner}</clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect x="${-sourceX + pad}" y="${-sourceY + pad}" width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  </g>
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
