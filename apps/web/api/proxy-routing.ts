/** Pure routing helpers for Vercel `/api/proxy` — kept free of Node HTTP types for vitest. */

export const DEFAULT_UPSTREAM_TIMEOUT_MS = 20_000
export const MAX_ATTEMPTS = 3

/**
 * 长耗时上游。
 * Agent 对话是 SSE 且非幂等：必须长超时、禁止重试、必须透传流。
 */
export const LONG_RUNNING_PATHS: Array<{ pattern: RegExp; timeoutMs: number }> = [
  { pattern: /\/agent\/chat\/conversation$/i, timeoutMs: 120_000 },
  { pattern: /\/studio\/text\/generate$/i, timeoutMs: 120_000 },
  { pattern: /\/studio\/prompt\/generate$/i, timeoutMs: 120_000 },
  { pattern: /\/studio\/image\/generate$/i, timeoutMs: 120_000 },
  { pattern: /\/studio\/image\/variation$/i, timeoutMs: 120_000 },
  { pattern: /\/studio\/video\/generate$/i, timeoutMs: 90_000 },
  { pattern: /\/studio\/audio\/generate$/i, timeoutMs: 60_000 },
  { pattern: /\/upload(\/|$)/i, timeoutMs: 120_000 },
]

export function buildUpstreamPath(
  query: Record<string, string | string[] | undefined> | undefined,
): string {
  const raw = query?.path
  if (!raw) return '/api'
  const parts = Array.isArray(raw) ? raw : [raw]
  const joined = parts
    .flatMap((part) => String(part).split('/'))
    .filter(Boolean)
    .join('/')
  return joined ? `/api/${joined}` : '/api'
}

export function resolveUpstreamTimeoutMs(upstreamPath: string): number {
  for (const { pattern, timeoutMs } of LONG_RUNNING_PATHS) {
    if (pattern.test(upstreamPath)) return timeoutMs
  }
  return DEFAULT_UPSTREAM_TIMEOUT_MS
}

export function isStreamProxyPath(upstreamPath: string): boolean {
  return /\/agent\/chat\/conversation$/i.test(upstreamPath)
}

export function isStudioGeneratePost(method: string, upstreamPath: string): boolean {
  return (
    method === 'POST'
    && /\/studio\/(text|prompt|image|video|audio)\/(generate|variation)$/i.test(upstreamPath)
  )
}

/** 非幂等：失败重试会重复写 user message / 占 thread 锁 */
export function shouldRetryUpstream(method: string, upstreamPath: string): boolean {
  if (isStreamProxyPath(upstreamPath)) return false
  if (isStudioGeneratePost(method, upstreamPath)) return false
  return true
}
