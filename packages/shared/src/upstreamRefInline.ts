const UPLOAD_PATH_PREFIX = '/api/uploads/'

export type UploadRefPath = { userId: string; fileName: string }

/** Parse `/api/uploads/{userId}/{file}` from a relative or absolute URL. */
export function parseUploadRefPath(url: string): UploadRefPath | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  let pathname = ''
  if (trimmed.startsWith(UPLOAD_PATH_PREFIX)) {
    pathname = trimmed.split('?')[0].split('#')[0]
  } else {
    try {
      pathname = new URL(trimmed).pathname
    } catch {
      return null
    }
  }

  const match = pathname.match(/^\/api\/uploads\/([^/]+)\/([^/]+)$/)
  if (!match) return null
  return { userId: match[1], fileName: match[2] }
}

function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(h)
}

/**
 * Whether an upstream image API (Agnes / Apimart) must not fetch this URL directly.
 * lnkpi uploads are always inlined server-side so refs work with :8888 today and HTTPS domain later.
 */
export function needsUpstreamRefInline(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed || /^(data:|blob:)/i.test(trimmed)) return false
  if (parseUploadRefPath(trimmed)) return true

  try {
    const parsed = new URL(trimmed)
    if (isPrivateOrLoopbackHost(parsed.hostname)) return true
    const port = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === 'https:' ? 443 : 80
    return port !== 80 && port !== 443
  } catch {
    return trimmed.startsWith(UPLOAD_PATH_PREFIX)
  }
}

export function upstreamRefInlineIndexes(urls: string[]): number[] {
  return urls.map((url, index) => (needsUpstreamRefInline(url) ? index : -1)).filter((i) => i >= 0)
}
