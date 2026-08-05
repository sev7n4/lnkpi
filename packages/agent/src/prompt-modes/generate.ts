import { getPromptMode } from './registry'
import type { PromptModeId } from './types'
import { classifyPromptMode } from './classify'

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
  const fewShots = def.fewShots ?? [def.fewShot]
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: def.system },
  ]
  for (const shot of fewShots) {
    messages.push({ role: 'user', content: shot.user })
    messages.push({ role: 'assistant', content: shot.assistant })
  }
  messages.push({ role: 'user', content: `请基于以下需求生成：\n\n${prompt}` })

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: opts?.model ?? process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o',
      temperature: 0.8,
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
  return { mode, content }
}

export async function generatePromptFromUserInput(
  prompt: string,
  opts?: { apiKey?: string; baseUrl?: string; model?: string },
): Promise<{ mode: PromptModeId; content: string }> {
  const { mode } = await classifyPromptMode(prompt, opts)
  return generatePromptContent(prompt, mode, opts)
}
