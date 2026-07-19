export type ByokFailureClass = 'auth' | 'network' | 'upstream' | 'unknown'

export function classifyByokFailure(err: unknown): ByokFailureClass {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (/401|403|unauthorized|forbidden|api.?key|auth|missing.?key/.test(msg)) return 'auth'
  if (/network|econnrefused|etimedout|fetch failed|enotfound|timeout/.test(msg)) return 'network'
  if (/500|502|503|upstream|provider|gateway/.test(msg)) return 'upstream'
  return 'unknown'
}
