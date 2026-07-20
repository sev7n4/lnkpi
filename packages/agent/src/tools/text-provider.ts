export type TextThinkingEffort = 'high' | 'max'

export type TextGenerateOptions = {
  thinking?: boolean
  thinkingEffort?: TextThinkingEffort
}

export interface TextProvider {
  generate(prompt: string, model?: string, options?: TextGenerateOptions): Promise<{ text: string }>
}

/** Match deepseek-v4 / deepseek-v4-pro / channel::deepseek-v4-flash / provider/deepseek-v4-pro */
export function isDeepSeekV4Model(model?: string | null): boolean {
  if (!model) return false
  return /deepseek-v4/i.test(model)
}

/** Extra chat.completions fields for DeepSeek V4 thinking control. */
export function buildDeepSeekThinkingFields(
  options?: TextGenerateOptions,
): Record<string, unknown> {
  if (!options?.thinking) {
    return { thinking: { type: 'disabled' } }
  }
  const effort = options.thinkingEffort === 'max' ? 'max' : 'high'
  return {
    thinking: { type: 'enabled' },
    reasoning_effort: effort,
  }
}

export class PlaceholderTextProvider implements TextProvider {
  async generate(prompt: string): Promise<{ text: string }> {
    return {
      text: `【AI 创作草案】\n\n基于「${prompt}」的扩写：\n\n场景一：主角站在霓虹闪烁的街头，雨水倒映着城市的灯光。\n\n场景二：镜头缓缓推进，揭示隐藏在阴影中的秘密。\n\n（配置 OPENAI_API_KEY 后可获得真实 LLM 输出）`,
    }
  }
}

export class OpenAITextProvider implements TextProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.openai.com/v1',
    private model = 'gpt-4o',
  ) {}

  async generate(prompt: string, model?: string, options?: TextGenerateOptions): Promise<{ text: string }> {
    const resolvedModel = model ?? this.model
    const body: Record<string, unknown> = {
      model: resolvedModel,
      messages: [
        { role: 'system', content: '你是专业 AI 创作助手，擅长脚本、旁白与分镜描述。用中文回复，结构清晰。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.8,
    }
    if (isDeepSeekV4Model(resolvedModel)) {
      Object.assign(body, buildDeepSeekThinkingFields(options))
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Text API ${res.status}: ${await res.text()}`)
    const json = await res.json() as { choices: Array<{ message: { content: string } }> }
    return { text: json.choices[0]?.message?.content ?? '' }
  }
}

export type ProviderCredentialOpts = { apiKey?: string; baseUrl?: string; model?: string }

export function createTextProvider(opts?: ProviderCredentialOpts): TextProvider {
  if (opts?.apiKey) {
    return new OpenAITextProvider(opts.apiKey, opts.baseUrl, opts.model)
  }
  const key = process.env.OPENAI_API_KEY
  if (key) {
    return new OpenAITextProvider(key, process.env.OPENAI_BASE_URL, process.env.OPENAI_CHAT_MODEL)
  }
  return new PlaceholderTextProvider()
}
