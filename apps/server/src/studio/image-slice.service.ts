import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import {
  clampGridDims,
  equalSliceRects,
  GRID_SLICE_MAX_EDGE,
  maxEdge,
} from '@lnkpi/shared'
import sharp from 'sharp'
import { readImageBuffer } from '../media/upstream-ref-downscale'
import { UploadService } from '../upload/upload.service'

const SLICE_CONCURRENCY = 4

export type ImageSliceInput = {
  userId: string
  sourceUrl: string
  cols: number
  rows: number
  sessionId: string
}

export type ImageSliceResult = {
  urls: string[]
  cols: number
  rows: number
  width: number
  height: number
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++
      if (i >= items.length) return
      results[i] = await fn(items[i]!, i)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )
  return results
}

@Injectable()
export class ImageSliceService {
  constructor(@Inject(UploadService) private readonly upload: UploadService) {}

  async slice(input: ImageSliceInput): Promise<ImageSliceResult> {
    const { cols, rows } = clampGridDims(input.cols, input.rows)

    let buffer: Buffer
    try {
      buffer = await readImageBuffer(input.sourceUrl)
    } catch (err) {
      const message = err instanceof Error ? err.message : '无法读取源图'
      throw new BadRequestException(message)
    }

    const meta = await sharp(buffer).metadata()
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    if (!width || !height) {
      throw new BadRequestException('无法解析源图尺寸')
    }
    if (maxEdge(width, height) > GRID_SLICE_MAX_EDGE) {
      throw new BadRequestException(`图片过大（边长上限 ${GRID_SLICE_MAX_EDGE}px）`)
    }

    const rects = equalSliceRects(width, height, cols, rows)
    const urls = await mapWithConcurrency(rects, SLICE_CONCURRENCY, async (rect, index) => {
      const sliceBuf = await sharp(buffer)
        .extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h })
        .png()
        .toBuffer()
      const saved = await this.upload.saveUserFile(
        input.userId,
        sliceBuf,
        `slice-${index + 1}.png`,
        'image/png',
      )
      return saved.url
    })

    return { urls, cols, rows, width, height }
  }
}
