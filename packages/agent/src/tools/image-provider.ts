export interface ImageProvider {
  generate(prompt: string, modelId?: string): Promise<{ url: string }>
}

export class PlaceholderImageProvider implements ImageProvider {
  private urls = [
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=512&q=80',
    'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=512&q=80',
    'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=512&q=80',
  ]

  async generate() {
    const url = this.urls[Math.floor(Math.random() * this.urls.length)]
    return { url }
  }
}

export class OpenAIImageProvider implements ImageProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.openai.com/v1',
    private model = 'dall-e-3',
  ) {}

  async generate(prompt: string): Promise<{ url: string }> {
    const res = await fetch(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, prompt, n: 1, size: '1024x1024' }),
    })
    if (!res.ok) throw new Error(`Image API ${res.status}: ${await res.text()}`)
    const json = await res.json() as { data: Array<{ url: string }> }
    return { url: json.data[0].url }
  }
}

export function createImageProvider(): ImageProvider {
  const key = process.env.OPENAI_API_KEY
  if (key) {
    return new OpenAIImageProvider(key, process.env.OPENAI_BASE_URL, process.env.OPENAI_IMAGE_MODEL)
  }
  return new PlaceholderImageProvider()
}
