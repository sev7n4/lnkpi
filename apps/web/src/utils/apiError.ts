export function apiErrorMessage(err: unknown, fallback = '请求失败'): string {
  const ax = err as {
    response?: { data?: { message?: string | string[]; error?: string } }
    message?: string
  }
  const msg = ax.response?.data?.message ?? ax.response?.data?.error ?? ax.message
  if (Array.isArray(msg)) return msg.join('; ') || fallback
  if (typeof msg === 'string' && msg.trim()) return msg
  return fallback
}
