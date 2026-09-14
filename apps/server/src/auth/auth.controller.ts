import { Body, Controller, Get, HttpCode, Post, Req, UseGuards, Inject } from '@nestjs/common'
import { IsNumber, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator'
import { AuthService } from './auth.service'
import { AuthGuard } from './auth.guard'
import { CaptchaService } from './captcha.service'

class SendCodeDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone!: string

  @IsOptional()
  @IsString()
  captchaTicket?: string
}

class CaptchaVerifyDto {
  @IsString()
  challengeId!: string

  @IsNumber()
  offsetX!: number
}

class LoginDto {
  @IsString()
  @Matches(/^1\d{10}$/)
  phone!: string

  @IsString()
  @Length(4, 6)
  code!: string
}

class RegisterDto {
  @IsString()
  @Matches(/^1\d{10}$/)
  phone!: string

  @IsString()
  @Length(4, 6)
  code!: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  inviteCode?: string
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(CaptchaService) private readonly captchaService: CaptchaService,
  ) {}

  @Get('config')
  getConfig() {
    const data = this.authService.getPublicConfig()
    return { code: 0, message: 'ok', data }
  }

  @Post('captcha/challenge')
  @HttpCode(200)
  async createCaptcha() {
    const data = await this.captchaService.createChallenge()
    return { code: 0, message: 'ok', data }
  }

  @Post('captcha/verify')
  @HttpCode(200)
  verifyCaptcha(@Body() dto: CaptchaVerifyDto) {
    const data = this.captchaService.verifySlide(dto.challengeId, dto.offsetX)
    return { code: 0, message: 'ok', data }
  }

  @Post('send-code')
  @HttpCode(200)
  async sendCode(@Body() dto: SendCodeDto) {
    const data = await this.authService.sendCode(dto.phone, dto.captchaTicket)
    return { code: 0, message: 'ok', data }
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto) {
    const data = await this.authService.login(dto.phone, dto.code)
    return { code: 0, message: 'ok', data }
  }

  @Post('register')
  @HttpCode(200)
  async register(@Body() dto: RegisterDto) {
    const data = await this.authService.register(dto.phone, dto.code, dto.inviteCode)
    return { code: 0, message: 'ok', data }
  }

  @Get('profile')
  @UseGuards(AuthGuard)
  async profile(@Req() req: { user: { sub: string } }) {
    const data = await this.authService.getProfile(req.user.sub)
    return { code: 0, message: 'ok', data }
  }
}
