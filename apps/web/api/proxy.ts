import type { IncomingHttpHeaders } from 'node:http'

const API_ORIGIN = process.env.LNKPI_API_ORIGIN ?? 'http://119.29.173.89:5100'
const DEFAULT_UPSTREAM_TIMEOUT_MS = 20_000
const MAX_ATTEMPTS = 3

/** Vercel Serverless 最大执行时长（秒），需与上游超时匹配 */
export const config = {
  maxDuration: 120,
}

const LONG_RUNNING_PATHS: Array<{ pattern: RegExp; timeoutMs: number }> = [
  { pattern: /\/studio\/text\/generate$/i, timeoutMs: 120_000 },
  { pattern: /\/studio\/prompt\/generate$/i, timeoutMs: 120_000 },
  { pattern: /\/studio\/image\/generate$/i, timeoutMs: 120_000 },
  { pattern: /\/studio\/image\/variation$/i, timeoutMs: 120_000 },
  { pattern: /\/studio\/video\/generate$/i, timeoutMs: 90_000 },
  { pattern: /\/studio\/audio\/generate$/i, timeoutMs: 60_000 },
]

type VercelRequest = {
  method?: string
  headers: IncomingHttpHeaders
  query?: Record<string, string | string[] | undefined>
  body?: unknown
}

type VercelResponse = {
  status: (code: number) => VercelResponse
  setHeader: (name: string, value: string) => void
  send: (body: string | Buffer) => void
  json: (body: unknown) => void
}

function buildUpstreamPath(query: VercelRequest['query']) {
  const raw = query?.path
  if (!raw) return '/api'
  const parts = Array.isArray(raw) ? raw : [raw]
  const joined = parts
    .flatMap((part) => String(part).split('/'))
    .filter(Boolean)
    .join('/')
  return joined ? `/api/${joined}` : '/api'
}

function resolveUpstreamTimeoutMs(upstreamPath: string): number {
  for (const { pattern, timeoutMs } of LONG_RUNNING_PATHS) {
    if (pattern.test(upstreamPath)) return timeoutMs
  }
  return DEFAULT_UPSTREAM_TIMEOUT_MS
}

function isStudioGeneratePost(method: string, upstreamPath: string): boolean {
  return (
    method === 'POST'
    && /\/studio\/(text|prompt|image|video|audio)\/(generate|variation)$/i.test(upstreamPath)
  )
}

function buildUpstreamUrl(req: VercelRequest) {
  const upstreamPath = buildUpstreamPath(req.query)
  const url = new URL(`${API_ORIGIN}${upstreamPath}`)
  for (const [key, value] of Object.entries(req.query ?? {})) {
    if (key === 'path' || value == null) continue
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item)
    } else {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

function buildUpstreamHeaders(req: VercelRequest) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue
    const lower = key.toLowerCase()
    if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  return headers
}

function buildUpstreamBody(req: VercelRequest) {
  const method = req.method?.toUpperCase() ?? 'GET'
  if (method === 'GET' || method === 'HEAD') return undefined
  if (req.body == null || req.body === '') return undefined
  if (typeof req.body === 'string') return req.body
  return JSON.stringify(req.body)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const method = req.method?.toUpperCase() ?? 'GET'
  const upstreamPath = buildUpstreamPath(req.query)
  const target = buildUpstreamUrl(req)
  const headers = buildUpstreamHeaders(req)
  const body = buildUpstreamBody(req)
  const timeoutMs = resolveUpstreamTimeoutMs(upstreamPath)
  const maxAttempts = isStudioGeneratePost(method, upstreamPath) ? 1 : MAX_ATTEMPTS

  if (body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const upstream = await fetch(target, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
      const responseBody = Buffer.from(await upstream.arrayBuffer())
      res.status(upstream.status)
      upstream.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'transfer-encoding') return
        res.setHeader(key, value)
      })
      res.send(responseBody)
      return
    } catch (error) {
      lastError = error
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
      }
    }
  }

  console.error('[api/proxy] upstream failed', target, lastError)
  res.status(502).json({ code: -1, message: 'API 上游暂时不可用，请稍后重试' })
}
