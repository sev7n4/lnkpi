export interface ImageGenerateOptions {
  modelId?: string
  size?: string
  n?: number
  referenceImages?: string[]
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

export class OpenAIImageProvider implements ImageProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.openai.com/v1',
    private model = 'dall-e-3',
  ) {}

  private buildRequestBody(prompt: string, options?: ImageGenerateOptions): Record<string, unknown> {
    const model = options?.modelId || this.model
    const n = Math.max(1, Math.min(4, options?.n ?? 1))
    const size = options?.size ?? '1024x1024'
    const refs = (options?.referenceImages ?? []).map((url) => url.trim()).filter(Boolean)

    const body: Record<string, unknown> = {
      model,
      prompt,
      n: model.includes('dall-e-3') ? 1 : Math.min(n, 4),
      size,
    }

    if (refs.length > 0 && (isAgnesImageApi(this.baseUrl, model))) {
      body.extra_body = {
        image: refs,
        response_format: 'url',
      }
    }

    return body
  }

  async generate(prompt: string, options?: ImageGenerateOptions): Promise<{ url: string; urls?: string[] }> {
    const n = Math.max(1, Math.min(4, options?.n ?? 1))
    const model = options?.modelId || this.model
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
      const json = await res.json() as { data: Array<{ url: string }> }
      for (const item of json.data) {
        if (item.url) urls.push(item.url)
      }
      if (!model.includes('dall-e-3')) break
    }
    if (!urls.length) throw new Error('Image API returned no urls')
    return { url: urls[0], urls }
  }
}

function isAgnesImageApi(baseUrl?: string, model?: string): boolean {
  if (model && /^agnes-image-/i.test(model)) return true
  return Boolean(baseUrl?.includes('agnes-ai.com') || baseUrl?.includes('agnes-ai.cn'))
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
