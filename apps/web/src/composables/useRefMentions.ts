export const REF_MENTION_PATTERN = /@([TIVA]\d+)/gi

export type RefMentionSegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; value: string; refKey: string }

/** Extract unique @T1-style ref keys from prompt text (order preserved). */
export function parseRefMentions(text: string): string[] {
  const seen = new Set<string>()
  const keys: string[] = []
  const re = new RegExp(REF_MENTION_PATTERN.source, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const key = match[1].toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

/** Split text into plain segments and @Tn mention tokens for highlight rendering. */
export function splitRefMentions(text: string): RefMentionSegment[] {
  if (!text) return []
  const segments: RefMentionSegment[] = []
  const re = new RegExp(REF_MENTION_PATTERN.source, 'gi')
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, match.index) })
    }
    const refKey = match[1].toUpperCase()
    segments.push({ kind: 'mention', value: match[0], refKey })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) })
  }
  return segments
}
