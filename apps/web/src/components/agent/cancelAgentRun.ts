export async function cancelAgentRun(opts: {
  threadId: string
  sessionId: string
  abort: () => void
  postCancel?: (body: {
    threadId: string
    sessionId: string
    reason: 'user'
  }) => Promise<unknown>
}): Promise<{ apiOk: boolean; skipped?: boolean }> {
  let apiOk = false
  let skipped: boolean | undefined

  try {
    if (opts.postCancel) {
      const res = (await opts.postCancel({
        threadId: opts.threadId,
        sessionId: opts.sessionId,
        reason: 'user',
      })) as { data?: { ok?: boolean; skipped?: boolean } }
      apiOk = res?.data?.ok !== false
      skipped = res?.data?.skipped
    }
  } catch {
    apiOk = false
  } finally {
    opts.abort()
  }

  return { apiOk, skipped }
}
