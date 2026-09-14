import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service'
import { CaptchaService } from './captcha.service'
import { InviteService } from './invite.service'
import { generateInviteCode } from './invite-code'

/** fixed = 固定验证码（开发/生产临时）；real = 真实短信（未接入时 sendCode 会报错） */
type AuthSmsMode = 'fixed' | 'real'

const ENSURE_CODE_RETRIES = 8

type SessionUser = {
  id: string
  phone: string
  nickname: string
  avatar: string | null
  points: number
  membership: string
  createdAt: Date
  inviteCode: string | null
  invitedByUserId: string | null
  _count?: { invitees: number }
}

function isUniqueConstraint(err: unknown, field: string): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; meta?: { target?: string[] | string } }
  if (e.code !== 'P2002') return false
  const target = e.meta?.target
  if (Array.isArray(target)) return target.includes(field)
  if (typeof target === 'string') return target.includes(field)
  return false
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(CaptchaService) private readonly captcha: CaptchaService,
    @Inject(InviteService) private readonly invite: InviteService,
  ) {}

  private get smsMode(): AuthSmsMode {
    return process.env.AUTH_SMS_MODE === 'real' ? 'real' : 'fixed'
  }

  private get captchaMode(): 'off' | 'soft' | 'strict' {
    const m = process.env.AUTH_CAPTCHA_MODE
    return m === 'strict' || m === 'off' ? m : 'soft'
  }

  private get fixedCode(): string {
    return process.env.AUTH_FIXED_CODE?.trim() || '123456'
  }

  getPublicConfig() {
    const fixed = this.smsMode === 'fixed'
    return {
      smsMode: this.smsMode,
      captchaMode: this.captchaMode,
      /** 固定码模式下前端可展示提示；未接入短信前生产环境使用 */
      fixedCodeHint: fixed ? this.fixedCode : null,
      message: fixed ? '当前为固定验证码模式，未发送真实短信' : null,
    }
  }

  async sendCode(phone: string, captchaTicket?: string) {
    const mode = this.captchaMode
    if (mode !== 'off') {
      const result = this.captcha.consumeTicket(captchaTicket)
      if (mode === 'strict' && result !== 'ok') {
        throw new UnauthorizedException('请先完成安全验证')
      }
      if (mode === 'soft' && result !== 'ok') {
        console.warn(`[AUTH:captcha:soft] send-code without valid ticket phone=${phone} result=${result}`)
      }
    }

    if (this.smsMode === 'real') {
      throw new UnauthorizedException('短信服务未配置，请将 AUTH_SMS_MODE 设为 fixed 或接入 SMS Provider')
    }

    const code = this.fixedCode
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

    await this.prisma.verificationCode.create({
      data: { phone, code, expiresAt },
    })

    console.log(`[AUTH:fixed] 验证码 ${code} 已写入 ${phone}（未发送真实短信）`)
    return { message: '验证码已发送' }
  }

  async login(phone: string, code: string) {
    await this.assertValidCode(phone, code)
    let user = await this.loadUser({ phone })
    if (!user) throw new BadRequestException('账号不存在，请先注册')
    await this.invite.ensureInviteCode(user.id)
    user = (await this.loadUser({ id: user.id }))!
    return this.issueSession(user)
  }

  async register(phone: string, code: string, inviteCode?: string) {
    await this.assertValidCode(phone, code)
    const existing = await this.prisma.user.findUnique({ where: { phone } })
    if (existing) throw new ConflictException('账号已存在，请直接登录')

    const trimmed = inviteCode?.trim()
    if (trimmed) {
      const inviter = await this.invite.findInviterByCode(trimmed)
      if (!inviter) throw new BadRequestException('邀请码无效')
    }

    let user = await this.createRegisteredUser(phone)
    if (trimmed) {
      await this.invite.redeemOnRegister({ inviteeId: user.id, inviteCode: trimmed })
      user = (await this.loadUser({ id: user.id }))!
    } else {
      await this.invite.ensureInviteCode(user.id)
      user = (await this.loadUser({ id: user.id })) ?? user
    }
    return this.issueSession(user)
  }

  async getProfile(userId: string) {
    await this.invite.ensureInviteCode(userId)
    const user = await this.loadUser({ id: userId })
    if (!user) throw new UnauthorizedException()
    return this.toProfile(user)
  }

  private async assertValidCode(phone: string, code: string) {
    const record = await this.prisma.verificationCode.findFirst({
      where: { phone, code, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })

    const bypass = this.smsMode === 'fixed' ? this.fixedCode : null
    if (!record && code !== bypass) {
      throw new UnauthorizedException('验证码无效或已过期')
    }
  }

  private async loadUser(where: { id: string } | { phone: string }): Promise<SessionUser | null> {
    return this.prisma.user.findUnique({
      where,
      include: { _count: { select: { invitees: true } } },
    })
  }

  private async createRegisteredUser(phone: string): Promise<SessionUser> {
    const nickname = `用户${phone.slice(-4)}`
    for (let i = 0; i < ENSURE_CODE_RETRIES; i++) {
      try {
        return await this.prisma.user.create({
          data: { phone, nickname, inviteCode: generateInviteCode() },
          include: { _count: { select: { invitees: true } } },
        })
      } catch (err) {
        if (isUniqueConstraint(err, 'phone')) {
          throw new ConflictException('账号已存在，请直接登录')
        }
        if (!isUniqueConstraint(err, 'inviteCode')) throw err
      }
    }

    const user = await this.prisma.user.create({
      data: { phone, nickname },
      include: { _count: { select: { invitees: true } } },
    })
    await this.invite.ensureInviteCode(user.id)
    return (await this.loadUser({ id: user.id })) ?? user
  }

  private toProfile(user: SessionUser) {
    return {
      id: user.id,
      phone: user.phone,
      nickname: user.nickname,
      avatar: user.avatar ?? undefined,
      points: user.points,
      membership: user.membership,
      createdAt: user.createdAt.toISOString(),
      inviteCode: user.inviteCode!,
      invitedByUserId: user.invitedByUserId ?? undefined,
      inviteeCount: user._count?.invitees ?? 0,
    }
  }

  private async issueSession(user: SessionUser) {
    const token = await this.jwt.signAsync({ sub: user.id, phone: user.phone })
    return { token, user: this.toProfile(user) }
  }
}
