import type { FallbackConfirmDecision, FallbackPendingRequest } from '@/composables/useNodeGeneration'

export function fallbackConfirmKey(req: Pick<FallbackPendingRequest, 'kind' | 'id'>): string {
  return `${req.kind}:${req.id}`
}

export interface FallbackConfirmQueueOptions {
  defaultMessage: string
  onOpen: (message: string) => void
  onClose: () => void
}

/**
 * Serializes BYOK fallback confirms and dedupes by kind:id so polling re-entry
 * reuses the in-flight Promise instead of enqueueing a duplicate that later
 * auto-cancels (racing confirm vs cancel APIs).
 */
export function createFallbackConfirmQueue(opts: FallbackConfirmQueueOptions) {
  const promptedKeys = new Set<string>()
  /** In-flight (queued or actively shown) promises keyed by kind:id */
  const inflightByKey = new Map<string, Promise<FallbackConfirmDecision>>()
  const queue: Array<{
    key: string
    req: FallbackPendingRequest
    resolve: (decision: FallbackConfirmDecision) => void
  }> = []
  let activeKey: string | null = null
  let activeResolve: ((decision: FallbackConfirmDecision) => void) | null = null

  /** True if key is in-flight (queued/showing) or already settled — poller should skip. */
  function isPrompted(key: string): boolean {
    return promptedKeys.has(key) || inflightByKey.has(key)
  }

  function drain() {
    if (activeResolve) return
    while (queue.length) {
      const next = queue.shift()!
      if (promptedKeys.has(next.key) || activeKey === next.key) {
        // Should not happen when request() dedupes; settle as cancel if it does.
        next.resolve('cancel')
        inflightByKey.delete(next.key)
        continue
      }
      promptedKeys.add(next.key)
      activeKey = next.key
      activeResolve = next.resolve
      opts.onOpen(next.req.message?.trim() || opts.defaultMessage)
      return
    }
  }

  function request(req: FallbackPendingRequest): Promise<FallbackConfirmDecision> {
    const key = fallbackConfirmKey(req)

    const inflight = inflightByKey.get(key)
    if (inflight) return inflight

    if (promptedKeys.has(key)) {
      return Promise.resolve('cancel')
    }

    const promise = new Promise<FallbackConfirmDecision>((resolve) => {
      queue.push({ key, req, resolve })
      drain()
    })
    inflightByKey.set(key, promise)
    return promise
  }

  function settle(decision: FallbackConfirmDecision) {
    opts.onClose()
    const resolve = activeResolve
    const key = activeKey
    activeResolve = null
    activeKey = null
    if (key) inflightByKey.delete(key)
    resolve?.(decision)
    drain()
  }

  return { request, settle, isPrompted, fallbackConfirmKey }
}
