import type { VideoGenerationMode, VideoRefWire } from '@lnkpi/shared'
import { isAgnesVideo25Family, isAgnesVideo25FlashModel } from '@lnkpi/shared'
import { FalH3MaxVideoProvider } from './fal-h3-max-video-provider'
import {
  MiniMaxH3VideoProvider,
  isMiniMaxBaseUrl,
  isMiniMaxH3Model,
} from './minimax-h3-video-provider'

export interface VideoGenerateOptions {
  model?: string
  videoMode?: VideoGenerationMode
  duration?: number
  aspectRatio?: string
  resolution?: string
  crop?: string
  image?: string
  seed?: number
  negativePrompt?: string
  generateAudio?: boolean
  returnLastFrame?: boolean
  referenceImages?: string[]
  referenceVideos?: string[]
  referenceAudios?: string[]
  imageWithRoles?: Array<{ url: string; role: string }>
  refWire?: VideoRefWire
  pollIntervalMs?: number
  maxPollMs?: number
}

export interface VideoProvider {
  generate(prompt: string, options?: VideoGenerateOptions): Promise<{ url: string; lastFrameUrl?: string }>
}

export class PlaceholderVideoProvider implements VideoProvider {
  private urls = [
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1024&q=80',
    'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=1024&q=80',
  ]

  async generate(_prompt: string): Promise<{ url: string }> {
    await new Promise((r) => setTimeout(r, 1500))
    return { url: this.urls[Math.floor(Math.random() * this.urls.length)] }
  }
}

/** OpenAI 暂无公开 video API，此处预留兼容层：有 Key 时仍走 placeholder 并标注 */
export class OpenAIVideoProvider implements VideoProvider {
  constructor(private fallback: VideoProvider = new PlaceholderVideoProvider()) {}

  async generate(prompt: string, options?: VideoGenerateOptions): Promise<{ url: string }> {
    console.log(`[VideoProvider] model=${options?.model} duration=${options?.duration} prompt=${prompt.slice(0, 50)}`)
    return this.fallback.generate(prompt, options)
  }
}

class UnsupportedVideoGatewayProvider implements VideoProvider {
  constructor(private baseUrl?: string) {}

  async generate(): Promise<{ url: string }> {
    throw new Error(`unsupported video gateway: ${this.baseUrl}`)
  }
}

interface AgnesVideoCreateResponse {
  video_id?: string
  task_id?: string
  status?: string
}

interface AgnesVideoPollResponse {
  status?: string
  url?: string
  error?: unknown
  metadata?: { url?: string }
}

