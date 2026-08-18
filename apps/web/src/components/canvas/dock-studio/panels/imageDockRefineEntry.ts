import { isNodeGenerating } from '@/constants/dockStudio'

export function shouldShowRefineEntry(input: {
  url?: unknown
  readonly: boolean
  enabled: boolean
}) {
  return input.enabled && !input.readonly && String(input.url ?? '').trim().length > 0
}

export function isImageDockReadonly(input: {
  parentReadonly?: boolean
  generating?: boolean
  status?: unknown
}): boolean {
  return (
    !!input.parentReadonly ||
    !!input.generating ||
    isNodeGenerating(input.status) ||
    input.status === 'uploading'
  )
}
