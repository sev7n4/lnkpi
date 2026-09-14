import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service'
import { CaptchaService } from './captcha.service'
import { InviteService } from './invite.service'
import { PrismaService } from '../prisma/prisma.service'
import { JwtService } from '@nestjs/jwt'

function mockInvite() {
  return {
    ensureInviteCode: vi.fn(async () => 'XCCODE1234'),
    findInviterByCode: vi.fn(async () => null),
    redeemOnRegister: vi.fn(async () => ({ bound: true, inviteePoints: 200, inviterPoints: 200 })),
  }
}

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
      mockInvite() as unknown as InviteService,
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
    const c = await captcha.createChallenge()
    const max = c.puzzle.width - c.puzzle.pieceSize
    let ticket = ''
    for (let x = 0; x <= max; x++) {
      try {
        ticket = captcha.verifySlide(c.challengeId, x).captchaTicket
        break
      } catch { /* keep scanning */ }
    }
    await auth.sendCode('13800138000', ticket)
    expect(create).toHaveBeenCalled()
  })
})

const PHONE = '13800138000'
const existingUser = {
  id: 'u1',
  phone: PHONE,
  nickname: '用户8000',
  avatar: null as string | null,
  points: 1000,
  membership: 'free',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  inviteCode: 'XCABCDEFGH',
  invitedByUserId: null as string | null,
  _count: { invitees: 2 },
}

describe('AuthService.login/register', () => {
  const prisma = {
    verificationCode: { findFirst: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
  }
  const jwt = { signAsync: vi.fn(async () => 'tok') }
  let invite: ReturnType<typeof mockInvite>
  let auth: AuthService

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AUTH_SMS_MODE = 'fixed'
    process.env.AUTH_FIXED_CODE = '123456'
    invite = mockInvite()
    auth = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      new CaptchaService(),
      invite as unknown as InviteService,
    )
  })

  it('login when user missing throws 请先注册', async () => {
    prisma.user.findUnique.mockResolvedValue(null)
    await expect(auth.login(PHONE, '123456')).rejects.toMatchObject({
      message: expect.stringContaining('请先注册'),
    })
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('register when user exists throws 请直接登录', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser)
    await expect(auth.register(PHONE, '123456')).rejects.toBeInstanceOf(ConflictException)
    await expect(auth.register(PHONE, '123456')).rejects.toMatchObject({
      message: expect.stringContaining('请直接登录'),
    })
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('register new user without invite creates user, ensures invite code, no redeem', async () => {
    const created = { ...existingUser, inviteCode: 'XCNEWCODE1', invitedByUserId: null, _count: { invitees: 0 } }
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: { phone?: string; id?: string } }) => {
      if (where.phone) return null
      if (where.id === 'u1') return created
      return null
    })
    prisma.user.create.mockResolvedValue(created)

    const result = await auth.register(PHONE, '123456')

    expect(prisma.user.create).toHaveBeenCalled()
    expect(invite.ensureInviteCode).toHaveBeenCalledWith('u1')
    expect(invite.redeemOnRegister).not.toHaveBeenCalled()
    expect(invite.findInviterByCode).not.toHaveBeenCalled()
    expect(result.token).toBe('tok')
    expect(result.user.inviteCode).toBe('XCNEWCODE1')
    expect(result.user.invitedByUserId).toBeUndefined()
  })

  it('register with invite calls redeemOnRegister once', async () => {
    const created = { ...existingUser, inviteCode: 'XCNEWCODE1', invitedByUserId: null, _count: { invitees: 0 } }
    const bound = { ...created, invitedByUserId: 'inviter1' }
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: { phone?: string; id?: string } }) => {
      if (where.phone) return null
      if (where.id === 'u1') return bound
      return null
    })
    prisma.user.create.mockResolvedValue(created)
    invite.findInviterByCode.mockResolvedValue({ id: 'inviter1', inviteCode: 'XCINVITE00' })

    const result = await auth.register(PHONE, '123456', '  XCINVITE00  ')

    expect(invite.findInviterByCode).toHaveBeenCalledWith('XCINVITE00')
    expect(prisma.user.create).toHaveBeenCalled()
    expect(invite.redeemOnRegister).toHaveBeenCalledTimes(1)
    expect(invite.redeemOnRegister).toHaveBeenCalledWith({ inviteeId: 'u1', inviteCode: 'XCINVITE00' })
    expect(result.user.invitedByUserId).toBe('inviter1')
  })

  it('register with invalid invite rejects before create', async () => {
    prisma.user.findUnique.mockResolvedValue(null)
    invite.findInviterByCode.mockResolvedValue(null)
    await expect(auth.register(PHONE, '123456', 'XCBADCODE1')).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(invite.redeemOnRegister).not.toHaveBeenCalled()
  })

  it('getProfile returns invite fields', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser)
    const profile = await auth.getProfile('u1')
    expect(invite.ensureInviteCode).toHaveBeenCalledWith('u1')
    expect(profile.inviteCode).toBe('XCABCDEFGH')
    expect(profile.inviteeCount).toBe(2)
    expect(profile.invitedByUserId).toBeUndefined()
  })
})

