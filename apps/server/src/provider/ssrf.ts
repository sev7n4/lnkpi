const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 loopback
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local / metadata
]

function ipv4ToInt(host: string): number | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const n = Number(part)
    if (n < 0 || n > 255) return null
    value = (value << 8) | n
  }
  return value >>> 0
}

function isPrivateIpv4(host: string): boolean {
  const value = ipv4ToInt(host)
  if (value === null) return false
  return PRIVATE_IPV4_RANGES.some(([start, end]) => value >= start && value <= end)
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (normalized.startsWith('fe80')) return true
  return false
}

function isLocalhostHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return normalized === 'localhost' || normalized.endsWith('.localhost')
}

function isBlockedHost(host: string): boolean {
  const normalized = host.toLowerCase()
  if (isLocalhostHost(normalized)) return true
  if (isPrivateIpv4(normalized)) return true
  if (normalized.includes(':') && isPrivateIpv6(normalized)) return true
  return false
}

export function assertSafeOutboundUrl(
  url: string,
  opts?: { allowHttpLocalhost?: boolean },
): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL')
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('URL must use http or https')
  }

  const host = parsed.hostname
  const allowHttpLocalhost = opts?.allowHttpLocalhost === true

  if (protocol === 'http:') {
    if (!allowHttpLocalhost || !isLocalhostHost(host)) {
      throw new Error('HTTP is only allowed for localhost when allowHttpLocalhost is set')
    }
    return parsed
  }

  if (isBlockedHost(host)) {
    throw new Error('URL points to a private or restricted address')
  }

  return parsed
}
