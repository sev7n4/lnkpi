/** Map runtime error_type to user-facing trace detail. */

const ERROR_TYPE_DETAIL: Record<string, string> = {
  tool_timeout: '服务响应超时，可稍后重试',
  downstream_unavailable: '生成服务暂不可用',
  circuit_open: '服务繁忙，请稍后再试',
  internal_error: '内部错误，请重试或联系支持',
}

export function errorDetailFromType(errorType: string | undefined): string | undefined {
  if (!errorType) return undefined
  return ERROR_TYPE_DETAIL[errorType] ?? undefined
}

export function formatStructuredError(data: {
  message?: string
  error_type?: string
  retry_hint?: string
  tool_name?: string
}): { label: string; detail: string } {
  const detail =
    data.retry_hint?.trim()
    || errorDetailFromType(data.error_type)
    || data.message?.trim()
    || '发生未知错误'
  const label = data.tool_name ? `「${data.tool_name}」执行失败` : '执行失败'
  return { label, detail: detail.slice(0, 220) }
}
