import { Controller, Get, Inject, Param } from '@nestjs/common'
import { UsersService } from './users.service'

@Controller('users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  @Get(':id')
  async findCreator(@Param('id') id: string) {
    const data = await this.usersService.findCreator(id)
    return { code: 0, message: 'ok', data }
  }
}
