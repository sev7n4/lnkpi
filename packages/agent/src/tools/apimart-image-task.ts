function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function extractApimartTaskId(json: unknown): string | undefined {
  const payload = json as {
    data?: Array<{ task_id?: string }> | { id?: string; task_id?: string }
  }
  if (Array.isArray(payload.data)) {
    return payload.data[0]?.task_id
  }
  if (payload.data && typeof payload.data === 'object') {
    const data = payload.data as { id?: string; task_id?: string }
    return data.task_id ?? data.id
  }
  return undefined
}

export function extractApimartImageUrls(data: unknown): string[] {
  const result = (data as { result?: { images?: Array<{ url?: string | string[] }> } }).result
  const images = result?.images ?? []
  const urls: string[] = []
  for (const item of images) {
    if (Array.isArray(item.url)) {
      urls.push(...item.url.filter((url): url is string => Boolean(url)))
    } else if (typeof item.url === 'string') {
      urls.push(item.url)
    }
  }
  return urls
}

export async function pollApimartImageTask(opts: {
  baseUrl: string
  apiKey: string
  taskId: string
  pollIntervalMs?: number
  maxPollMs?: number
}): Promise<string[]> {
  const root = opts.baseUrl.replace(/\/$/, '')
  const intervalMs = opts.pollIntervalMs ?? 8_000
  const maxPollMs = opts.maxPollMs ?? 360_000
  const deadline = Date.now() + maxPollMs

  while (Date.now() < deadline) {
    await sleep(intervalMs)
    const res = await fetch(`${root}/tasks/${encodeURIComponent(opts.taskId)}`, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    })
    if (!res.ok) continue

    const json = await res.json()
    const data = (json as { data?: unknown }).data ?? json
    const status = (data as { status?: string }).status
    if (status === 'completed') {
      const urls = extractApimartImageUrls(data)
      if (urls.length) return urls
    }
    if (status === 'failed') {
      throw new Error(`Image task failed: ${JSON.stringify((data as { error?: unknown }).error ?? data)}`)
    }
  }

  throw new Error(`Image task poll timeout (${maxPollMs}ms)`)
}
