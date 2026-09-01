import { Body, Controller, Get, Inject, Post, Query, Req, UseGuards } from '@nestjs/common'
import { IsString } from 'class-validator'
import { AuthGuard } from '../auth/auth.guard'
import { PointsRangeKey } from '../points/points-range'
import { MembershipService, PointCategory, PointKind } from './membership.service'

class UpgradeDto {
  @IsString()
  plan!: string
}

function parseRange(range: string): PointsRangeKey {
  return range === '7d' || range === 'all' || range === 'month' ? range : 'month'
}

const DEFAULT_TRANSACTIONS_LIMIT = 50
const MAX_TRANSACTIONS_LIMIT = 100

export function parseLimit(raw?: string): number {
  if (raw == null || raw === '') return DEFAULT_TRANSACTIONS_LIMIT
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return DEFAULT_TRANSACTIONS_LIMIT
  return Math.min(n, MAX_TRANSACTIONS_LIMIT)
}

@Controller('membership')
export class MembershipController {
  constructor(@Inject(MembershipService) private readonly membershipService: MembershipService) {}

  @Get('plans')
  getPlans() {
    const data = this.membershipService.getPlans()
    return { code: 0, message: 'ok', data }
  }

  @Get('points')
  @UseGuards(AuthGuard)
  async getPoints(@Req() req: { user: { sub: string } }) {
    const data = await this.membershipService.getPoints(req.user.sub)
    return { code: 0, message: 'ok', data }
  }

  @Post('claim-daily')
  @UseGuards(AuthGuard)
  async claimDaily(@Req() req: { user: { sub: string } }) {
    const data = await this.membershipService.claimDaily(req.user.sub)
    return { code: 0, message: 'ok', data }
  }

  @Post('upgrade')
  @UseGuards(AuthGuard)
  async upgrade(@Req() req: { user: { sub: string } }, @Body() dto: UpgradeDto) {
    const data = await this.membershipService.upgrade(req.user.sub, dto.plan)
    return { code: 0, message: 'ok', data }
  }

  @Get('transactions')
  @UseGuards(AuthGuard)
  async transactions(
    @Req() req: { user: { sub: string } },
    @Query('range') range = 'month',
    @Query('kind') kind?: PointKind,
    @Query('category') category?: PointCategory,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.membershipService.listTransactions(req.user.sub, {
      range: parseRange(range),
      kind,
      category,
      cursor,
      limit: parseLimit(limit),
    })
    return { code: 0, message: 'ok', data }
  }

  @Get('points-summary')
  @UseGuards(AuthGuard)
  async pointsSummary(
    @Req() req: { user: { sub: string } },
    @Query('range') range = 'month',
  ) {
    const data = await this.membershipService.pointsSummary(req.user.sub, parseRange(range))
    return { code: 0, message: 'ok', data }
  }
}
