export interface AudioGenerateOptions {
  model?: string
  voice?: string
  speed?: number
  volume?: number
  pitch?: number
  emotion?: string
}

export interface AudioProvider {
  generate(text: string, voiceOrOpts?: string | AudioGenerateOptions): Promise<{ url: string }>
}

function resolveAudioOptions(voiceOrOpts?: string | AudioGenerateOptions): AudioGenerateOptions {
  if (typeof voiceOrOpts === 'string') return { voice: voiceOrOpts }
  return voiceOrOpts ?? {}
}

const PLACEHOLDER_MP3 = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'

export class PlaceholderAudioProvider implements AudioProvider {
  async generate(): Promise<{ url: string }> {
    return { url: PLACEHOLDER_MP3 }
  }
}

export class OpenAITTSProvider implements AudioProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.openai.com/v1',
    private model = 'tts-1',
  ) {}

  async generate(text: string, voiceOrOpts?: string | AudioGenerateOptions): Promise<{ url: string }> {
    const options = resolveAudioOptions(voiceOrOpts)
    const res = await fetch(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? this.model,
        input: text.slice(0, 4096),
        voice: options.voice ?? 'alloy',
        speed: options.speed,
        ...(options.volume != null ? { volume: options.volume } : {}),
        ...(options.pitch != null ? { pitch: options.pitch } : {}),
        ...(options.emotion ? { emotion: options.emotion } : {}),
      }),
    })
    if (!res.ok) throw new Error(`TTS API ${res.status}: ${await res.text()}`)
    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return { url: `data:audio/mpeg;base64,${base64}` }
  }
}

/** Agnes 暂无独立 TTS：先尝试 OpenAI 兼容 /audio/speech，失败则占位 MP3 */
export class FallbackAudioProvider implements AudioProvider {
  constructor(
    private primary: AudioProvider,
    private fallback: AudioProvider = new PlaceholderAudioProvider(),
  ) {}

  async generate(text: string, voiceOrOpts?: string | AudioGenerateOptions): Promise<{ url: string }> {
    try {
      return await this.primary.generate(text, voiceOrOpts)
    } catch (err) {
      console.warn('[AudioProvider] primary TTS failed, using fallback:', err)
      return this.fallback.generate(text, voiceOrOpts)
    }
  }
}

function isAgnesBaseUrl(baseUrl?: string) {
  return Boolean(baseUrl?.includes('agnes-ai.com'))
}

export type ProviderCredentialOpts = { apiKey?: string; baseUrl?: string; model?: string }

export function createAudioProvider(opts?: ProviderCredentialOpts): AudioProvider {
  if (opts?.apiKey) {
    const baseUrl = opts.baseUrl ?? 'https://api.openai.com/v1'
    const model = opts.model ?? 'tts-1'
    const tts = new OpenAITTSProvider(opts.apiKey, baseUrl, model)
    if (isAgnesBaseUrl(baseUrl)) {
      return new FallbackAudioProvider(tts)
    }
    return tts
  }
  const key = process.env.OPENAI_API_KEY
  const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  const model = process.env.OPENAI_TTS_MODEL ?? 'tts-1'
  if (!key) return new PlaceholderAudioProvider()
  const tts = new OpenAITTSProvider(key, baseUrl, model)
  if (isAgnesBaseUrl(baseUrl)) {
    return new FallbackAudioProvider(tts)
  }
  return tts
}
