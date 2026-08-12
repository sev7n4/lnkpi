import { extractJsonObject } from './json-extract'
import { supportsVisionTextModel } from './text-generation'

export interface VisionQaJsonOptions {
  apiKey?: string
  baseUrl?: string
  model?: string
  /** Retry count for transient upstream failures (5xx / 429). Default 2. */
  maxRetries?: number
}

export interface VisionQaJsonResult {
  text: string
  visionUsed: boolean
}

export interface ParsedVisionQaJson {
  pass: boolean
  reason: string
  productSummary?: string
  isWhiteBg?: boolean
  isSharpEnough?: boolean
  productIdentifiable?: boolean
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Parse vision QA model output into structured fields. */
export function parseVisionQaJson(raw: string): ParsedVisionQaJson {
  const data = extractJsonObject(raw)
  if (!data) {
    return {
      pass: false,
      reason: '识图模型返回格式异常，请重试或更换参考图',
    }
  }
  const productSummary = String(data.product_summary ?? data.productSummary ?? '').trim() || undefined
  return {
    pass: Boolean(data.pass),
    reason: String(data.reason ?? '').trim() || '图源审核完成',
    productSummary,
    isWhiteBg: typeof data.is_white_bg === 'boolean' ? data.is_white_bg : undefined,
    isSharpEnough: typeof data.is_sharp_enough === 'boolean' ? data.is_sharp_enough : undefined,
    productIdentifiable:
      typeof data.product_identifiable === 'boolean' ? data.product_identifiable : undefined,
  }
}

async function postVisionChat(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
}

/**
 * Vision QA path — dedicated system/user prompts, temperature 0, JSON output.
 * Does not use ECOMMERCE_VISION_SYSTEM (markdown plan) which conflicts with QA schema.
 */
export async function generateVisionQaJson(
  systemPrompt: string,
  userContent: string,
  imageUrls: string[],
  opts: VisionQaJsonOptions = {},
): Promise<VisionQaJsonResult> {
  const urls = imageUrls.map((u) => u.trim()).filter(Boolean)
  if (!urls.length) {
    throw new Error('至少提供一张参考图')
  }

  const key = opts.apiKey ?? process.env.OPENAI_API_KEY
  if (!key) {
    return {
      text: JSON.stringify({
        pass: false,
        reason: '未配置识图模型 API Key',
        product_summary: '',
        is_white_bg: null,
        is_sharp_enough: null,
        product_identifiable: null,
      }),
      visionUsed: false,
    }
  }

  const model = opts.model ?? process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o'
  if (!supportsVisionTextModel(model)) {
    return {
      text: JSON.stringify({
        pass: false,
        reason: `当前文本模型（${model}）不支持识图`,
        product_summary: '',
      }),
      visionUsed: false,
    }
  }

  const baseUrl = (opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  )
  const endpoint = `${baseUrl}/chat/completions`
  const maxRetries = opts.maxRetries ?? 2

  const baseBody = {
    model,
    stream: false,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt.trim() },
      {
        role: 'user',
        content: [
          { type: 'text', text: userContent.trim() },
          ...urls.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      },
    ],
  }

  let lastError = 'Vision API failed'
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      await sleep(400 * attempt)
    }

    let res = await postVisionChat(endpoint, key, {
      ...baseBody,
      response_format: { type: 'json_object' },
    })

    if (!res.ok && res.status === 400) {
      res = await postVisionChat(endpoint, key, baseBody)
    }

    if (res.ok) {
      const json = (await res.json()) as { choices: Array<{ message: { content: string } }> }
      const text = json.choices[0]?.message?.content?.trim()
      if (!text) {
        lastError = 'Vision LLM 返回空内容'
        continue
      }
      return { text, visionUsed: true }
    }

    const errText = await res.text()
    lastError = `Vision API ${res.status}: ${errText.slice(0, 240)}`
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
      throw new Error(lastError)
    }
  }

  throw new Error(lastError)
}
