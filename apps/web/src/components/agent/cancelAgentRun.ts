export interface CancelAgentRunResult {
  apiOk: boolean
  skipped?: boolean
  completedTasks?: number
  totalTasks?: number
  gatePreserved?: boolean
}

export async function cancelAgentRun(opts: {
  threadId: string
  sessionId: string
  abort: () => void
  postCancel?: (body: {
    threadId: string
    sessionId: string
    reason: 'user'
  }) => Promise<unknown>
}): Promise<CancelAgentRunResult> {
  const result: CancelAgentRunResult = { apiOk: false }

  try {
    if (opts.postCancel) {
      const res = (await opts.postCancel({
        threadId: opts.threadId,
        sessionId: opts.sessionId,
        reason: 'user',
      })) as {
        data?: {
          ok?: boolean
          skipped?: boolean
          completedTasks?: number
          totalTasks?: number
          gatePreserved?: boolean
        }
      }
      result.apiOk = res?.data?.ok === true
      result.skipped = res?.data?.skipped
      result.gatePreserved = res?.data?.gatePreserved
      if (typeof res?.data?.completedTasks === 'number') {
        result.completedTasks = res.data.completedTasks
      }
      if (typeof res?.data?.totalTasks === 'number') {
        result.totalTasks = res.data.totalTasks
      }
    }
  } catch {
    result.apiOk = false
  } finally {
    opts.abort()
  }

  return result
}

/** Callout text for a stopped run; mirrors the runtime cancelled presentation. */
export function cancelledCalloutTextFromProgress(
  completedTasks?: number,
  totalTasks?: number,
): string | null {
  if (typeof completedTasks !== 'number' || typeof totalTasks !== 'number') return null
  if (totalTasks <= 0) return null
  const done = Math.max(0, completedTasks)
  const total = Math.max(done, totalTasks)
  return `已停止出图（完成 ${done}/${total}）。直接说修改意见，或点「发起新任务」。`
}
