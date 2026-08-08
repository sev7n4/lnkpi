import { readFile } from 'fs/promises'
import { extname, join } from 'path'
import { needsUpstreamRefInline, parseUploadRefPath } from '@lnkpi/shared'

const UPLOADS_ROOT = join(process.cwd(), 'uploads')
const MAX_INLINE_BYTES = 15 * 1024 * 1024

function mimeFromFileName(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.png':
    default:
      return 'image/png'
  }
}

function toDataUrl(buffer: Buffer, mimeType: string): string {
  if (buffer.length > MAX_INLINE_BYTES) {
    throw new Error(`参考图过大（>${Math.floor(MAX_INLINE_BYTES / 1024 / 1024)}MB），无法内联传给上游`)
  }
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

async function readUploadAsDataUrl(userId: string, fileName: string): Promise<string> {
  const absPath = join(UPLOADS_ROOT, userId, fileName)
  const buffer = await readFile(absPath)
  return toDataUrl(buffer, mimeFromFileName(fileName))
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`参考图下载失败 (${res.status}): ${url}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
  return toDataUrl(buffer, mimeType)
}

async function inlineOne(url: string): Promise<string> {
  const upload = parseUploadRefPath(url)
  if (upload) {
    try {
      return await readUploadAsDataUrl(upload.userId, upload.fileName)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`读取本地上传参考图失败 (${url}): ${msg}`)
    }
  }
  return fetchAsDataUrl(url)
}

/** Inline refs that upstream image APIs cannot fetch (lnkpi uploads, :8888, loopback, etc.). */
export async function inlineUpstreamReferenceImages(urls: string[]): Promise<string[]> {
  return Promise.all(
    urls.map(async (url) => {
      const trimmed = url.trim()
      if (!trimmed || !needsUpstreamRefInline(trimmed)) return trimmed
      return inlineOne(trimmed)
    }),
  )
}
