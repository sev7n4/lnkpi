export interface AudioProvider {
  generate(text: string, voice?: string): Promise<{ url: string }>
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

  async generate(text: string, voice?: string): Promise<{ url: string }> {
    const res = await fetch(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text.slice(0, 4096),
        voice: voice ?? 'alloy',
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

  async generate(text: string, voice?: string): Promise<{ url: string }> {
    try {
      return await this.primary.generate(text, voice)
    } catch (err) {
      console.warn('[AudioProvider] primary TTS failed, using fallback:', err)
      return this.fallback.generate(text, voice)
    }
  }
}

function isAgnesBaseUrl(baseUrl?: string) {
  return Boolean(baseUrl?.includes('agnes-ai.com'))
}

export function createAudioProvider(): AudioProvider {
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
