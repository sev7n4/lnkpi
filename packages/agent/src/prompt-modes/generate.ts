import { getPromptMode } from './registry'
import type { PromptModeId } from './types'
import { classifyPromptMode } from './classify'
import { validateCommercialStoryboardOutput } from './modes/commercial-storyboard-validate'

const MODE_TEMPERATURE: Partial<Record<PromptModeId, number>> = {
  commercial_storyboard: 0.35,
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
  opts?: { apiKey?: string; baseUrl?: string; model?: string },
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
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: def.system },
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
  opts?: { apiKey?: string; baseUrl?: string; model?: string },
): Promise<{ mode: PromptModeId; content: string }> {
  const { mode } = await classifyPromptMode(prompt, opts)
  return generatePromptContent(prompt, mode, opts)
}
