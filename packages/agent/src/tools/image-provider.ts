import type { ImageRefWire, ImageResponseMode } from '@lnkpi/shared'
import { extractApimartTaskId, pollApimartImageTask } from './apimart-image-task'

export interface ImageGenerateOptions {
  modelId?: string
  size?: string
  resolution?: string
  n?: number
  quality?: string
  referenceImages?: string[]
  refWire?: ImageRefWire
  responseMode?: ImageResponseMode
  pollIntervalMs?: number
  maxPollMs?: number
}

export interface ImageProvider {
  generate(prompt: string, options?: ImageGenerateOptions): Promise<{ url: string; urls?: string[] }>
}

export class PlaceholderImageProvider implements ImageProvider {
  private urls = [
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=512&q=80',
    'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=512&q=80',
    'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=512&q=80',
  ]

  async generate(_prompt: string, options?: ImageGenerateOptions) {
    const n = Math.max(1, Math.min(4, options?.n ?? 1))
    const urls: string[] = []
    for (let i = 0; i < n; i += 1) {
      urls.push(this.urls[Math.floor(Math.random() * this.urls.length)])
    }
    return { url: urls[0], urls }
  }
}

function isAgnesImageApi(baseUrl?: string, model?: string): boolean {
  if (model && /^agnes-image-/i.test(model)) return true
  return Boolean(baseUrl?.includes('agnes-ai.com') || baseUrl?.includes('agnes-ai.cn'))
}

function isApimartImageApi(baseUrl?: string): boolean {
  return Boolean(baseUrl?.includes('apimart.ai'))
}

function resolveRefWire(options?: ImageGenerateOptions, baseUrl?: string, model?: string): ImageRefWire {
  if (options?.refWire && options.refWire !== 'none') return options.refWire
  if (options?.referenceImages?.length) {
    if (isAgnesImageApi(baseUrl, model)) return 'agnes_extra_body'
    if (isApimartImageApi(baseUrl)) return 'apimart_image_urls'
  }
  return 'legacy_prompt_tags'
}

function resolveResponseMode(options?: ImageGenerateOptions, baseUrl?: string): ImageResponseMode {
  if (options?.responseMode) return options.responseMode
  if (isApimartImageApi(baseUrl)) return 'async_task'
  return 'sync_url'
}

function extractSyncImageUrls(json: unknown): string[] {
  const payload = json as { data?: Array<{ url?: string }> }
  const urls: string[] = []
  for (const item of payload.data ?? []) {
    if (item.url) urls.push(item.url)
  }
  return urls
}

export class OpenAIImageProvider implements ImageProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.openai.com/v1',
    private model = 'dall-e-3',
  ) {}

  buildRequestBody(prompt: string, options?: ImageGenerateOptions): Record<string, unknown> {
    const model = options?.modelId || this.model
    const n = Math.max(1, Math.min(4, options?.n ?? 1))
    const refs = (options?.referenceImages ?? []).map((url) => url.trim()).filter(Boolean)
    const refWire = resolveRefWire(options, this.baseUrl, model)

    const body: Record<string, unknown> = {
      model,
      prompt,
      n: model.includes('dall-e-3') ? 1 : Math.min(n, 4),
    }

    if (options?.size) body.size = options.size
    if (options?.resolution) body.resolution = options.resolution
    if (options?.quality) body.quality = options.quality

    if (refs.length > 0) {
      if (refWire === 'agnes_extra_body') {
        body.extra_body = {
          image: refs,
          response_format: 'url',
        }
      } else if (refWire === 'apimart_image_urls') {
        body.image_urls = refs
      }
    }

    return body
  }

  async generate(prompt: string, options?: ImageGenerateOptions): Promise<{ url: string; urls?: string[] }> {
    const model = options?.modelId || this.model
    const responseMode = resolveResponseMode(options, this.baseUrl)
    const n = Math.max(1, Math.min(4, options?.n ?? 1))

    if (responseMode === 'async_task') {
      const res = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(this.buildRequestBody(prompt, options)),
      })
      if (!res.ok) throw new Error(`Image API ${res.status}: ${await res.text()}`)
      const json = await res.json()
      const taskId = extractApimartTaskId(json)
      if (!taskId) {
        throw new Error(`Image API async response missing task_id: ${JSON.stringify(json)}`)
      }
      const urls = await pollApimartImageTask({
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
        taskId,
        pollIntervalMs: options?.pollIntervalMs,
        maxPollMs: options?.maxPollMs,
      })
      return { url: urls[0], urls }
    }

    const urls: string[] = []
    for (let i = 0; i < n; i += 1) {
      const res = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(this.buildRequestBody(prompt, options)),
      })
      if (!res.ok) throw new Error(`Image API ${res.status}: ${await res.text()}`)
      const json = await res.json()
      urls.push(...extractSyncImageUrls(json))
      if (!model.includes('dall-e-3')) break
    }
    if (!urls.length) throw new Error('Image API returned no urls')
    return { url: urls[0], urls }
  }
}

export type ProviderCredentialOpts = { apiKey?: string; baseUrl?: string; model?: string }

export function createImageProvider(opts?: ProviderCredentialOpts): ImageProvider {
  if (opts?.apiKey) {
    return new OpenAIImageProvider(opts.apiKey, opts.baseUrl, opts.model)
  }
  const key = process.env.OPENAI_API_KEY
  if (key) {
    return new OpenAIImageProvider(key, process.env.OPENAI_BASE_URL, process.env.OPENAI_IMAGE_MODEL)
  }
  return new PlaceholderImageProvider()
}
