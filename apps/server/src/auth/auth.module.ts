import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PointsModule } from '../points/points.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { CaptchaService } from './captcha.service'
import { InviteService } from './invite.service'

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'dev-secret',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
    }),
    PointsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, CaptchaService, InviteService],
  exports: [AuthService],
})
export class AuthModule {}
