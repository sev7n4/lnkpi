import { persistMediaUrl } from '@/composables/useMediaUpload'
import { clampGridDims, equalSliceRects, type SliceRect } from '@/utils/gridSlice'

export type LoadedSliceImage = {
  width: number
  height: number
  source?: CanvasImageSource
}

export type LoadSliceImageFn = (url: string) => Promise<LoadedSliceImage>
export type CropSliceFn = (
  image: LoadedSliceImage,
  rect: SliceRect,
  index: number,
) => File | Promise<File>
export type PersistSliceFn = (file: File, fallbackUrl: string) => Promise<string>

export type GridSliceNode = {
  id: string
  data?: Record<string, unknown>
}

export type RunGridSliceInput = {
  sourceUrl: string
  cols: number
  rows: number
  sourceNodeId: string
  getSourceNode: () => GridSliceNode | undefined
  addNode: (
    type: string,
    data: Record<string, unknown>,
    opts?: { id?: string; position?: { x: number; y: number } },
  ) => string
  addEdge: (edge: { id: string; source: string; target: string }) => void
  layoutChildren: (childIds: string[]) => void
  persist?: PersistSliceFn
  loadImage?: LoadSliceImageFn
  crop?: CropSliceFn
}

export type GridSliceResult = {
  urls: string[]
  nodeIds: string[]
}

/** Spec §6.2: reject oversized sources before canvas work. */
export const GRID_SLICE_MAX_EDGE = 8192

export type SliceImageToFilesDeps = {
  loadImage?: LoadSliceImageFn
  crop?: CropSliceFn
}

export function assertSliceImageWithinLimit(width: number, height: number): void {
  if (width > GRID_SLICE_MAX_EDGE || height > GRID_SLICE_MAX_EDGE) {
    throw new Error(`图片过大（边长上限 ${GRID_SLICE_MAX_EDGE}px）`)
  }
  if (width < 1 || height < 1) {
    throw new Error('无效图片尺寸')
  }
}

export async function defaultLoadSliceImage(url: string): Promise<LoadedSliceImage> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('image load failed'))
    el.src = url
  })
  return {
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    source: img,
  }
}

export async function defaultCropSlice(
  image: LoadedSliceImage,
  rect: SliceRect,
  index: number,
): Promise<File> {
  if (!image.source) throw new Error('image source unavailable')
  const canvas = document.createElement('canvas')
  canvas.width = rect.w
  canvas.height = rect.h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas context unavailable')
  ctx.drawImage(image.source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((next) => (next ? resolve(next) : reject(new Error('crop failed'))), 'image/png')
  })
  return new File([blob], `slice-${index + 1}.png`, { type: 'image/png' })
}

async function defaultPersistSlice(file: File, fallbackUrl: string): Promise<string> {
  return persistMediaUrl(file, fallbackUrl)
}

function blobFallbackUrl(file: File): string {
  if (typeof URL.createObjectURL === 'function') return URL.createObjectURL(file)
  return ''
}

function sourceLabel(node: GridSliceNode | undefined): string {
  const data = node?.data ?? {}
  const label = data.label ?? data.title
  return typeof label === 'string' && label.trim() ? label : '图片'
}

export async function sliceImageToFiles(
  sourceUrl: string,
  cols: number,
  rows: number,
  deps: SliceImageToFilesDeps = {},
): Promise<File[]> {
  const loadImage = deps.loadImage ?? defaultLoadSliceImage
  const crop = deps.crop ?? defaultCropSlice
  const image = await loadImage(sourceUrl)
  assertSliceImageWithinLimit(image.width, image.height)
  const dims = clampGridDims(cols, rows)
  const rects = equalSliceRects(image.width, image.height, dims.cols, dims.rows)
  const files: File[] = []
  for (let i = 0; i < rects.length; i++) {
    files.push(await crop(image, rects[i], i))
  }
  return files
}

export async function runGridSlice(input: RunGridSliceInput): Promise<GridSliceResult> {
  const dims = clampGridDims(input.cols, input.rows)
  const files = await sliceImageToFiles(input.sourceUrl, dims.cols, dims.rows, {
    loadImage: input.loadImage,
    crop: input.crop,
  })

  const persist = input.persist ?? defaultPersistSlice
  const urls: string[] = []
  for (const file of files) {
    urls.push(await persist(file, blobFallbackUrl(file)))
  }

  const labelBase = sourceLabel(input.getSourceNode())
  const nodeIds: string[] = []
  for (let i = 0; i < urls.length; i++) {
    const id = input.addNode('image', {
      url: urls[i],
      status: 'completed',
      label: `${labelBase} · 格${i + 1}`,
      gridSlice: {
        sourceNodeId: input.sourceNodeId,
        index: i,
        cols: dims.cols,
        rows: dims.rows,
      },
    })
    input.addEdge({
      id: `e-${input.sourceNodeId}-${id}`,
      source: input.sourceNodeId,
      target: id,
    })
    nodeIds.push(id)
  }

  input.layoutChildren(nodeIds)
  return { urls, nodeIds }
}

export function useGridSlice() {
  return { runGridSlice, sliceImageToFiles }
}
