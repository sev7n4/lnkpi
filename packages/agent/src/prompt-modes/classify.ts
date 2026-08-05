import { PROMPT_MODE_IDS, PROMPT_MODES } from './registry'
import type { PromptModeId } from './types'

export function tryRuleShortcut(_prompt: string): PromptModeId | null {
  return null
}

/** 仅无 Key / Placeholder 路径使用；不用于跳过有 Key 时的 Call-1 */
export function heuristicMode(prompt: string): PromptModeId {
  const p = prompt.toLowerCase()
  if (/三视图|多视图|正侧背|turnaround|模特图|角色设定|模特定妆|四视图|q版|q萌|chibi|二头身|洛丽塔|lolita|婚纱|战术|军事|牛仔|皮克斯|绘本|水彩/.test(p)) return 'character_turnaround'
  if (/商业分镜|品牌分镜|品牌广告|营销战役|TVC|问界|AITO|汽车广告|15秒|30秒|60秒|抖音前贴|发布会暖场|品牌形象片|闪电切割|AIDA/.test(p))
    return 'commercial_storyboard'
  if (/分镜/.test(p)) return 'storyboard'
  if (/剧本|剧本大纲|人生观/.test(p)) return 'script'
  if (/旁白|口播|文案/.test(p)) return 'copywriting'
  if (/提示词|midjourney|stable diffusion|绘画|车模/.test(p)) return 'image_prompt_multi_style'
  return 'generic'
}

export async function classifyPromptMode(
  prompt: string,
  opts?: { apiKey?: string; baseUrl?: string; model?: string },
): Promise<{ mode: PromptModeId; confidence: number }> {
  const shortcut = tryRuleShortcut(prompt)
  if (shortcut) return { mode: shortcut, confidence: 0.99 }

  const key = opts?.apiKey ?? process.env.OPENAI_API_KEY
  if (!key) return { mode: heuristicMode(prompt), confidence: 0.4 }

  const hints = PROMPT_MODE_IDS.map((id) => `- ${id}: ${PROMPT_MODES[id].classifyHints}`).join('\n')
  const baseUrl = (opts?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: opts?.model ?? process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `你是意图分类器。只输出 JSON：{"mode":"<id>","confidence":0-1}。mode 必须是其一：${PROMPT_MODE_IDS.join(', ')}。\n判别：\n${hints}`,
        },
        { role: 'user', content: prompt.slice(0, 500) },
      ],
    }),
  })
  if (!res.ok) return { mode: 'generic', confidence: 0 }
  const json = (await res.json()) as { choices: Array<{ message: { content: string } }> }
  const raw = json.choices[0]?.message?.content ?? ''
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()) as { mode?: string; confidence?: number }
    const mode = PROMPT_MODE_IDS.includes(parsed.mode as PromptModeId)
      ? (parsed.mode as PromptModeId)
      : 'generic'
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
    if (confidence < 0.5) return { mode: 'generic', confidence }
    return { mode, confidence }
  } catch {
    return { mode: 'generic', confidence: 0 }
  }
}
