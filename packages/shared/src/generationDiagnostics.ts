export type ErrorCode =
  | 'insufficient_points'
  | 'upstream_timeout'
  | 'upstream_error'
  | 'cancelled'
  | 'invalid_input'
  | 'model_unavailable'
  | 'upload_required'
  | 'fallback_pending'
  | 'unknown'

export type TaskKind = 'generation' | 'material'

export interface GenerationDiagnostic {
  userMessage: string
  code: ErrorCode
  taskKind: TaskKind
  taskId: string
  nodeId?: string
  nodeLabel?: string
  sessionId?: string
  model?: string | null
  channelId?: string | null
  apiFormat?: string | null
  httpStatus?: number | null
  occurredAt: string
  providerSnippet: string | null
  hint?: string
}

const BEARER_PATTERN = /Bearer\s+\S+/gi
const SK_KEY_PATTERN = /sk-[A-Za-z0-9_-]{8,}/g
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const PHONE_PATTERN = /\b1[3-9]\d{9}\b/g
const SENSITIVE_QUERY_PARAM_PATTERN =
  /([?&](?:key|token|signature)=)([^&\s]+)/gi

function redactSensitiveValues(text: string): string {
  return text
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(SK_KEY_PATTERN, 'sk-[REDACTED]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
    .replace(SENSITIVE_QUERY_PARAM_PATTERN, '$1[REDACTED]')
}

export function redactProviderSnippet(raw: string, maxLen = 2048): string {
  let text = redactSensitiveValues(raw)

  if (text.length <= maxLen) {
    return text
  }

  return `${text.slice(0, maxLen)}\n…(truncated)`
}

function isPresent(value: unknown): value is string | number {
  return value !== undefined && value !== null && value !== ''
}

function formatProviderSnippetBlock(snippet: string): string {
  const lines = snippet.split('\n')
  if (lines.length === 1) {
    return `providerSnippet: |\n  ${lines[0]}`
  }
  return `providerSnippet: |\n${lines.map((line) => `  ${line}`).join('\n')}`
}

export function formatDiagnosticCopy(d: GenerationDiagnostic): string {
  const lines = ['lnkpi diagnostic', `code: ${d.code}`, `userMessage: ${d.userMessage}`, `taskKind: ${d.taskKind}`, `taskId: ${d.taskId}`]

  if (isPresent(d.nodeId)) lines.push(`nodeId: ${d.nodeId}`)
  if (isPresent(d.nodeLabel)) lines.push(`nodeLabel: ${d.nodeLabel}`)
  if (isPresent(d.sessionId)) lines.push(`sessionId: ${d.sessionId}`)
  if (isPresent(d.model)) lines.push(`model: ${d.model}`)
  if (isPresent(d.channelId)) lines.push(`channelId: ${d.channelId}`)
  if (isPresent(d.apiFormat)) lines.push(`apiFormat: ${d.apiFormat}`)
  if (isPresent(d.httpStatus)) lines.push(`httpStatus: ${d.httpStatus}`)
  if (isPresent(d.occurredAt)) lines.push(`occurredAt: ${d.occurredAt}`)
  if (isPresent(d.hint)) lines.push(`hint: ${d.hint}`)

  if (d.providerSnippet != null && d.providerSnippet !== '') {
    lines.push(formatProviderSnippetBlock(d.providerSnippet))
  }

  return lines.join('\n')
}

export function mapMessageToErrorCode(message: string): ErrorCode {
  const text = message.trim()
  if (!text) return 'unknown'

  if (text.includes('积分不足')) return 'insufficient_points'
  if (/timeout/i.test(text) || text.includes('ETIMEDOUT')) return 'upstream_timeout'
  if (text.includes('已取消')) return 'cancelled'
  if (text.includes('参考图尚未上传')) return 'upload_required'
  if (text.includes('模型') && text.includes('停用')) return 'model_unavailable'

  return 'unknown'
}
