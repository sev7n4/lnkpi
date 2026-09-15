import { formatFundamentalsBlock, getGenerationScene } from '@lnkpi/shared'
import {
  appendImageRefsForTextOnlyPrompt,
  supportsVisionTextModel,
  upstreamChatModel,
} from '../refs/text-generation'
import { getPromptMode, PROMPT_MODE_IDS } from './registry'
import type { PromptModeId } from './types'
import { classifyPromptMode } from './classify'
import { validateCommercialStoryboardOutput } from './modes/commercial-storyboard-validate'

const MODE_TEMPERATURE: Partial<Record<PromptModeId, number>> = {
  commercial_storyboard: 0.35,
}

export const EMPTY_PROMPT_WITH_IMAGES = '请基于参考图生成结构化提示词'

export type GeneratePromptOpts = {
  apiKey?: string
  baseUrl?: string
  model?: string
  guideSceneId?: string
  referenceImages?: string[]
  mentionedKeys?: string[]
}

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type ChatContent = string | ChatContentPart[]

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: ChatContent }

export function resolvePromptGenerateText(prompt: string, imageUrls: string[]): string {
  const trimmed = prompt.trim()
  if (trimmed) return trimmed
  return imageUrls.length ? EMPTY_PROMPT_WITH_IMAGES : ''
}

export function buildPromptVisionSystemOverlay(
  imageUrls: string[],
  mentionedKeys?: string[],
): string | null {
  if (!imageUrls.length) return null
  const lines = ['若存在参考图，必须根据图像内容写提示词，禁止只复述文件名或声称看不到图。']
  const keys = (mentionedKeys ?? []).map((k) => k.trim()).filter(Boolean)
  if (keys.length) {
    lines.push(`【优先参考】用户 @ 提及：${keys.join('、')}，请优先以该参考图为主体。`)
  }
  return lines.join('\n')
}

export function buildGuideSystemOverlay(guideSceneId?: string): string | null {
  if (!guideSceneId) return null
  const scene = getGenerationScene(guideSceneId)
  if (!scene) return null
  const fundamentals = formatFundamentalsBlock(scene.fundamentalsRefs)
  return [scene.systemOverlay, fundamentals].filter(Boolean).join('\n\n')
}

function normalizeImageUrls(urls?: string[]): string[] {
  return (urls ?? []).map((u) => u.trim()).filter(Boolean)
}

function buildFinalUserMessage(
  demand: string,
  imageUrls: string[],
  vision: boolean,
): ChatMessage {
  const base = `请基于以下需求生成：\n\n${demand}`
  if (!imageUrls.length) {
    return { role: 'user', content: base }
  }
  if (!vision) {
    return { role: 'user', content: appendImageRefsForTextOnlyPrompt(base, imageUrls) }
  }
  return {
    role: 'user',
    content: [
      { type: 'text', text: base },
      ...imageUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ],
  }
}

async function callChat(
  messages: ChatMessage[],
  opts: { apiKey: string; baseUrl: string; model: string; temperature: number },
): Promise<string> {
  const res = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      temperature: opts.temperature,
      messages,
    }),
  })
  if (!res.ok) {
    throw new Error(`LLM 请求失败: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as { choices: Array<{ message: { content: string } }> }
  const content = json.choices[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('LLM 返回空内容')
  }
  return content
}

export async function generatePromptContent(
  prompt: string,
  mode: PromptModeId,
  opts?: GeneratePromptOpts,
): Promise<{ mode: PromptModeId; content: string; visionUsed: boolean }> {
  const imageUrls = normalizeImageUrls(opts?.referenceImages)
  const demand = resolvePromptGenerateText(prompt, imageUrls)
  const vision = imageUrls.length > 0 && supportsVisionTextModel(opts?.model)
  const key = opts?.apiKey ?? process.env.OPENAI_API_KEY
  const def = getPromptMode(mode)

  if (!key) {
    return { mode, content: def.placeholder(demand || prompt), visionUsed: false }
  }

  const baseUrl = (opts?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = upstreamChatModel(opts?.model) ?? opts?.model ?? process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o'
  const temperature = MODE_TEMPERATURE[mode] ?? 0.8
  const fewShots = def.fewShots ?? [def.fewShot]
  const overlay = buildGuideSystemOverlay(opts?.guideSceneId)
  const visionOverlay = buildPromptVisionSystemOverlay(imageUrls, opts?.mentionedKeys)
  let system = overlay ? `${def.system}\n\n## Image prompting guide\n${overlay}` : def.system
  if (visionOverlay) {
    system = `${system}\n\n${visionOverlay}`
  }
  const messages: ChatMessage[] = [{ role: 'system', content: system }]
  for (const shot of fewShots) {
    messages.push({ role: 'user', content: shot.user })
    messages.push({ role: 'assistant', content: shot.assistant })
  }
  messages.push(buildFinalUserMessage(demand, imageUrls, vision))

  let content = await callChat(messages, { apiKey: key, baseUrl, model, temperature })

  if (mode === 'commercial_storyboard') {
    const validation = validateCommercialStoryboardOutput(content)
    if (!validation.ok) {
      messages.push({ role: 'assistant', content })
      messages.push({
        role: 'user',
        content:
          `输出未通过质量校验，请严格修正后重新输出完整四节+表格+校验锁：\n${validation.issues.map((i) => `- ${i}`).join('\n')}`,
      })
      content = await callChat(messages, {
        apiKey: key,
        baseUrl,
        model,
        temperature: 0.2,
      })
    }
  }

  return { mode, content, visionUsed: vision }
}

export async function generatePromptFromUserInput(
  prompt: string,
  opts?: GeneratePromptOpts,
): Promise<{ mode: PromptModeId; content: string; visionUsed: boolean }> {
  const imageUrls = normalizeImageUrls(opts?.referenceImages)
  const demand = resolvePromptGenerateText(prompt, imageUrls)
  const scene = opts?.guideSceneId ? getGenerationScene(opts.guideSceneId) : undefined
  const forced = scene?.expandViaPromptMode
  const mode =
    forced && PROMPT_MODE_IDS.includes(forced as PromptModeId)
      ? (forced as PromptModeId)
      : (await classifyPromptMode(demand || prompt, opts)).mode
  return generatePromptContent(prompt, mode, opts)
}
