export function formatMediaBytes(bytes?: number): string | null {
  if (bytes == null) return null
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
}

export function formatMediaDimensions(width?: number, height?: number): string | null {
  if (width == null || height == null) return null
  return `${width}×${height}`
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

export function formatMediaDuration(durationSec?: number): string | null {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec < 0) return null
  const total = Math.floor(durationSec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
}

const MIME_FORMAT: Record<string, string> = {
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
  'audio/wav': 'WAV',
  'audio/x-wav': 'WAV',
  'audio/wave': 'WAV',
  'audio/mp4': 'M4A',
  'audio/aac': 'AAC',
  'audio/ogg': 'OGG',
  'audio/flac': 'FLAC',
  'audio/webm': 'WEBM',
}

export function formatMediaFormat(mimeOrExt?: string): string | null {
  const raw = mimeOrExt?.trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (MIME_FORMAT[lower]) return MIME_FORMAT[lower]
  if (!lower.includes('/')) return lower.replace(/^\./, '').toUpperCase()
  const sub = lower.split('/')[1]?.split(';')[0]?.trim()
  if (!sub) return null
  if (sub === 'mpeg' || sub === 'mp3') return 'MP3'
  return sub.toUpperCase()
}

export function aspectRatioLabel(width?: number, height?: number): string | null {
  if (width == null || height == null || width <= 0 || height <= 0) return null
  const g = gcd(width, height)
  return `${Math.round(width / g)}:${Math.round(height / g)}`
}

export function truncateUrl(url: string, max = 48): string {
  if (url.length <= max) return url
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${url.slice(0, head)}…${url.slice(-tail)}`
}
