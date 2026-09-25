import {
  classifyRefSize,
  maxEdge,
  parseUploadRefPath,
  VIDEO_REF_WARN_MAX_EDGE,
  type ProbedMediaFile,
} from '@lnkpi/shared'
import sharp from 'sharp'
import { readFile } from 'fs/promises'
import { join } from 'path'

const UPLOADS_ROOT = join(process.cwd(), 'uploads')

function mimeFromBuffer(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg'
  }
  return 'image/jpeg'
}

function toDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

export async function readImageBuffer(url: string): Promise<Buffer> {
  const upload = parseUploadRefPath(url)
  if (upload) {
    return readFile(join(UPLOADS_ROOT, upload.userId, upload.fileName))
  }
  // 出站链路（代理/DNS）偶发瞬断表现为裸「fetch failed」：网络层错误带退避重试（上限 3 次）
  // 并在最终失败时透出底层 cause 便于诊断。HTTP 状态错误（404/403 等）不重试——语义确定，
  // 重试只会白等（视频预检拒绝路径会调到这里，重试会把 5s 测试/响应预算吃穿）。
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 300 * attempt))
    }
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      lastErr = err
      continue
    }
    if (!res.ok) {
      throw new Error(`参考图下载失败 (${res.status}): ${url}`)
    }
    try {
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      lastErr = err
    }
  }
  const cause = lastErr instanceof Error ? [lastErr.message, (lastErr as { cause?: { code?: string; message?: string } }).cause?.code, (lastErr as { cause?: { code?: string; message?: string } }).cause?.message].filter(Boolean).join(' | ') : String(lastErr)
  throw new Error(`参考图下载失败（重试 3 次仍失败）: ${url} — ${cause}`)
}

export async function downscaleImageBuffer(
  input: Buffer,
  maxEdgePx = VIDEO_REF_WARN_MAX_EDGE,
): Promise<{ buffer: Buffer; width: number; height: number; changed: boolean }> {
  const meta = await sharp(input).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height || maxEdge(width, height) <= maxEdgePx) {
    return { buffer: input, width, height, changed: false }
  }
  const output = await sharp(input)
    .rotate()
    .resize({
      width: maxEdgePx,
      height: maxEdgePx,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()
  const outMeta = await sharp(output).metadata()
  return {
    buffer: output,
    width: outMeta.width ?? width,
    height: outMeta.height ?? height,
    changed: true,
  }
}

export interface DownscaleReferenceResult {
  urls: string[]
  changed: boolean
  probed: Array<ProbedMediaFile & { refKey?: string }>
}

/** Downscale refs exceeding warn/error thresholds to max 2048 long edge, return data URLs when changed. */
export async function downscaleOversizedReferenceImages(
  refs: Array<{ url: string; refKey?: string }>,
  maxEdgePx = VIDEO_REF_WARN_MAX_EDGE,
): Promise<DownscaleReferenceResult> {
  let changed = false
  const urls: string[] = []
  const probed: Array<ProbedMediaFile & { refKey?: string }> = []

  for (const ref of refs) {
    const url = ref.url.trim()
    if (!url) {
      urls.push(url)
      probed.push({ url, refKey: ref.refKey, probeStatus: 'failed', probeError: 'empty url' })
      continue
    }
    if (url.startsWith('data:')) {
      urls.push(url)
      probed.push({ url, refKey: ref.refKey, probeStatus: 'ok' })
      continue
    }

    try {
      const input = await readImageBuffer(url)
      const meta = await sharp(input).metadata()
      const width = meta.width
      const height = meta.height
      const bytes = input.length
      const level = classifyRefSize({ width, height, bytes })
      if (level === 'none') {
        urls.push(url)
        probed.push({
          url,
          refKey: ref.refKey,
          width,
          height,
          bytes,
          mimeType: meta.format ? `image/${meta.format}` : mimeFromBuffer(input),
          probeStatus: 'ok',
        })
        continue
      }

      const downscaled = await downscaleImageBuffer(input, maxEdgePx)
      if (!downscaled.changed) {
        urls.push(url)
        probed.push({
          url,
          refKey: ref.refKey,
          width: downscaled.width,
          height: downscaled.height,
          bytes,
          probeStatus: 'ok',
        })
        continue
      }

      changed = true
      const dataUrl = toDataUrl(downscaled.buffer, 'image/jpeg')
      urls.push(dataUrl)
      probed.push({
        url: dataUrl,
        refKey: ref.refKey,
        width: downscaled.width,
        height: downscaled.height,
        bytes: downscaled.buffer.length,
        mimeType: 'image/jpeg',
        probeStatus: 'ok',
      })
    } catch (err) {
      urls.push(url)
      probed.push({
        url,
        refKey: ref.refKey,
        probeStatus: 'failed',
        probeError: err instanceof Error ? err.message : 'downscale failed',
      })
    }
  }

  return { urls, changed, probed }
}
