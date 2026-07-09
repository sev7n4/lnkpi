import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common'
import { IsString } from 'class-validator'
import { AuthGuard } from '../auth/auth.guard'
import { MembershipService } from './membership.service'

class UpgradeDto {
  @IsString()
  plan!: string
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
}
