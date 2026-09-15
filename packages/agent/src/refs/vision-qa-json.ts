import { extractJsonObject } from './json-extract'
import { supportsVisionTextModel, upstreamChatModel } from './text-generation'

export interface VisionQaJsonOptions {
  apiKey?: string
  baseUrl?: string
  model?: string
  /** Retry count for 429 / timeout only (D-RETRY). Default 2. */
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
  userFacingSummary?: string
  category?: string
  appearance?: string
  materialHint?: string
  textInImage?: string
  unknown?: string[]
  isWhiteBg?: boolean
  isSharpEnough?: boolean
  productIdentifiable?: boolean
}

/** D-RETRY: only 429 (and timeout via thrown errors). Never 5xx. */
const RETRYABLE_STATUSES = new Set([429])

function optionalText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return undefined
}

function optionalStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return undefined
  return value as string[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const name = err.name
  const msg = err.message.toLowerCase()
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('aborted')
  )
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
  const productSummary = optionalText(data.product_summary, data.productSummary)
  return {
    pass: Boolean(data.pass),
    reason: String(data.reason ?? '').trim() || '图源审核完成',
    productSummary,
    userFacingSummary: optionalText(data.user_facing_summary, data.userFacingSummary) ?? productSummary,
    category: optionalText(data.category),
    appearance: optionalText(data.appearance),
    materialHint: optionalText(data.material_hint, data.materialHint),
    textInImage: optionalText(data.text_in_image, data.textInImage),
    unknown: optionalStringList(data.unknown),
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

  const rawModel = opts.model ?? process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o'
  if (!supportsVisionTextModel(rawModel)) {
    return {
      text: JSON.stringify({
        pass: false,
        reason: `当前文本模型（${rawModel}）不支持识图`,
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

  const model = upstreamChatModel(rawModel)
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

    try {
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
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Vision API ')) {
        throw err
      }
      lastError = err instanceof Error ? err.message : String(err)
      if (!isRetryableTimeout(err) || attempt >= maxRetries) {
        throw err instanceof Error ? err : new Error(lastError)
      }
    }
  }

  throw new Error(lastError)
}
