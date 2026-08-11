/** Scheme draft prose section parsing (UX-PV-05). */

export const SCHEME_DRAFT_HEADINGS = [
  '## 我理解您的需求',
  '## 设计方向摘要',
  '## 完整方案说明',
  '## 接下来请您',
] as const

export interface SchemeDraftSection {
  heading: string
  body: string
}

export function splitAssistantDraftMessage(content: string): { prose: string; footer?: string } {
  const marker = '\n\n---\n'
  const idx = content.indexOf(marker)
  if (idx >= 0) {
    return {
      prose: content.slice(0, idx).trim(),
      footer: content.slice(idx + marker.length).trim(),
    }
  }
  return { prose: content.trim() }
}

export function hasSchemeDraftSections(prose: string): boolean {
  const text = prose.trim()
  return SCHEME_DRAFT_HEADINGS.every((heading) => text.includes(heading))
}

export function splitSchemeDraftSections(prose: string): SchemeDraftSection[] {
  const text = prose.trim()
  if (!text) return []

  const sections: SchemeDraftSection[] = []
  for (let i = 0; i < SCHEME_DRAFT_HEADINGS.length; i += 1) {
    const heading = SCHEME_DRAFT_HEADINGS[i]
    const start = text.indexOf(heading)
    if (start < 0) continue

    const bodyStart = start + heading.length
    const nextHeading = SCHEME_DRAFT_HEADINGS[i + 1]
    const end = nextHeading ? text.indexOf(nextHeading, bodyStart) : text.length
    const body = text.slice(bodyStart, end < 0 ? text.length : end).trim()
    sections.push({ heading: heading.replace(/^##\s*/, ''), body })
  }
  return sections
}

export function truncateMacroSummary(summary: string | null | undefined, max = 80): string {
  const text = String(summary ?? '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}
