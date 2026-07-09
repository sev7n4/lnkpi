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

export function createAudioProvider(): AudioProvider {
  const key = process.env.OPENAI_API_KEY
  if (key) {
    return new OpenAITTSProvider(key, process.env.OPENAI_BASE_URL)
  }
  return new PlaceholderAudioProvider()
}
