import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common'
import { createReadStream, existsSync } from 'fs'
import { stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import { Readable } from 'stream'
import { parseUploadRefPath, resolvePublicMediaUrl } from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { assertSafeOutboundUrl } from '../provider/ssrf'

const UPLOADS_ROOT = join(process.cwd(), 'uploads')
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024

export type DownloadSource =
  | { kind: 'disk'; absPath: string; filename: string; mimeType?: string }
  | { kind: 'remote'; fetchUrl: string; filename: string }

@Injectable()
export class MediaService {
  private readonly publicBase = process.env.API_PUBLIC_URL?.replace(/\/$/, '') ?? ''

  constructor(private readonly prisma: PrismaService) {}

  async resolveDownloadSource(
    userId: string,
    rawUrl: string,
    filenameHint?: string,
    sessionId?: string,
  ): Promise<DownloadSource> {
    const trimmed = rawUrl?.trim()
    if (!trimmed) throw new BadRequestException('缺少 url')

    const normalized = resolvePublicMediaUrl(trimmed, { publicBase: this.publicBase })
    const upload = parseUploadRefPath(normalized)
    if (upload) {
      if (upload.userId !== userId) {
        throw new ForbiddenException('无权下载该上传文件')
      }
      const absPath = join(UPLOADS_ROOT, upload.userId, upload.fileName)
      if (!existsSync(absPath)) {
        throw new NotFoundException('文件不存在')
      }
      const size = (await stat(absPath)).size
      if (size > MAX_DOWNLOAD_BYTES) {
        throw new PayloadTooLargeException('文件过大')
      }
      return {
        kind: 'disk',
        absPath,
        filename: sanitizeFilename(filenameHint || upload.fileName),
        mimeType: mimeFromExt(upload.fileName),
      }
    }

    let fetchUrl = normalized
    if (fetchUrl.startsWith('/')) {
      if (!this.publicBase) {
        throw new BadRequestException('无法解析相对媒体地址')
      }
      fetchUrl = `${this.publicBase}${fetchUrl}`
    }

    assertSafeOutboundUrl(fetchUrl)
    await this.assertUrlOwnedByUser(userId, trimmed, normalized, sessionId)

    return {
      kind: 'remote',
      fetchUrl,
      filename: sanitizeFilename(filenameHint || filenameFromUrl(fetchUrl)),
    }
  }

  private async assertUrlOwnedByUser(
    userId: string,
    rawUrl: string,
    normalizedUrl: string,
    sessionId?: string,
  ) {
    const candidates = new Set<string>([rawUrl, normalizedUrl])
    if (this.publicBase) {
      candidates.add(resolvePublicMediaUrl(rawUrl, { publicBase: this.publicBase }))
    }

    const owned = await this.collectOwnedUrls(userId, sessionId)
    for (const candidate of candidates) {
      if (owned.has(candidate)) return
    }
    throw new ForbiddenException('该媒体不在当前账号画布中')
  }

  private async collectOwnedUrls(userId: string, sessionId?: string): Promise<Set<string>> {
    const urls = new Set<string>()

    const sessions = sessionId
      ? await this.prisma.session.findMany({ where: { id: sessionId, userId } })
      : await this.prisma.session.findMany({
          where: { userId },
          select: { canvasData: true },
        })

    for (const session of sessions) {
      collectUrlsFromCanvasData(session.canvasData).forEach((u) => urls.add(u))
    }

    const materials = await this.prisma.material.findMany({
      where: {
        shot: { session: sessionId ? { id: sessionId, userId } : { userId } },
        url: { not: null },
      },
      select: { url: true, metadata: true },
    })
    for (const material of materials) {
      if (material.url) urls.add(material.url)
      collectUrlsFromMetadata(material.metadata).forEach((u) => urls.add(u))
    }

    const records = await this.prisma.generationRecord.findMany({
      where: sessionId ? { userId, sessionId } : { userId },
      select: { url: true, metadata: true },
    })
    for (const record of records) {
      if (record.url) urls.add(record.url)
      collectUrlsFromMetadata(record.metadata).forEach((u) => urls.add(u))
    }

    const expanded = new Set<string>()
    for (const url of urls) {
      expanded.add(url)
      expanded.add(resolvePublicMediaUrl(url, { publicBase: this.publicBase }))
    }
    return expanded
  }
}

export function collectUrlsFromCanvasData(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as { nodes?: Array<{ data?: Record<string, unknown> }> }
    const urls: string[] = []
    for (const node of data.nodes ?? []) {
      const payload = node.data ?? {}
      const url = payload.url
      if (typeof url === 'string' && url.trim()) urls.push(url.trim())
      const images = payload.images
      if (Array.isArray(images)) {
        for (const item of images) {
          if (typeof item === 'string' && item.trim()) urls.push(item.trim())
        }
      }
    }
    return urls
  } catch {
    return []
  }
}

export function collectUrlsFromMetadata(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const meta = JSON.parse(raw) as Record<string, unknown>
    const urls: string[] = []
    if (typeof meta.url === 'string' && meta.url.trim()) urls.push(meta.url.trim())
    if (Array.isArray(meta.urls)) {
      for (const item of meta.urls) {
        if (typeof item === 'string' && item.trim()) urls.push(item.trim())
      }
    }
    if (Array.isArray(meta.referenceImages)) {
      for (const item of meta.referenceImages) {
        if (typeof item === 'string' && item.trim()) urls.push(item.trim())
      }
    }
    return urls
  } catch {
    return []
  }
}

export function sanitizeFilename(name: string): string {
  const base = basename(name).replace(/[^\w.\-()\u4e00-\u9fff\s]+/g, '_').trim()
  return base.slice(0, 180) || 'download.bin'
}

export function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : 'download.bin'
  } catch {
    return 'download.bin'
  }
}

export function mimeFromExt(fileName: string): string | undefined {
  switch (extname(fileName).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    default:
      return undefined
  }
}

/** RFC 5987: `filename=` must be ASCII; CJK and symbols go in `filename*=` only. */
export function contentDispositionAttachment(filename: string): string {
  const safe = sanitizeFilename(filename)
  const asciiFallback =
    safe.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_').trim() || 'download.bin'
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`
}

export async function openDownloadStream(
  source: DownloadSource,
): Promise<{ body: Readable; contentType?: string; contentLength?: number }> {
  if (source.kind === 'disk') {
    const size = (await stat(source.absPath)).size
    return {
      body: createReadStream(source.absPath),
      contentType: source.mimeType,
      contentLength: size,
    }
  }

  const upstream = await fetch(source.fetchUrl)
  if (!upstream.ok) {
    throw new BadRequestException(`上游资源不可达 (${upstream.status})`)
  }
  const contentLength = upstream.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_DOWNLOAD_BYTES) {
    throw new PayloadTooLargeException('文件过大')
  }
  if (!upstream.body) {
    throw new BadRequestException('上游响应为空')
  }
  return {
    body: Readable.fromWeb(upstream.body as import('stream/web').ReadableStream),
    contentType: upstream.headers.get('content-type') ?? undefined,
    contentLength: contentLength ? Number(contentLength) : undefined,
  }
}

export { MAX_DOWNLOAD_BYTES }
