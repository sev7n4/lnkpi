import { IsIn, IsOptional, IsString, MinLength } from 'class-validator'

export class CancelRunDto {
  @IsString()
  @MinLength(1)
  threadId!: string

  @IsString()
  @MinLength(1)
  sessionId!: string

  @IsOptional()
  @IsIn(['user', 'timeout'])
  reason?: 'user' | 'timeout'
}
