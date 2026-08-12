/** Extract the first JSON object from model prose (markdown fences tolerated). */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  let text = (raw ?? '').trim()
  if (!text) return null
  if (text.startsWith('```')) {
    text = text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : text.replace(/`/g, '')
    if (text.endsWith('```')) text = text.slice(0, -3).trim()
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
