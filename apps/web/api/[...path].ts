export const config = {
  runtime: 'edge',
}

const API_ORIGIN = process.env.LNKPI_API_ORIGIN ?? 'http://119.29.173.89:5100'
const UPSTREAM_TIMEOUT_MS = 25_000
const MAX_ATTEMPTS = 3

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const upstreamPath = url.pathname.startsWith('/api') ? url.pathname : `/api${url.pathname}`
  const target = `${API_ORIGIN}${upstreamPath}${url.search}`

  const headers = new Headers()
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'host' || lower === 'connection' || lower === 'content-length') return
    headers.set(key, value)
  })

  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()

  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
      const responseBody = await upstream.arrayBuffer()
      const outHeaders = new Headers(upstream.headers)
      return new Response(responseBody, {
        status: upstream.status,
        headers: outHeaders,
      })
    } catch (error) {
      lastError = error
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
      }
    }
  }

  console.error('[api-proxy] upstream failed', target, lastError)
  return Response.json(
    { code: -1, message: 'API 上游暂时不可用，请稍后重试' },
    { status: 502 },
  )
}
