import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PointsService } from '../points/points.service'
import { generateInviteCode } from './invite-code'

export const INVITE_REWARD_POINTS = 200
export const INVITER_DAILY_CAP = 20

const GRANT_META = { kind: 'grant' as const, category: 'other' as const, status: null }
const SH_OFFSET_MS = 8 * 60 * 60 * 1000
const ENSURE_CODE_RETRIES = 8

function shanghaiDayBounds(now: Date): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() + SH_OFFSET_MS)
  const start = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 0, 0, 0) - SH_OFFSET_MS,
  )
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

@Injectable()
export class InviteService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PointsService) private readonly points: PointsService,
  ) {}

  async ensureInviteCode(userId: string): Promise<string> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { inviteCode: true },
    })
    if (existing?.inviteCode) return existing.inviteCode

    for (let i = 0; i < ENSURE_CODE_RETRIES; i++) {
      const code = generateInviteCode()
      try {
        const updated = await this.prisma.user.updateMany({
          where: { id: userId, inviteCode: null },
          data: { inviteCode: code },
        })
        if (updated.count === 1) return code
        const again = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { inviteCode: true },
        })
        if (again?.inviteCode) return again.inviteCode
      } catch {
        // unique collision — retry with a new code
      }
    }
    throw new Error('生成邀请码失败')
  }

  async findInviterByCode(code: string): Promise<{ id: string; inviteCode: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { inviteCode: code },
      select: { id: true, inviteCode: true },
    })
    if (!user?.inviteCode) return null
    return { id: user.id, inviteCode: user.inviteCode }
  }

  async countInviterRedemptionsToday(inviterId: string, now: Date = new Date()): Promise<number> {
    const { start, end } = shanghaiDayBounds(now)
    return this.prisma.inviteRedemption.count({
      where: {
        inviterId,
        createdAt: { gte: start, lt: end },
      },
    })
  }

  async redeemOnRegister(params: {
    inviteeId: string
    inviteCode: string | null | undefined
  }): Promise<{ bound: boolean; inviteePoints: number; inviterPoints: number }> {
    const trimmed = params.inviteCode?.trim() ?? ''
    if (!trimmed) {
      return { bound: false, inviteePoints: 0, inviterPoints: 0 }
    }

    const inviter = await this.findInviterByCode(trimmed)
    if (!inviter) {
      throw new BadRequestException('邀请码无效')
    }
    if (inviter.id === params.inviteeId) {
      throw new BadRequestException('邀请码无效')
    }

    const todayCount = await this.countInviterRedemptionsToday(inviter.id)
    const inviteePoints = INVITE_REWARD_POINTS
    const inviterPoints = todayCount >= INVITER_DAILY_CAP ? 0 : INVITE_REWARD_POINTS
    const inviterRewardSkippedReason = inviterPoints === 0 ? 'daily_cap' : null

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: params.inviteeId },
        data: { invitedByUserId: inviter.id },
      })
      await tx.inviteRedemption.create({
        data: {
          inviteeId: params.inviteeId,
          inviterId: inviter.id,
          inviteCode: inviter.inviteCode,
          inviteePoints,
          inviterPoints,
          inviterRewardSkippedReason,
        },
      })
    })

    try {
      await this.points.refund(params.inviteeId, inviteePoints, '邀请奖励-新用户', GRANT_META)
      if (inviterPoints > 0) {
        await this.points.refund(inviter.id, inviterPoints, '邀请奖励-邀请人', GRANT_META)
      }
    } catch (err) {
      console.error('[InviteService] points refund failed after invite bind', err)
    }

    return { bound: true, inviteePoints, inviterPoints }
  }
}
