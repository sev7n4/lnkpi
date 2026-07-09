import { Module } from '@nestjs/common'
import { MembershipController } from './membership.controller'
import { MembershipService } from './membership.service'

@Module({
  controllers: [MembershipController],
  providers: [MembershipService],
})
export class MembershipModule {}
