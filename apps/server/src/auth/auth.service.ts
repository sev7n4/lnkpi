import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service'

/** fixed = 固定验证码（开发/生产临时）；real = 真实短信（未接入时 sendCode 会报错） */
type AuthSmsMode = 'fixed' | 'real'

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  private get smsMode(): AuthSmsMode {
    return process.env.AUTH_SMS_MODE === 'real' ? 'real' : 'fixed'
  }

  private get fixedCode(): string {
    return process.env.AUTH_FIXED_CODE?.trim() || '123456'
  }

  getPublicConfig() {
    const fixed = this.smsMode === 'fixed'
    return {
      smsMode: this.smsMode,
      /** 固定码模式下前端可展示提示；未接入短信前生产环境使用 */
      fixedCodeHint: fixed ? this.fixedCode : null,
      message: fixed ? '当前为固定验证码模式，未发送真实短信' : null,
    }
  }

  async sendCode(phone: string) {
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
    const record = await this.prisma.verificationCode.findFirst({
      where: { phone, code, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })

    const bypass = this.smsMode === 'fixed' ? this.fixedCode : null
    if (!record && code !== bypass) {
      throw new UnauthorizedException('验证码无效或已过期')
    }

    let user = await this.prisma.user.findUnique({ where: { phone } })
    if (!user) {
      user = await this.prisma.user.create({
        data: { phone, nickname: `用户${phone.slice(-4)}` },
      })
    }

    const token = await this.jwt.signAsync({ sub: user.id, phone: user.phone })
    return {
      token,
      user: {
        id: user.id,
        phone: user.phone,
        nickname: user.nickname,
        avatar: user.avatar ?? undefined,
        points: user.points,
        membership: user.membership,
        createdAt: user.createdAt.toISOString(),
      },
    }
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new UnauthorizedException()
    return {
      id: user.id,
      phone: user.phone,
      nickname: user.nickname,
      avatar: user.avatar ?? undefined,
      points: user.points,
      membership: user.membership,
      createdAt: user.createdAt.toISOString(),
    }
  }
}
