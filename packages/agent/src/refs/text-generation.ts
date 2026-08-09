import { createTextProvider } from '../tools/text-provider'
import type { TextGenerateOptions } from '../tools/text-provider'
import { generateTextWithImages } from './vision-text'

const VISION_MODEL_PATTERN =
  /(?:^|[/:])(?:gemini|gpt-4o|gpt-4-turbo|gpt-4-vision|gpt-5|claude-(?:opus|sonnet|haiku|3)|agnes)(?:[-./]|$)/i

const NON_VISION_MODEL_PATTERN =
  /(?:^|[/:])(?:deepseek|o[134](?:-|$|-mini|-pro)|text-embedding|whisper|tts|dall-e|babbage|davinci|curie|ada|moderation|flowmusic|suno)(?:[-./]|$)/i

/** Whether chat/completions accepts OpenAI-style image_url message parts for this model id. */
export function supportsVisionTextModel(model?: string | null): boolean {
  if (!model?.trim()) return false
  const normalized = model.trim()
  if (NON_VISION_MODEL_PATTERN.test(normalized)) return false
  return VISION_MODEL_PATTERN.test(normalized)
}

export function appendImageRefsForTextOnlyPrompt(prompt: string, imageUrls: string[]): string {
  const trimmed = prompt.trim()
  const urls = imageUrls.map((url) => url.trim()).filter(Boolean)
  if (urls.length === 0) return trimmed
  const tags = urls.map((url) => `[ref-image:${url}]`).join('\n')
  return `${trimmed}\n\n【参考图说明】当前文本模型不支持直接识图，以下为上游参考图 URL，请结合用户文字需求作答：\n${tags}`
}

export type TextGenerationWithRefsOptions = {
  model?: string
  apiKey?: string
  baseUrl?: string
  textOpts?: TextGenerateOptions
}

/** Route image-ref text generation to vision API or text-only fallback. */
export async function generateTextForRefs(
  prompt: string,
  referenceImages: string[],
  opts: TextGenerationWithRefsOptions = {},
): Promise<{ text: string; visionUsed: boolean }> {
  const refs = referenceImages.map((url) => url.trim()).filter(Boolean)
  if (refs.length === 0) {
    const provider = createTextProvider({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      model: opts.model,
    })
    const { text } = await provider.generate(prompt, opts.model, opts.textOpts)
    return { text, visionUsed: false }
  }

  if (supportsVisionTextModel(opts.model)) {
    const { text } = await generateTextWithImages(prompt, refs, {
      model: opts.model,
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
    })
    return { text, visionUsed: true }
  }

  const provider = createTextProvider({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    model: opts.model,
  })
  const { text } = await provider.generate(
    appendImageRefsForTextOnlyPrompt(prompt, refs),
    opts.model,
    opts.textOpts,
  )
  return { text, visionUsed: false }
}
