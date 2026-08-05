/** Shared helpers for prompt node content preview and completion summaries. */

export const PROMPT_MODE_LABELS: Record<string, string> = {
  image_prompt_multi_style: '多风格绘画提示词',
  character_turnaround: '人物三视图',
  storyboard: '分镜提示词',
  commercial_storyboard: '商业品牌分镜',
  script: '剧本',
  copywriting: '文案/旁白',
  generic: '通用创作',
}

/** Keep in sync with services/agent-runtime/app/graph/atomic_intent.py turnaround_pipeline_user_note */
export const TURNAROUND_PIPELINE_USER_NOTE =
  '已按角色设定图模版扩写并出图；在原有三视图（正/侧/背）基础上增加近景特写，共四格横排；使用 2:1 画幅（非账户默认比例）。'

export const TURNAROUND_PIPELINE_DOCK_HINT =
  '三视图将自动补全为四格：近景特写 + 正/侧/背全身，2:1 横排出图'

export function promptModeLabel(mode: string | null | undefined): string {
  if (!mode) return ''
  return PROMPT_MODE_LABELS[mode] ?? mode
}

/** Count GFM table data rows (excludes header and separator). */
export function countMarkdownTableDataRows(content: string): number {
  return content.split('\n').filter((line) => {
    const t = line.trim()
    if (!t.startsWith('|')) return false
    if (t.includes('序号') && t.includes('时长')) return false
    if (/^\|[\s:|-]+\|$/.test(t)) return false
    const cells = t.split('|').filter((c) => c.trim())
    return cells.length >= 3
  }).length
}

export function countStoryboardMirrorSections(content: string): number {
  return (content.match(/###\s*镜\s*\d+/g) ?? []).length
}

export function summarizePromptCompletion(
  mode: string | null | undefined,
  content: string,
): string | null {
  const text = content.trim()
  if (!text) return null

  if (mode === 'commercial_storyboard') {
    const shots = countMarkdownTableDataRows(text)
    if (shots > 0) {
      return `已生成 ${shots} 镜商业分镜表（含策略层与校验锁），双击节点可查看完整表格。`
    }
    if (text.includes('分镜执行脚本')) {
      return '已生成商业分镜结构化文稿，双击节点查看完整内容。'
    }
  }

  if (mode === 'storyboard') {
    const mirrors = countStoryboardMirrorSections(text)
    if (mirrors > 0) {
      return `已生成 ${mirrors} 镜分镜提示词，双击节点查看。`
    }
  }

  return null
}

export function buildPromptNodeCardPreview(input: {
  content: string
  promptMode?: string | null
  maxChars?: number
}): string {
  const text = input.content.trim()
  if (!text) return ''
  const max = input.maxChars ?? 180
  const mode = input.promptMode ?? ''

  if (mode === 'commercial_storyboard') {
    const shots = countMarkdownTableDataRows(text)
    if (shots > 0) {
      return `商业品牌分镜 · ${shots} 镜表格\n双击查看策略层、分镜表与校验锁`
    }
  }

  if (mode === 'storyboard') {
    const mirrors = countStoryboardMirrorSections(text)
    if (mirrors > 0) {
      return `分镜提示词 · ${mirrors} 镜\n双击查看完整内容`
    }
  }

  return text.length > max ? `${text.slice(0, max)}…` : text
}

export const TURNAROUND_INTENT_PATTERN =
  /三视图|四视图|多视图|turnaround|角色设定|模特定妆|正侧背|模特图|q版|q萌|chibi/i

export function isTurnaroundLikePrompt(text: string): boolean {
  return TURNAROUND_INTENT_PATTERN.test(text)
}
