const UPLOAD_PATH_PREFIX = '/api/uploads/'

function readPublicBase(explicit?: string): string {
  const raw =
    explicit ??
    (typeof process !== 'undefined' ? process.env.API_PUBLIC_URL : undefined) ??
    ''
  return raw.replace(/\/$/, '')
}

/**
 * Rewrite canvas upload URLs to the configured public API entry (nginx :8888, etc.).
 * Leaves third-party HTTPS URLs (platform-outputs, CDN) unchanged.
 */
export function resolvePublicMediaUrl(url: string, opts?: { publicBase?: string }): string {
  const trimmed = url.trim()
  if (!trimmed || /^(data:|blob:)/i.test(trimmed)) return trimmed

  const publicBase = readPublicBase(opts?.publicBase)
  if (!publicBase) return trimmed

  let pathname = ''
  let search = ''
  if (trimmed.startsWith(UPLOAD_PATH_PREFIX)) {
    const q = trimmed.indexOf('?')
    pathname = q === -1 ? trimmed : trimmed.slice(0, q)
    search = q === -1 ? '' : trimmed.slice(q)
  } else {
    try {
      const parsed = new URL(trimmed)
      if (!parsed.pathname.startsWith(UPLOAD_PATH_PREFIX)) return trimmed
      pathname = parsed.pathname
      search = parsed.search
    } catch {
      return trimmed
    }
  }

  return `${publicBase}${pathname}${search}`
}

export function resolvePublicMediaUrls(
  urls: string[],
  opts?: { publicBase?: string },
): string[] {
  return urls.map((url) => resolvePublicMediaUrl(url, opts)).filter(Boolean)
}
