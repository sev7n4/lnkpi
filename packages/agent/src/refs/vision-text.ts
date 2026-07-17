export const ECOMMERCE_VISION_SYSTEM = `你是电商视觉策划专家。根据用户提供的商品参考图与文字需求，输出完整的电商视觉方案，用中文 Markdown，结构清晰。
必须包含：
1. 商品理解（品类、卖点、目标人群）
2. 主图方案（构图、背景、文案位）
3. 详情图方案（卖点分层展示）
4. 细节图方案（材质/工艺特写角度）
5. 模特图方案（场景、姿态、穿搭/展示方式）
禁止只复述用户原句；若用户未写需求，按通用电商最佳实践补全。`

export const DEFAULT_VISION_USER_PROMPT =
  '请根据参考图生成电商主图、详情图、细节图、模特图的完整视觉方案。'

export interface VisionTextOptions {
  apiKey?: string
  baseUrl?: string
  model?: string
}

function buildPlaceholder(prompt: string, imageCount: number): string {
  return `【电商视觉方案草案】

参考图：${imageCount} 张

基于「${prompt}」：

### 商品理解
…（品类、核心卖点、目标人群）

### 主图方案
…（构图、背景、主文案）

### 详情图方案
…（卖点分层、信息架构）

### 细节图方案
…（材质/工艺/特写角度）

### 模特图方案
…（场景、姿态、穿搭展示）

（配置 OPENAI_API_KEY 后可获得真实视觉模型输出）`
}

export async function generateTextWithImages(
  prompt: string,
  imageUrls: string[],
  opts: VisionTextOptions = {},
): Promise<{ text: string }> {
  const urls = imageUrls.map((u) => u.trim()).filter(Boolean)
  if (urls.length === 0) {
    throw new Error('至少提供一张参考图')
  }

  const userText = prompt.trim() || DEFAULT_VISION_USER_PROMPT

  const key = opts.apiKey ?? process.env.OPENAI_API_KEY
  if (!key) {
    return { text: buildPlaceholder(userText, urls.length) }
  }

  const baseUrl = (opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = opts.model ?? process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o'

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        { role: 'system', content: ECOMMERCE_VISION_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            ...urls.map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    throw new Error(`Vision API ${res.status}: ${await res.text()}`)
  }

  const json = (await res.json()) as { choices: Array<{ message: { content: string } }> }
  const text = json.choices[0]?.message?.content?.trim()
  if (!text) {
    throw new Error('Vision LLM 返回空内容')
  }

  return { text }
}
