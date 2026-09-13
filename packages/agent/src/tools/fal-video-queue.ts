export const FAL_ACCOUNT_ERROR_MESSAGE = '视频服务账户异常，请稍后重试或联系管理员'

export interface FalVideoQueueOptions {
  apiKey: string
  baseUrl?: string
  endpointId: string
  input: Record<string, unknown>
  pollIntervalMs?: number
  maxPollMs?: number
}

const DEFAULT_QUEUE_BASE = 'https://queue.fal.run'
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_MAX_POLL_MS = 600_000

export function resolveFalQueueBase(baseUrl?: string): string {
  if (!baseUrl?.trim()) return DEFAULT_QUEUE_BASE
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return DEFAULT_QUEUE_BASE
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'queue.fal.run' || (host.startsWith('queue.') && host.endsWith('.fal.run'))) {
    return `${parsed.protocol}//${host}`
  }
  if (host === 'fal.run' || host.endsWith('.fal.run')) {
    return `${parsed.protocol}//queue.${host}`
  }
  return DEFAULT_QUEUE_BASE
}

function falAuthHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Key ${apiKey}` }
}

function extractVideoUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  const nested = record.response
  if (nested && typeof nested === 'object') {
    const video = (nested as Record<string, unknown>).video
    if (video && typeof video === 'object') {
      const url = (video as Record<string, unknown>).url
      if (typeof url === 'string' && url.trim()) return url.trim()
    }
  }
  const video = record.video
  if (video && typeof video === 'object') {
    const url = (video as Record<string, unknown>).url
    if (typeof url === 'string' && url.trim()) return url.trim()
  }
  return undefined
}

function isAccountLockedError(status: number, body: string): boolean {
  if (status !== 401 && status !== 403) return false
  return /top_up|locked/i.test(body)
}

export function throwFalVideoHttpError(status: number, body: string): never {
  if (isAccountLockedError(status, body)) {
    throw new Error(FAL_ACCOUNT_ERROR_MESSAGE)
  }
  throw new Error(`Fal video request ${status}: ${body}`)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function runFalVideoQueue(options: FalVideoQueueOptions): Promise<{ url: string }> {
  const queueBase = resolveFalQueueBase(options.baseUrl).replace(/\/$/, '')
  const submitUrl = `${queueBase}/${options.endpointId.replace(/^\//, '')}`
  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...falAuthHeaders(options.apiKey),
    },
    body: JSON.stringify(options.input),
  })
  if (!submitRes.ok) {
    throwFalVideoHttpError(submitRes.status, await submitRes.text())
  }

  const submitted = (await submitRes.json()) as {
    status_url?: string
    response_url?: string
    status?: string
    response?: { video?: { url?: string } }
    video?: { url?: string }
  }
  const immediateUrl = extractVideoUrl(submitted)
  if (immediateUrl) return { url: immediateUrl }

  const statusUrl = submitted.status_url
  if (!statusUrl) {
    throw new Error(`Fal video queue: missing status_url (${JSON.stringify(submitted)})`)
  }

  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const maxPollMs = options.maxPollMs ?? DEFAULT_MAX_POLL_MS
  const deadline = Date.now() + maxPollMs
  let attempt = 0

  while (Date.now() < deadline) {
    if (attempt > 0) await sleep(pollIntervalMs)
    attempt += 1

    const pollRes = await fetch(statusUrl, {
      headers: falAuthHeaders(options.apiKey),
    })
    if (!pollRes.ok) {
      if (isAccountLockedError(pollRes.status, await pollRes.text())) {
        throw new Error(FAL_ACCOUNT_ERROR_MESSAGE)
      }
      continue
    }

    const statusJson = (await pollRes.json()) as {
      status?: string
      response_url?: string
      response?: { video?: { url?: string } }
      video?: { url?: string }
      error?: unknown
    }
    const status = statusJson.status?.toUpperCase()
    if (status === 'COMPLETED') {
      const fromStatus = extractVideoUrl(statusJson)
      if (fromStatus) return { url: fromStatus }

      const responseUrl = statusJson.response_url ?? submitted.response_url
      if (responseUrl) {
        const resultRes = await fetch(responseUrl, {
          headers: falAuthHeaders(options.apiKey),
        })
        if (!resultRes.ok) {
          throwFalVideoHttpError(resultRes.status, await resultRes.text())
        }
        const resultJson = await resultRes.json()
        const fromResult = extractVideoUrl(resultJson)
        if (fromResult) return { url: fromResult }
        throw new Error(`Fal video completed without url: ${JSON.stringify(resultJson)}`)
      }
      throw new Error(`Fal video completed without url: ${JSON.stringify(statusJson)}`)
    }
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'CANCELED') {
      throw new Error(`Fal video failed: ${JSON.stringify(statusJson.error ?? statusJson)}`)
    }
  }

  throw new Error(`Fal video poll timeout (${maxPollMs}ms)`)
}
