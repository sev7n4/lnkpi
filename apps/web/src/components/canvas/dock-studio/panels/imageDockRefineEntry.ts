export function shouldShowRefineEntry(input: {
  url?: unknown
  readonly: boolean
  enabled: boolean
}) {
  return input.enabled && !input.readonly && String(input.url ?? '').trim().length > 0
}
