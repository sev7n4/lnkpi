export interface VideoProvider {
  generate(prompt: string, options?: { model?: string; duration?: number; aspectRatio?: string }): Promise<{ url: string }>
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
    // 未来可接入 Sora / 第三方 video API
    console.log(`[VideoProvider] model=${options?.model} duration=${options?.duration} prompt=${prompt.slice(0, 50)}`)
    return this.fallback.generate(prompt, options)
  }
}

export function createVideoProvider(): VideoProvider {
  if (process.env.OPENAI_API_KEY || process.env.VIDEO_API_KEY) {
    return new OpenAIVideoProvider()
  }
  return new PlaceholderVideoProvider()
}
