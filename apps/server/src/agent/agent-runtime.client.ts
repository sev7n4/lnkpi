import type { AgentStreamEvent } from '@lnkpi/agent'

export interface RuntimeRunInput {
  sessionId: string
  userId: string
  message: string
  threadId?: string
}

/**
 * HTTP client for Python agent-runtime (`GET /health`, `POST /v1/runs` NDJSON).
 * Nest sends `x-lnkpi-service-token` (AGENT_RUNTIME_SERVICE_TOKEN) on /v1/runs;
 * health stays unauthenticated.
 */
export class AgentRuntimeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken?: string,
  ) {}

  async healthOk(timeoutMs = 3000): Promise<boolean> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/health`
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) return false
      const body = (await res.json()) as { ok?: boolean }
      return body?.ok === true
    } catch {
      return false
    }
  }

  async *streamRun(input: RuntimeRunInput): AsyncGenerator<AgentStreamEvent> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/runs`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    }
    const token =
      this.serviceToken?.trim() || process.env.AGENT_RUNTIME_SERVICE_TOKEN?.trim()
    if (token) {
      headers['x-lnkpi-service-token'] = token
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        session_id: input.sessionId,
        user_id: input.userId,
        message: input.message,
        thread_id: input.threadId ?? input.sessionId,
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(
        `Agent runtime /v1/runs failed: ${res.status}${detail ? ` ${detail}` : ''}`,
      )
    }
    if (!res.body) {
      throw new Error('Agent runtime /v1/runs returned empty body')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        yield* this.parseNdjsonLine(line)
      }
    }

    const tail = buffer.trim()
    if (tail) {
      yield* this.parseNdjsonLine(tail)
    }
  }

  private *parseNdjsonLine(line: string): Generator<AgentStreamEvent> {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      yield JSON.parse(trimmed) as AgentStreamEvent
    } catch {
      yield {
        type: 'error',
        data: {
          message: 'Invalid NDJSON line from agent runtime',
          line: trimmed.slice(0, 200),
        },
      }
    }
  }
}
