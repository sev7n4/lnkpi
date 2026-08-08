import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import { Request, Response } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import {
  contentDispositionAttachment,
  MediaService,
  openDownloadStream,
} from './media.service'

type AuthedRequest = Request & { user: { sub: string; phone: string } }

class StreamDownloadQueryDto {
  @IsString()
  @MaxLength(4096)
  url!: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  filename?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string
}

@Controller('media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly mediaService: MediaService) {}

  @Get('stream-download')
  @UseGuards(AuthGuard)
  async streamDownload(
    @Query() query: StreamDownloadQueryDto,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    const source = await this.mediaService.resolveDownloadSource(
      req.user.sub,
      query.url,
      query.filename,
      query.sessionId,
    )
    const { body, contentType, contentLength } = await openDownloadStream(source)

    res.setHeader('Content-Disposition', contentDispositionAttachment(source.filename))
    if (contentType) res.setHeader('Content-Type', contentType.split(';')[0]?.trim())
    else res.setHeader('Content-Type', 'application/octet-stream')
    if (contentLength) res.setHeader('Content-Length', String(contentLength))

    body.on('error', () => {
      if (!res.headersSent) {
        res.status(502).end()
      } else {
        res.destroy()
      }
    })
    body.pipe(res)
  }
}
