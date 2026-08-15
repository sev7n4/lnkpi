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

export function truncateUrl(url: string, max = 48): string {
  if (url.length <= max) return url
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${url.slice(0, head)}…${url.slice(-tail)}`
}
