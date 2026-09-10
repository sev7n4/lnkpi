export function isSegmentUpstreamDegradable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const response = (err as { response?: { status?: number } }).response
  if (!response) return true
  const status = response.status
  return status === 502 || status === 503
}
