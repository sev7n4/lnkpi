import type { VideoGenerateOptions, VideoProvider } from './video-provider'

const DEFAULT_BASE_URL = 'https://api.minimax.io'
const DEFAULT_POLL_INTERVAL_MS = 10_000
const DEFAULT_MAX_POLL_MS = 1_200_000
const ACCOUNT_ERROR_MESSAGE = '视频服务账户异常，请稍后重试或联系管理员'

export function isMiniMaxH3Model(model?: string): boolean {
  return Boolean(model && /^minimax-h3$/i.test(model))
}

function hostnameFromBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl?.trim()) return undefined
  try {
    return new URL(baseUrl).hostname
  } catch {
    return undefined
  }
}

function isGatewayHost(hostname: string, allowedRoots: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return allowedRoots.some((root) => {
    const r = root.toLowerCase()
    return host === r || host.endsWith(`.${r}`)
  })
}

export function isMiniMaxBaseUrl(baseUrl?: string): boolean {
  const hostname = hostnameFromBaseUrl(baseUrl)
  return Boolean(hostname && isGatewayHost(hostname, ['api.minimax.io']))
}

export function normalizeMiniMaxBaseUrl(baseUrl?: string): string {
  const raw = baseUrl?.trim() || DEFAULT_BASE_URL
  return raw.replace(/\/+$/, '')
}

function joinV2Path(normalized: string, pathAfterV2: string): string {
  if (normalized.endsWith('/v2')) return `${normalized}/${pathAfterV2}`
  return `${normalized}/v2/${pathAfterV2}`
}

function mapResolution(resolution?: string): string | undefined {
  if (!resolution?.trim()) return undefined
  const normalized = resolution.trim()
  if (/^768p$/i.test(normalized)) return '768P'
  if (/^2k$/i.test(normalized)) return '2K'
  return normalized
}

function isEndRole(role: string): boolean {
  return /(end|last)/i.test(role)
}

function resolveStartImage(options?: VideoGenerateOptions): string | undefined {
  const fromImage = options?.image?.trim()
  if (fromImage) return fromImage
  const fromRefs = options?.referenceImages?.[0]?.trim()
  if (fromRefs) return fromRefs
  const fromRoles = options?.imageWithRoles?.find((entry) => !isEndRole(entry.role))?.url?.trim()
  return fromRoles || undefined
}

function resolveEndImage(options?: VideoGenerateOptions): string | undefined {
  const fromRefs = options?.referenceImages?.[1]?.trim()
  if (fromRefs) return fromRefs
  const fromRoles = options?.imageWithRoles?.find((entry) => isEndRole(entry.role))?.url?.trim()
  return fromRoles || undefined
}

function buildContent(
  prompt: string,
  startImage?: string,
  endImage?: string,
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  if (startImage) {
    content.push({ type: 'image_url', image_url: { url: startImage }, role: 'first_frame' })
  }
  if (endImage) {
    content.push({ type: 'image_url', image_url: { url: endImage }, role: 'last_frame' })
  }
  return content
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function throwMiniMaxHttpError(status: number, body: string): never {
  if (status === 401 || status === 403) {
    throw new Error(ACCOUNT_ERROR_MESSAGE)
  }
  throw new Error(`MiniMax video request ${status}: ${body}`)
}

export class MiniMaxH3VideoProvider implements VideoProvider {
  constructor(
    private apiKey: string,
    private baseUrl = DEFAULT_BASE_URL,
    _defaultModel = 'minimax-h3',
  ) {}

  async generate(
    prompt: string,
    options?: VideoGenerateOptions,
  ): Promise<{ url: string }> {
    const base = normalizeMiniMaxBaseUrl(this.baseUrl)
    const createUrl = joinV2Path(base, 'video_generation')
    const startImage = resolveStartImage(options)
    const endImage = resolveEndImage(options)
    const isImageMode = Boolean(startImage || endImage)
    const body: Record<string, unknown> = {
      model: 'MiniMax-H3',
      content: buildContent(prompt, startImage, endImage),
    }
    if (!isImageMode) {
      const ratio = options?.aspectRatio?.trim()
      body.ratio = ratio && ratio !== 'adaptive' ? ratio : '16:9'
    }
    if (options?.duration != null && Number.isFinite(options.duration)) {
      body.duration = Math.round(options.duration)
    }
    const resolution = mapResolution(options?.resolution)
    if (resolution) body.resolution = resolution

    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!createRes.ok) {
      throwMiniMaxHttpError(createRes.status, await createRes.text())
    }

    const created = (await createRes.json()) as { task_id?: string }
    const taskId = created.task_id
    if (!taskId) {
      throw new Error(`MiniMax video create: missing task_id (${JSON.stringify(created)})`)
    }

    const pollUrl = joinV2Path(base, `query/video_generation/${encodeURIComponent(taskId)}`)
    const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const maxPollMs = options?.maxPollMs ?? DEFAULT_MAX_POLL_MS
    const deadline = Date.now() + maxPollMs
    let attempt = 0

    while (Date.now() < deadline) {
      if (attempt > 0) await sleep(pollIntervalMs)
      attempt += 1

      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      if (!pollRes.ok) {
        if (pollRes.status === 401 || pollRes.status === 403) {
          throw new Error(ACCOUNT_ERROR_MESSAGE)
        }
        continue
      }

      const statusJson = (await pollRes.json()) as {
        status?: string
        content?: { url?: string }
        file?: { file_url?: string }
      }
      const status = statusJson.status
      if (status === 'succeeded') {
        const url = statusJson.content?.url?.trim() || statusJson.file?.file_url?.trim()
        if (!url) {
          throw new Error(`MiniMax video succeeded without url: ${JSON.stringify(statusJson)}`)
        }
        return { url }
      }
      if (status === 'failed' || status === 'cancelled') {
        throw new Error(`MiniMax video ${status}: ${JSON.stringify(statusJson)}`)
      }
    }

    throw new Error(`MiniMax video poll timeout (${maxPollMs}ms)`)
  }
}
