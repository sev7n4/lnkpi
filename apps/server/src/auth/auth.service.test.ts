import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service'
import { CaptchaService } from './captcha.service'
import { PrismaService } from '../prisma/prisma.service'
import { JwtService } from '@nestjs/jwt'

describe('AuthService.sendCode captcha modes', () => {
  let auth: AuthService
  let captcha: CaptchaService
  const create = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AUTH_SMS_MODE = 'fixed'
    captcha = new CaptchaService()
    auth = new AuthService(
      { verificationCode: { create } } as unknown as PrismaService,
      {} as JwtService,
      captcha,
    )
  })

  it('strict mode rejects missing ticket', async () => {
    process.env.AUTH_CAPTCHA_MODE = 'strict'
    await expect(auth.sendCode('13800138000')).rejects.toBeInstanceOf(UnauthorizedException)
    expect(create).not.toHaveBeenCalled()
  })

  it('soft mode allows missing ticket', async () => {
    process.env.AUTH_CAPTCHA_MODE = 'soft'
    await auth.sendCode('13800138000')
    expect(create).toHaveBeenCalled()
  })

  it('strict mode accepts valid ticket', async () => {
    process.env.AUTH_CAPTCHA_MODE = 'strict'
    const c = captcha.createChallenge()
    const used = new Set<string>()
    const placements = c.slots.map((slot) => {
      const block = c.blocks.find((b) => b.shape === slot.shape && !used.has(b.id))!
      used.add(block.id)
      return { blockId: block.id, slotId: slot.id }
    })
    const { captchaTicket } = captcha.verifyPlacement(c.challengeId, placements)
    await auth.sendCode('13800138000', captchaTicket)
    expect(create).toHaveBeenCalled()
  })
})
