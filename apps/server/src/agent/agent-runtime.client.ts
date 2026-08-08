import type { AgentStreamEvent } from '@lnkpi/agent'
import type { SidebarAttachment } from '@lnkpi/shared'

export interface RuntimeRunInput {
  sessionId: string
  userId: string
  message: string
  threadId?: string
  /** W5：用户结构化决策；runtime 通过 aupdate_state 恢复 interrupt_before gate */
  userDecision?: 'confirm' | 'revise' | 'replan' | 'confirm_gen' | 'topo_revise' | 'node_revise'
  /** Runtime skill id after UI→runtime mapping */
  skillId?: string
  focusNodeId?: string
  llmModel?: string
  llmApiKey?: string
  llmBaseUrl?: string
  attachments?: SidebarAttachment[]
  refOrder?: string[]
  mentionedKeys?: string[]
}

export interface RuntimeThreadState {
  threadId: string
  phase: string | null
  nextNodes: string[]
  interrupted: boolean
  finished: boolean
  hasAtomicCheckpoint?: boolean
  atomicNodeId?: string | null
  atomicTargetType?: string | null
  atomicTitle?: string | null
  flowMode?: string | null
}

export interface RuntimeThreadTimelineEntry {
  step: number | null
  source: string | null
  phase: string | null
  nextNodes: string[]
  skillId: string | null
  promptVersion: string | null
  interrupted: boolean
}

export interface RuntimeThreadTimeline {
  threadId: string
  entries: RuntimeThreadTimelineEntry[]
  checkpointCount: number
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

  async getThreadState(threadId: string): Promise<RuntimeThreadState | null> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/threads/${encodeURIComponent(threadId)}/state`
    const headers: Record<string, string> = {}
    const token =
      this.serviceToken?.trim() || process.env.AGENT_RUNTIME_SERVICE_TOKEN?.trim()
    if (token) {
      headers['x-lnkpi-service-token'] = token
    }
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return null
      return (await res.json()) as RuntimeThreadState
    } catch {
      return null
    }
  }

  async getThreadTimeline(threadId: string): Promise<RuntimeThreadTimeline | null> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/threads/${encodeURIComponent(threadId)}/timeline`
    const headers: Record<string, string> = {}
    const token =
      this.serviceToken?.trim() || process.env.AGENT_RUNTIME_SERVICE_TOKEN?.trim()
    if (token) {
      headers['x-lnkpi-service-token'] = token
    }
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return null
      return (await res.json()) as RuntimeThreadTimeline
    } catch {
      return null
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
        // W5：转发 user_decision，供 interrupt_before gate 恢复（见 hitl_resume.py）
        user_decision: input.userDecision,
        skill_id: input.skillId,
        llm_model: input.llmModel,
        llm_api_key: input.llmApiKey,
        llm_base_url: input.llmBaseUrl,
        focus_node_id: input.focusNodeId,
        attachments: input.attachments,
        ref_order: input.refOrder,
        mentioned_keys: input.mentionedKeys,
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
