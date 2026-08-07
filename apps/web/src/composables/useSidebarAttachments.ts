import { ref, computed } from 'vue'
import type { SidebarAttachment } from '@lnkpi/shared'
import { SIDEBAR_ATTACHMENT_MAX } from '@lnkpi/shared'
import { fileToPersistedPayload } from '@/composables/useMediaUpload'

import { randomId } from '@/utils/randomId'

const REF_PREFIX = { text: 'T', image: 'I', video: 'V', audio: 'A' } as const

export type FocusNodeLike = {
  id: string
  type?: string
  data?: Record<string, unknown>
}

export function assignRefKeysFor(attachments: SidebarAttachment[]): string[] {
  const counters = { text: 0, image: 0, video: 0, audio: 0 }
  return attachments.map((a) => {
    counters[a.mediaType] += 1
    return `${REF_PREFIX[a.mediaType]}${counters[a.mediaType]}`
  })
}

export function mergeFocusNodeRef(
  attachments: SidebarAttachment[],
  node: FocusNodeLike | null,
): SidebarAttachment[] {
  if (!node) return attachments
  const data = node.data ?? {}
  const url = String(data.url ?? '').trim()
  const text = String(data.content ?? data.prompt ?? '').trim()
  if (!url && !text) return attachments
  const mediaType = node.type === 'text' || node.type === 'prompt' ? 'text' : 'image'
  const item: SidebarAttachment = {
    id: `focus-${node.id}`,
    mediaType,
    sourceKind: 'canvasNode',
    label: String(data.title ?? data.label ?? node.type ?? node.id),
    url: url || undefined,
    text: text || undefined,
    sourceNodeId: node.id,
  }
  const dup = attachments.some(
    (a) => (item.url && a.url === item.url) || (item.sourceNodeId && a.sourceNodeId === item.sourceNodeId),
  )
  if (dup) return attachments
  if (attachments.length >= SIDEBAR_ATTACHMENT_MAX) return attachments
  return [...attachments, item]
}

export function useSidebarAttachments() {
  const pendingAttachments = ref<SidebarAttachment[]>([])
  const refOrder = computed(() => pendingAttachments.value.map((a) => a.id))

  function addFromPayload(item: SidebarAttachment) {
    if (pendingAttachments.value.length >= SIDEBAR_ATTACHMENT_MAX) return
    const dup = pendingAttachments.value.some(
      (a) => (item.url && a.url === item.url) || (item.sourceNodeId && a.sourceNodeId === item.sourceNodeId),
    )
    if (dup) return
    pendingAttachments.value = [...pendingAttachments.value, item]
  }

  async function addFromFile(file: File) {
    const payload = await fileToPersistedPayload(file)
    if (payload.url.startsWith('blob:')) throw new Error('请先完成上传')
    const mediaType =
      payload.kind === 'text'
        ? 'text'
        : payload.kind === 'video'
          ? 'video'
          : payload.kind === 'audio'
            ? 'audio'
            : 'image'
    addFromPayload({
      id: randomId(),
      mediaType,
      sourceKind: 'upload',
      label: payload.fileName,
      url: mediaType !== 'text' ? payload.url : undefined,
      text: mediaType === 'text' ? payload.textContent : undefined,
    })
  }

  function remove(id: string) {
    pendingAttachments.value = pendingAttachments.value.filter((a) => a.id !== id)
  }

  function clear() {
    pendingAttachments.value = []
  }

  function assignRefKeys(): string[] {
    return assignRefKeysFor(pendingAttachments.value)
  }

  function toPayload() {
    return { attachments: [...pendingAttachments.value], refOrder: refOrder.value }
  }

  return { pendingAttachments, refOrder, addFromFile, addFromPayload, remove, clear, toPayload, assignRefKeys }
}
