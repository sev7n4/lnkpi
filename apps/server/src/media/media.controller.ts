import {
  Controller,
  ForbiddenException,
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
import { assertSafeOutboundUrl } from '../provider/ssrf'
import {
  contentDispositionAttachment,
  MediaService,
  openDownloadStream,
} from './media.service'

/**
 * 生成图同源代理白名单（2026-09-25 CORS 修复）。
 *
 * 生成记录 url 直接透传 provider 外部地址（platform-outputs.agnes-ai.space 等），
 * 这些域不返回 ACAO 头 → 前端 canvas 像素读取（裁剪 / 扩图 / 局部重绘 / 蒙版导出）
 * crossOrigin 加载全部失败。代理端点让前端把外部媒体 URL 折叠为同源路径。
 * 默认白名单可用 MEDIA_PROXY_ALLOWED_HOSTS（逗号分隔，支持子域后缀）扩展。
 */
const DEFAULT_PROXY_HOSTS = [
  'platform-outputs.agnes-ai.space',
  'cos-platform-outputs.agnes-ai.cn',
]

export function readProxyAllowedHosts(): string[] {
  const raw = process.env.MEDIA_PROXY_ALLOWED_HOSTS?.trim()
  const extra = raw
    ? raw
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
    : []
  return [...new Set([...DEFAULT_PROXY_HOSTS, ...extra])]
}

export function isHostAllowedForProxy(hostname: string, allowed?: string[]): boolean {
  const host = hostname.toLowerCase()
  return (allowed ?? readProxyAllowedHosts()).some(
    (entry) => host === entry || host.endsWith(`.${entry}`),
  )
}

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

class ProxyQueryDto {
  @IsString()
  @MaxLength(2048)
  url!: string
}

@Controller('media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly mediaService: MediaService) {}

  /**
   * 免登录同源媒体代理（白名单域）：img / canvas 跨域加载无法携带 Authorization，
   * 防滥用靠 host 白名单 + 仅允许 https + 上游响应必须为图片。
   */
  @Get('proxy')
  async proxy(@Query() query: ProxyQueryDto, @Res() res: Response) {
    let parsed: URL
    try {
      parsed = new URL(query.url)
    } catch {
      throw new ForbiddenException('url 非法')
    }
    if (parsed.protocol !== 'https:' || !isHostAllowedForProxy(parsed.hostname)) {
      throw new ForbiddenException('该媒体域不在代理白名单')
    }
    assertSafeOutboundUrl(parsed.href)

    const { body, contentType, contentLength } = await openDownloadStream({
      kind: 'remote',
      fetchUrl: parsed.href,
      filename: 'media',
    })
    if (!contentType?.startsWith('image/')) {
      body.destroy()
      throw new ForbiddenException('代理仅支持图片资源')
    }

    res.setHeader('Content-Type', contentType.split(';')[0]?.trim() || 'image/png')
    if (contentLength) res.setHeader('Content-Length', String(contentLength))
    res.setHeader('Cache-Control', 'public, max-age=86400')
    body.on('error', () => {
      if (!res.headersSent) res.status(502).end()
      else res.destroy()
    })
    body.pipe(res)
  }

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
