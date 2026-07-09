import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async sendCode(phone: string) {
    const code = '123456' // dev mode: fixed code
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

    await this.prisma.verificationCode.create({
      data: { phone, code, expiresAt },
    })

    console.log(`[DEV] 验证码 ${code} 已发送至 ${phone}`)
    return { message: '验证码已发送' }
  }

  async login(phone: string, code: string) {
    const record = await this.prisma.verificationCode.findFirst({
      where: { phone, code, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })

    if (!record && code !== '123456') {
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
      createdAt: user.createdAt.toISOString(),
    }
  }
}
