import { buildDeepSeekThinkingFields, isDeepSeekV4Model } from '../tools/text-provider'

export interface MergeTextSource {
  refKey: string
  label: string
  text: string
}

const LOCAL_REF_KEY = 'local'
const LOCAL_LABEL = '本节点'

const DOWNSTREAM_SYSTEM: Record<'text' | 'image' | 'video' | 'audio', string> = {
  text: '你是专业 AI 创作助手。将多条文本参考归纳成一条清晰、完整的中文文案，保留关键约束与细节，注明曾参考哪些 Tn。',
  image: '你是图像提示词专家。将多条文本参考归纳成一条适合文生图的中文提示词，保留风格、主体与构图约束，注明曾参考哪些 Tn。',
  video: '你是视频脚本专家。将多条文本参考归纳成一条适合文生视频的中文提示词，保留镜头与动作描述，注明曾参考哪些 Tn。',
  audio: '你是配音文案专家。将多条文本参考归纳成一条适合 TTS 朗读的中文旁白/台词，口语自然，注明曾参考哪些 Tn。',
}

function buildTextEntries(sources: MergeTextSource[], localPrompt?: string): MergeTextSource[] {
  const entries = sources.filter((s) => s.text.trim())
  const local = localPrompt?.trim()
  if (local) {
    entries.push({ refKey: LOCAL_REF_KEY, label: LOCAL_LABEL, text: local })
  }
  return entries
}

function fallbackConcat(entries: MergeTextSource[]): string {
  return entries
    .map((e) => `【${e.refKey}·${e.label}】\n${e.text}`)
    .join('\n\n')
}

function buildSystemPrompt(
  downstreamType: keyof typeof DOWNSTREAM_SYSTEM,
  mentionedKeys?: string[],
): string {
  const base = DOWNSTREAM_SYSTEM[downstreamType]
  if (!mentionedKeys?.length) return base
  const keys = mentionedKeys.join('、')
  return `${base} 用户在输入中 @ 提及了 ${keys}，请优先落实这些 refKey 对应参考的内容与约束。`
}

function buildMergeUserMessage(
  entries: MergeTextSource[],
  downstreamType: keyof typeof DOWNSTREAM_SYSTEM,
  mentionedKeys?: string[],
): string {
  const blocks = entries.map((e) => `【${e.refKey}·${e.label}】\n${e.text}`).join('\n\n')
  let message = `下游类型：${downstreamType}\n\n请将以下文本参考归纳成一条可直接用于生成的内容：\n\n${blocks}`
  if (mentionedKeys?.length) {
    message += `\n\n【优先参考】用户 @ 提及：${mentionedKeys.join('、')}，请优先融合以上 refKey 的内容。`
  }
  return message
}

export async function mergeRefsToPrompt(input: {
  sources: MergeTextSource[]
  localPrompt?: string
  downstreamType: 'text' | 'image' | 'video' | 'audio'
  mentionedKeys?: string[]
  apiKey?: string
  baseUrl?: string
  model?: string
}): Promise<{ mergedText: string; skippedMerge: boolean }> {
  const entries = buildTextEntries(input.sources, input.localPrompt)

  if (entries.length <= 1) {
    return { mergedText: entries[0]?.text ?? '', skippedMerge: true }
  }

  const key = input.apiKey ?? process.env.OPENAI_API_KEY
  if (!key) {
    return { mergedText: fallbackConcat(entries), skippedMerge: false }
  }

  const model = input.model ?? process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o'
  const body: Record<string, unknown> = {
    model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: buildSystemPrompt(input.downstreamType, input.mentionedKeys) },
      { role: 'user', content: buildMergeUserMessage(entries, input.downstreamType, input.mentionedKeys) },
    ],
  }
  // Merge is latency-sensitive: always disable DeepSeek V4 thinking when applicable.
  if (isDeepSeekV4Model(model)) {
    Object.assign(body, buildDeepSeekThinkingFields({ thinking: false }))
  }

  const baseUrl = (input.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  // Merge is best-effort: any LLM failure degrades to concat instead of failing the whole generation
  // (points are already consumed by the caller at this stage).
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`LLM 请求失败: ${res.status} ${res.statusText}`)
    }
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> }
    const mergedText = json.choices[0]?.message?.content?.trim()
    if (!mergedText) {
      throw new Error('LLM 返回空内容')
    }
    return { mergedText, skippedMerge: false }
  } catch (err) {
    console.warn(
      '[merge-refs] LLM merge failed, falling back to concat:',
      err instanceof Error ? err.message : err,
    )
    return { mergedText: fallbackConcat(entries), skippedMerge: false }
  }
}
