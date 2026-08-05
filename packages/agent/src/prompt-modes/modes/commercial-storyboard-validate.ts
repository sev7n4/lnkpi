import { countMarkdownTableDataRows } from '@lnkpi/shared'

const REQUIRED_SECTIONS = [
  '## 1. 商业策略上下文',
  '## 2. 规则映射摘要',
  '## 3. 分镜执行脚本',
  '## 4. 质量校验锁',
]

const EMOTION_WORDS = ['开心', '美丽', '震撼', '惊艳', '氛围感拉满', '非常感动']

export function validateCommercialStoryboardOutput(content: string): {
  ok: boolean
  issues: string[]
} {
  const issues: string[] = []
  const text = content.trim()

  for (const section of REQUIRED_SECTIONS) {
    if (!text.includes(section)) issues.push(`缺少「${section.replace('## ', '')}」`)
  }

  if (!text.includes('| 序号 |')) issues.push('缺少分镜 Markdown 表格表头')

  const rows = countMarkdownTableDataRows(text)
  if (rows < 6) issues.push(`分镜表格行数不足（${rows}，30秒建议≥8镜）`)

  if (!text.includes('- [x]') && !text.includes('- [X]')) {
    issues.push('质量校验锁未逐条勾选 [x]')
  }

  for (const word of EMOTION_WORDS) {
    if (text.includes(word)) issues.push(`含禁用情绪词「${word}」`)
  }

  return { ok: issues.length === 0, issues }
}
