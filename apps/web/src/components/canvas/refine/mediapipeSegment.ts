export type MediaPipeSegmenterLike = {
  setImage(image: CanvasImageSource): void
  segment(strokes: unknown): {
    confidenceMasks?: Array<{
      getAsFloat32Array?: () => Float32Array
    }>
  } | void
}

export type MediaPipeDeps = {
  loadSegmenter: () => Promise<MediaPipeSegmenterLike>
}

type MediaPipeModuleLike = {
  FilesetResolver: {
    forVisionTasks(wasmRoot: string): Promise<unknown>
  }
  InteractiveSegmenter: {
    createFromOptions(
      fileset: unknown,
      options: {
        baseOptions: { modelAssetPath: string }
        outputCategoryMask: boolean
        outputConfidenceMasks: boolean
      },
    ): Promise<MediaPipeSegmenterLike>
  }
}

const WASM_ROOT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const PRIMARY_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float16/latest/magic_touch.tflite'
const FALLBACK_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task'

let segmenterPromise: Promise<MediaPipeSegmenterLike> | undefined
let cachedImageKey: string | undefined

export function confidenceMaskToRgba(
  confidence: Float32Array | number[],
  width: number,
  height: number,
  threshold = 0.5,
): Uint8ClampedArray {
  if (confidence.length !== width * height) {
    throw new Error('本地点选失败')
  }

  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < confidence.length; index += 1) {
    if (confidence[index] >= threshold) {
      const offset = index * 4
      rgba[offset] = 255
      rgba[offset + 1] = 255
      rgba[offset + 2] = 255
      rgba[offset + 3] = 255
    }
  }
  return rgba
}

async function createSegmenter(
  vision: MediaPipeModuleLike,
  fileset: unknown,
  modelAssetPath: string,
): Promise<MediaPipeSegmenterLike> {
  return vision.InteractiveSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath },
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  })
}

async function defaultLoadSegmenter(): Promise<MediaPipeSegmenterLike> {
  const vision = (await import(
    '@mediapipe/tasks-vision'
  )) as unknown as MediaPipeModuleLike
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT)

  try {
    return await createSegmenter(vision, fileset, PRIMARY_MODEL_URL)
  } catch {
    return createSegmenter(vision, fileset, FALLBACK_MODEL_URL)
  }
}

export function resetMediaPipeSegmentSession(): void {
  segmenterPromise = undefined
  cachedImageKey = undefined
}

function clampNormalized(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export async function segmentPointLocal(opts: {
  image: CanvasImageSource
  imageKey: string
  x: number
  y: number
  width: number
  height: number
  deps?: MediaPipeDeps
}): Promise<Uint8ClampedArray> {
  segmenterPromise ??= (opts.deps?.loadSegmenter ?? defaultLoadSegmenter)()
  const segmenter = await segmenterPromise

  if (cachedImageKey !== opts.imageKey) {
    segmenter.setImage(opts.image)
    cachedImageKey = opts.imageKey
  }

  const nx = clampNormalized((opts.x + 0.5) / opts.width)
  const ny = clampNormalized((opts.y + 0.5) / opts.height)
  const result = segmenter.segment([
    {
      isCompleted: true,
      brushMode: 'ADD',
      point: [{ x: nx, y: ny }],
    },
  ])
  const confidence = result?.confidenceMasks?.[0]?.getAsFloat32Array?.()

  if (!confidence || confidence.length !== opts.width * opts.height) {
    throw new Error('本地点选失败')
  }
  return confidenceMaskToRgba(confidence, opts.width, opts.height)
}
