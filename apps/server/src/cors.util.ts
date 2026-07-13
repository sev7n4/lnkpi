function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function patternToRegExp(pattern: string) {
  const trimmed = pattern.trim()
  if (!trimmed.includes('*')) return null
  const regex = `^${escapeRegex(trimmed).replace(/\\\*/g, '.*')}$`
  return new RegExp(regex)
}

export function isOriginAllowed(origin: string, configured: string[]) {
  for (const entry of configured) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    if (trimmed === origin) return true
    const wildcard = patternToRegExp(trimmed)
    if (wildcard?.test(origin)) return true
  }
  return false
}

export function parseCorsOrigins(raw?: string) {
  const fallback = 'http://localhost:5173'
  const value = raw?.trim() || fallback
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}
