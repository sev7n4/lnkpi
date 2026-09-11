import { formatFundamentalsBlock, getGenerationScene } from '@lnkpi/shared'
import { getPromptMode, PROMPT_MODE_IDS } from './registry'
import type { PromptModeId } from './types'
import { classifyPromptMode } from './classify'
import { validateCommercialStoryboardOutput } from './modes/commercial-storyboard-validate'

const MODE_TEMPERATURE: Partial<Record<PromptModeId, number>> = {
  commercial_storyboard: 0.35,
}

export type GeneratePromptOpts = {
  apiKey?: string
  baseUrl?: string
  model?: string
  guideSceneId?: string
}

export function buildGuideSystemOverlay(guideSceneId?: string): string | null {
  if (!guideSceneId) return null
  const scene = getGenerationScene(guideSceneId)
  if (!scene) return null
  const fundamentals = formatFundamentalsBlock(scene.fundamentalsRefs)
  return [scene.systemOverlay, fundamentals].filter(Boolean).join('\n\n')
}

async function callChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
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
): Promise<{ mode: PromptModeId; content: string }> {
  const key = opts?.apiKey ?? process.env.OPENAI_API_KEY
  const def = getPromptMode(mode)

  if (!key) {
    return { mode, content: def.placeholder(prompt) }
  }

  const baseUrl = (opts?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = opts?.model ?? process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o'
  const temperature = MODE_TEMPERATURE[mode] ?? 0.8
  const fewShots = def.fewShots ?? [def.fewShot]
  const overlay = buildGuideSystemOverlay(opts?.guideSceneId)
  const system = overlay ? `${def.system}\n\n## Image prompting guide\n${overlay}` : def.system
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: system },
  ]
  for (const shot of fewShots) {
    messages.push({ role: 'user', content: shot.user })
    messages.push({ role: 'assistant', content: shot.assistant })
  }
  messages.push({ role: 'user', content: `请基于以下需求生成：\n\n${prompt}` })

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

  return { mode, content }
}

export async function generatePromptFromUserInput(
  prompt: string,
  opts?: GeneratePromptOpts,
): Promise<{ mode: PromptModeId; content: string }> {
  const scene = opts?.guideSceneId ? getGenerationScene(opts.guideSceneId) : undefined
  const forced = scene?.expandViaPromptMode
  const mode =
    forced && PROMPT_MODE_IDS.includes(forced as PromptModeId)
      ? (forced as PromptModeId)
      : (await classifyPromptMode(prompt, opts)).mode
  return generatePromptContent(prompt, mode, opts)
}
