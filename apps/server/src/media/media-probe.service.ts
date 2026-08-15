import { Injectable } from '@nestjs/common'
import type { ProbedMediaFile } from '@lnkpi/shared'

const PROBE_TIMEOUT_MS = 10_000
const IMAGE_PROBE_BYTES = 64 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isImageMimeType(mimeType?: string): boolean {
  return mimeType?.startsWith('image/') ?? false
}

export function parsePngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null
  }
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') {
    return null
  }
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
}

function isJpegSofMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  )
}

export function parseJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return null
  }

  let i = 2
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }

    const marker = buf[i + 1]
    if (marker === 0xff) {
      i++
      continue
    }

    if (isJpegSofMarker(marker)) {
      if (i + 9 >= buf.length) {
        return null
      }
      const height = buf.readUInt16BE(i + 5)
      const width = buf.readUInt16BE(i + 7)
      if (width <= 0 || height <= 0) {
        return null
      }
      return { width, height }
    }

    if (marker === 0xd8 || marker === 0xd9) {
      i += 2
      continue
    }

    if (i + 3 >= buf.length) {
      return null
    }
    const segmentLength = buf.readUInt16BE(i + 2)
    if (segmentLength < 2) {
      return null
    }
    i += 2 + segmentLength
  }

  return null
}

function parseImageDimensions(buf: Buffer, mimeType?: string): { width: number; height: number } | null {
  if (mimeType === 'image/png' || buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return parsePngDimensions(buf)
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg' || (buf[0] === 0xff && buf[1] === 0xd8)) {
    return parseJpegDimensions(buf)
  }
  return parsePngDimensions(buf) ?? parseJpegDimensions(buf)
}

function parseContentLength(header: string | null): number | undefined {
  if (!header) {
    return undefined
  }
  const parsed = Number.parseInt(header, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

@Injectable()
export class MediaProbeService {
  async probeUrl(url: string): Promise<ProbedMediaFile> {
    const base: ProbedMediaFile = { url, probeStatus: 'pending' }

    try {
      const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS)
      const headResponse = await fetch(url, { method: 'HEAD', signal, redirect: 'follow' })

      if (!headResponse.ok) {
        return {
          ...base,
          probeStatus: 'failed',
          probeError: `HEAD ${headResponse.status} ${headResponse.statusText}`,
        }
      }

      const mimeType = headResponse.headers.get('content-type')?.split(';')[0]?.trim() || undefined
      const bytes = parseContentLength(headResponse.headers.get('content-length'))

      let width: number | undefined
      let height: number | undefined

      if (isImageMimeType(mimeType)) {
        const getResponse = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          redirect: 'follow',
          headers: { Range: `bytes=0-${IMAGE_PROBE_BYTES - 1}` },
        })

        if (!getResponse.ok && getResponse.status !== 206) {
          return {
            ...base,
            mimeType,
            bytes,
            probeStatus: 'failed',
            probeError: `GET ${getResponse.status} ${getResponse.statusText}`,
          }
        }

        const body = Buffer.from(await getResponse.arrayBuffer())
        const dimensions = parseImageDimensions(body, mimeType)
        if (!dimensions) {
          return {
            ...base,
            mimeType,
            bytes,
            probeStatus: 'failed',
            probeError: 'Unable to parse image dimensions',
          }
        }
        width = dimensions.width
        height = dimensions.height
      }

      return {
        url,
        probeStatus: 'ok',
        mimeType,
        bytes,
        width,
        height,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ...base,
        probeStatus: 'failed',
        probeError: message,
      }
    }
  }
}
