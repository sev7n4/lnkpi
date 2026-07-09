import { Body, Controller, Get, Post, Req, UseGuards, Inject } from '@nestjs/common'
import { IsString, Length, Matches } from 'class-validator'
import { AuthService } from './auth.service'
import { AuthGuard } from './auth.guard'

class SendCodeDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone!: string
}

class LoginDto {
  @IsString()
  @Matches(/^1\d{10}$/)
  phone!: string

  @IsString()
  @Length(4, 6)
  code!: string
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('send-code')
  sendCode(@Body() dto: SendCodeDto) {
    return this.authService.sendCode(dto.phone)
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const data = await this.authService.login(dto.phone, dto.code)
    return { code: 0, message: 'ok', data }
  }

  @Get('profile')
  @UseGuards(AuthGuard)
  async profile(@Req() req: { user: { sub: string } }) {
    const data = await this.authService.getProfile(req.user.sub)
    return { code: 0, message: 'ok', data }
  }
}
