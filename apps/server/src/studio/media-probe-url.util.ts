const ALLOWED_HOSTS = new Set([
  'platform-outputs.agnes-ai.space',
  '119.29.173.89',
  'localhost',
  '127.0.0.1',
])

export function isAllowedMediaProbeUrl(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return false
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== 'http:' && protocol !== 'https:') {
    return false
  }

  if (ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    return true
  }

  return parsed.pathname.includes('/api/uploads/')
}
