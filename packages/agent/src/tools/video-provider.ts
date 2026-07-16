export interface VideoProvider {
  generate(
    prompt: string,
    options?: { model?: string; duration?: number; aspectRatio?: string; image?: string },
  ): Promise<{ url: string }>
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

  async generate(prompt: string, options?: { model?: string; duration?: number }): Promise<{ url: string }> {
    console.log(`[VideoProvider] model=${options?.model} duration=${options?.duration} prompt=${prompt.slice(0, 50)}`)
    return this.fallback.generate(prompt, options)
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

  async generate(
    prompt: string,
    options?: { model?: string; duration?: number; aspectRatio?: string; image?: string },
  ): Promise<{ url: string }> {
    const model = options?.model || process.env.OPENAI_VIDEO_MODEL || this.defaultModel
    const { width, height, num_frames, frame_rate } = resolveVideoParams(options?.duration, options?.aspectRatio)

    const body: Record<string, unknown> = {
      model,
      prompt,
      width,
      height,
      num_frames,
      frame_rate,
    }
    if (options?.image) body.image = options.image

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
      if (result.status === 'completed' && result.url) {
        return { url: result.url }
      }
      if (result.status === 'failed') {
        throw new Error(`Agnes video failed: ${JSON.stringify(result.error ?? result)}`)
      }
    }

    throw new Error(`Agnes video timed out after ${this.maxPollAttempts} polls`)
  }
}

/** num_frames 须满足 8n+1 且 <= 441；seconds ≈ num_frames / frame_rate */
export function resolveVideoParams(durationSec = 5, aspectRatio = '16:9') {
  const frame_rate = 24
  const targetFrames = Math.ceil(durationSec * frame_rate)
  let num_frames = Math.ceil((Math.max(targetFrames, 9) - 1) / 8) * 8 + 1
  num_frames = Math.min(441, num_frames)

  let width = 1152
  let height = 768
  switch (aspectRatio) {
    case '9:16':
      width = 768
      height = 1152
      break
    case '1:1':
      width = 768
      height = 768
      break
    case '4:3':
      width = 1024
      height = 768
      break
    case '3:4':
      width = 768
      height = 1024
      break
    default:
      break
  }

  return { width, height, num_frames, frame_rate }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function isAgnesBaseUrl(baseUrl?: string) {
  return Boolean(baseUrl?.includes('agnes-ai.com'))
}

export function createVideoProvider(): VideoProvider {
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
  if (key) {
    return new OpenAIVideoProvider()
  }
  return new PlaceholderVideoProvider()
}