/** Agnes 异步视频：POST /v1/videos → 轮询 /agnesapi?video_id= */
export class AgnesVideoProvider implements VideoProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://apihub.agnes-ai.com/v1',
    private apiRoot = 'https://apihub.agnes-ai.com',
    private defaultModel = 'agnes-video-v2.0',
    private pollIntervalMs = 5000,
    private maxPollAttempts = 120,
  ) {}

  async generate(prompt: string, options?: VideoGenerateOptions): Promise<{ url: string }> {
    const model = options?.model || this.defaultModel
    const refs = (options?.referenceImages ?? []).map((url) => url.trim()).filter(Boolean)
    const body = isAgnesVideo25Family(model)
      ? buildAgnes25VideoBody(prompt, model, refs, options)
      : buildAgnesV20VideoBody(prompt, model, refs, options)

    const createRes = await fetch(`${this.baseUrl}/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!createRes.ok) {
      throw new Error(`Agnes video create ${createRes.status}: ${await createRes.text()}`)
    }

    const created = (await createRes.json()) as AgnesVideoCreateResponse
    const videoId = created.video_id
    if (!videoId) {
      throw new Error(`Agnes video create: missing video_id (${JSON.stringify(created)})`)
    }

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      if (attempt > 0) await sleep(this.pollIntervalMs)

      const pollUrl = `${this.apiRoot}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(model)}`
      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      if (!pollRes.ok) continue

      const result = (await pollRes.json()) as AgnesVideoPollResponse
      const url = result.url ?? result.metadata?.url
      if (result.status === 'completed' && url) {
        return { url }
      }
      if (result.status === 'failed') {
        throw new Error(`Agnes video failed: ${JSON.stringify(result.error ?? result)}`)
      }
    }

    throw new Error(`Agnes video timed out after ${this.maxPollAttempts} polls`)
  }
}

function collectAgnesImageRefs(refs: string[], options?: VideoGenerateOptions): string[] {
  const out: string[] = []
  const add = (url?: string) => {
    const trimmed = url?.trim()
    if (trimmed && !out.includes(trimmed)) out.push(trimmed)
  }
  add(options?.image)
  for (const url of refs) add(url)
  return out
}

function agnes25Size(model: string, resolution?: string): string {
  if (isAgnesVideo25FlashModel(model)) return '720P'
  const lower = (resolution ?? '720p').toLowerCase()
  if (lower.includes('1080') || lower.includes('2k') || lower.includes('4k')) return '1080P'
  return '720P'
}

function agnes25Seconds(duration?: number): string {
  const raw = duration ?? 5
  return String(Math.min(12, Math.max(4, Math.round(raw))))
}

function buildAgnes25VideoBody(
  prompt: string,
  model: string,
  refs: string[],
  options?: VideoGenerateOptions,
): Record<string, unknown> {
  const images = collectAgnesImageRefs(refs, options)
  const useKeyframe =
    images.length >= 2 &&
    (options?.refWire === 'agnes_keyframes' ||
      options?.videoMode === 'first_last_frame' ||
      options?.videoMode !== 'reference_to_video')

  const body: Record<string, unknown> = {
    model,
    prompt,
    seconds: agnes25Seconds(options?.duration),
    mode: 'text',
    size: agnes25Size(model, options?.resolution),
    aspect_ratio: options?.aspectRatio?.trim() || '16:9',
  }

  if (useKeyframe) {
    body.mode = 'keyframe'
    body.first_frame = images[0]
    body.last_frame = images[images.length - 1]
  } else if (images.length >= 1) {
    body.mode = 'reference'
    const max = isAgnesVideo25FlashModel(model) ? 5 : images.length
    body.images = images.slice(0, max)
  }

  if (options?.seed != null) body.seed = options.seed
  return body
}

function buildAgnesV20VideoBody(
  prompt: string,
  model: string,
  refs: string[],
  options?: VideoGenerateOptions,
): Record<string, unknown> {
  const { width, height, num_frames, frame_rate } = resolveVideoParams(
    options?.duration,
    options?.aspectRatio,
    options?.resolution,
  )
  const body: Record<string, unknown> = {
    model,
    prompt,
    width,
    height,
    num_frames,
    frame_rate,
  }
  const useKeyframes = options?.refWire === 'agnes_keyframes' || refs.length >= 2
  if (useKeyframes && refs.length >= 2) {
    body.extra_body = { image: refs, mode: 'keyframes' }
  } else if (options?.image) {
    body.image = options.image
  } else if (refs.length === 1) {
    body.image = refs[0]
  }
  if (options?.seed != null) body.seed = options.seed
  if (options?.negativePrompt) body.negative_prompt = options.negativePrompt
  return body
}

function isGatewayHost(hostname: string, allowedRoots: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return allowedRoots.some((root) => {
    const r = root.toLowerCase()
    return host === r || host.endsWith(`.${r}`)
  })
}

function hostnameFromBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl?.trim()) return undefined
  try {
    return new URL(baseUrl).hostname
  } catch {
    return undefined
  }
}

function isApimartBaseUrl(baseUrl?: string): boolean {
  const hostname = hostnameFromBaseUrl(baseUrl)
  return Boolean(hostname && isGatewayHost(hostname, ['apimart.ai']))
}

function extractApimartTaskId(json: unknown): string | undefined {
  const data = (json as { data?: unknown[] }).data
  const first = Array.isArray(data) ? data[0] : undefined
  return (first as { task_id?: string })?.task_id
}

function pickFirstUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickFirstUrl(item)
      if (picked) return picked
    }
  }
  return undefined
}

function extractApimartVideoUrl(data: unknown): string | undefined {
  const result = (data as {
    result?: { video_url?: unknown; url?: unknown; videos?: Array<{ url?: unknown }> }
  }).result
  return (
    pickFirstUrl(result?.video_url) ??
    pickFirstUrl(result?.url) ??
    pickFirstUrl(result?.videos?.[0]?.url) ??
    pickFirstUrl((data as { url?: unknown }).url)
  )
}

/** APIMart 异步视频：POST /v1/videos/generations → 轮询 /tasks/{task_id} */
export class ApimartVideoProvider implements VideoProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.apimart.ai/v1',
    private pollIntervalMs = 8_000,
    private maxPollMs = 600_000,
  ) {}

  async generate(
    prompt: string,
    options?: VideoGenerateOptions,
  ): Promise<{ url: string; lastFrameUrl?: string }> {
    const root = this.baseUrl.replace(/\/$/, '')
    const body: Record<string, unknown> = {
      model: options?.model ?? 'doubao-seedance-2.0-mini',
      prompt,
      duration: options?.duration ?? 5,
      size: options?.aspectRatio ?? '16:9',
      resolution: options?.resolution ?? '720p',
      generate_audio: options?.generateAudio ?? true,
    }
    if (options?.seed != null) body.seed = options.seed
    if (options?.returnLastFrame) body.return_last_frame = true
    if (options?.imageWithRoles?.length) {
      body.image_with_roles = options.imageWithRoles
    } else if (options?.referenceImages?.length) {
      body.image_urls = options.referenceImages
    }
    if (options?.referenceVideos?.length) body.video_urls = options.referenceVideos
    if (options?.referenceAudios?.length) body.audio_urls = options.referenceAudios

    const createRes = await fetch(`${root}/videos/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    })
    if (!createRes.ok) throw new Error(`Apimart video create ${createRes.status}: ${await createRes.text()}`)

    const created = await createRes.json()
    const taskId = extractApimartTaskId(created)
    if (!taskId) throw new Error(`Apimart video missing task_id: ${JSON.stringify(created)}`)

    const deadline = Date.now() + (options?.maxPollMs ?? this.maxPollMs)
    while (Date.now() < deadline) {
      await sleep(options?.pollIntervalMs ?? this.pollIntervalMs)
      const pollRes = await fetch(`${root}/tasks/${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      if (!pollRes.ok) continue
      const json = await pollRes.json()
      const data = (json as { data?: unknown }).data ?? json
      const status = (data as { status?: string }).status
      if (status === 'completed') {
        const url = extractApimartVideoUrl(data)
        if (!url) throw new Error(`Apimart video completed without url: ${JSON.stringify(data)}`)
        const lastFrameUrl = (data as { result?: { last_frame_url?: string } }).result?.last_frame_url
        return { url, lastFrameUrl }
      }
      if (status === 'failed') {
        throw new Error(`Apimart video failed: ${JSON.stringify((data as { error?: unknown }).error ?? data)}`)
      }
    }
    throw new Error(`Apimart video poll timeout (${options?.maxPollMs ?? this.maxPollMs}ms)`)
  }
}

/** num_frames 须满足 8n+1 且 <= 441；seconds ≈ num_frames / frame_rate */
export function resolveVideoParams(durationSec = 5, aspectRatio = '16:9', resolution = '720p') {
  const frame_rate = 24
  const targetFrames = Math.ceil(durationSec * frame_rate)
  let num_frames = Math.ceil((Math.max(targetFrames, 9) - 1) / 8) * 8 + 1
  num_frames = Math.min(441, num_frames)

  const longEdge =
    resolution === '1080p' ? 1920 : resolution === '480p' ? 854 : 1280

  let width = longEdge
  let height = Math.round((longEdge * 9) / 16)
  switch (aspectRatio) {
    case '9:16':
      height = longEdge
      width = Math.round((longEdge * 9) / 16)
      break
    case '1:1': {
      const side = resolution === '1080p' ? 1080 : resolution === '480p' ? 480 : 720
      width = side
      height = side
      break
    }
    case '4:3':
      width = longEdge
      height = Math.round((longEdge * 3) / 4)
      break
    case '3:4':
      height = longEdge
      width = Math.round((longEdge * 3) / 4)
      break
    default:
      break
  }

  width = Math.round(width / 8) * 8
  height = Math.round(height / 8) * 8
  return { width, height, num_frames, frame_rate }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function isAgnesBaseUrl(baseUrl?: string): boolean {
  const hostname = hostnameFromBaseUrl(baseUrl)
  return Boolean(hostname && isGatewayHost(hostname, ['agnes-ai.com', 'agnes-ai.cn']))
}

export function isFalVideoModel(model?: string): boolean {
  return Boolean(model?.toLowerCase().includes('h3-max'))
}

export function isFalBaseUrl(baseUrl?: string): boolean {
  const hostname = hostnameFromBaseUrl(baseUrl)
  return Boolean(hostname && isGatewayHost(hostname, ['fal.ai', 'fal.run']))
}

export type ProviderCredentialOpts = { apiKey?: string; baseUrl?: string; model?: string }

export function createVideoProvider(opts?: ProviderCredentialOpts): VideoProvider {
  if (isFalVideoModel(opts?.model) || isFalBaseUrl(opts?.baseUrl)) {
    if (!opts?.apiKey) {
      throw new Error('视频加速通道未配置')
    }
    return new FalH3MaxVideoProvider(opts.apiKey, opts.baseUrl, opts.model)
  }
  if (isMiniMaxH3Model(opts?.model) || isMiniMaxBaseUrl(opts?.baseUrl)) {
    if (!opts?.apiKey) {
      throw new Error('未配置 MiniMax API Key')
    }
    return new MiniMaxH3VideoProvider(opts.apiKey, opts.baseUrl, opts.model)
  }
  if (opts?.apiKey) {
    if (isAgnesBaseUrl(opts.baseUrl)) {
      return new AgnesVideoProvider(
        opts.apiKey,
        opts.baseUrl,
        process.env.AGNES_API_ROOT ?? 'https://apihub.agnes-ai.com',
        opts.model ?? 'agnes-video-v2.0',
      )
    }
    if (isApimartBaseUrl(opts.baseUrl)) {
      return new ApimartVideoProvider(opts.apiKey, opts.baseUrl)
    }
    return new UnsupportedVideoGatewayProvider(opts.baseUrl)
  }
  const key = process.env.OPENAI_API_KEY || process.env.VIDEO_API_KEY
  const baseUrl = process.env.OPENAI_BASE_URL
  if (key && isAgnesBaseUrl(baseUrl)) {
    return new AgnesVideoProvider(
      key,
      baseUrl,
      process.env.AGNES_API_ROOT ?? 'https://apihub.agnes-ai.com',
      process.env.OPENAI_VIDEO_MODEL ?? 'agnes-video-v2.0',
    )
  }
  if (key && isApimartBaseUrl(baseUrl)) {
    return new ApimartVideoProvider(key, baseUrl)
  }
  if (key) {
    return new UnsupportedVideoGatewayProvider(baseUrl)
  }
  return new PlaceholderVideoProvider()
}
