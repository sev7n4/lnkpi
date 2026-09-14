import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { InviteService } from './invite.service'
import { generateInviteCode } from './invite-code'

describe('generateInviteCode', () => {
  it('starts with XC and has length 10', () => {
    const c = generateInviteCode()
    expect(c).toMatch(/^XC[A-HJ-NP-Z2-9]{8}$/)
  })
})

describe('InviteService', () => {
  const prisma = {
    user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    inviteRedemption: { count: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  }
  const points = { refund: vi.fn(async () => undefined) }
  let svc: InviteService

  beforeEach(() => {
    vi.clearAllMocks()
    svc = new InviteService(prisma as any, points as any)
  })

  it('rejects unknown invite code', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null) // by code
    await expect(svc.redeemOnRegister({ inviteeId: 'u2', inviteCode: 'XCBADCODE' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('no-ops when invite code empty', async () => {
    const r = await svc.redeemOnRegister({ inviteeId: 'u2', inviteCode: '  ' })
    expect(r).toEqual({ bound: false, inviteePoints: 0, inviterPoints: 0 })
    expect(points.refund).not.toHaveBeenCalled()
  })

  it('credits both when under daily cap', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', inviteCode: 'XCABCDEFGH' })
    prisma.inviteRedemption.count.mockResolvedValueOnce(0)
    prisma.user.update.mockResolvedValueOnce({})
    prisma.inviteRedemption.create.mockResolvedValueOnce({})
    const r = await svc.redeemOnRegister({ inviteeId: 'u2', inviteCode: 'XCABCDEFGH' })
    expect(r.bound).toBe(true)
    expect(r.inviteePoints).toBe(200)
    expect(r.inviterPoints).toBe(200)
    expect(points.refund).toHaveBeenCalledTimes(2)
  })

  it('binds but skips inviter points at daily cap', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', inviteCode: 'XCABCDEFGH' })
    prisma.inviteRedemption.count.mockResolvedValueOnce(20)
    prisma.user.update.mockResolvedValueOnce({})
    prisma.inviteRedemption.create.mockResolvedValueOnce({})
    const r = await svc.redeemOnRegister({ inviteeId: 'u2', inviteCode: 'XCABCDEFGH' })
    expect(r.inviterPoints).toBe(0)
    expect(points.refund).toHaveBeenCalledTimes(1) // invitee only
  })

  it('rejects self-invite', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u2', inviteCode: 'XCSELFCODE' })
    await expect(svc.redeemOnRegister({ inviteeId: 'u2', inviteCode: 'XCSELFCODE' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })
})
