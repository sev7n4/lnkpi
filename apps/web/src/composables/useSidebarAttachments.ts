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
  const item = nodeToSidebarAttachment(node)
  if (!item) return attachments
  const dup = attachments.some(
    (a) => (item.url && a.url === item.url) || (item.sourceNodeId && a.sourceNodeId === item.sourceNodeId),
  )
  if (dup) return attachments
  if (attachments.length >= SIDEBAR_ATTACHMENT_MAX) return attachments
  return [...attachments, { ...item, id: `focus-${node.id}` }]
}

export function nodeToSidebarAttachment(node: FocusNodeLike): SidebarAttachment | null {
  const data = node.data ?? {}
  const url = String(data.url ?? '').trim()
  const text = String(data.content ?? data.prompt ?? '').trim()
  if (!url && !text) return null

  const t = String(node.type ?? '')
  let mediaType: SidebarAttachment['mediaType'] = 'image'
  if (t === 'text' || t === 'prompt') mediaType = 'text'
  else if (t === 'video') mediaType = 'video'
  else if (t === 'audio') mediaType = 'audio'
  else if (t === 'image' || t === 'mediaInput') mediaType = 'image'
  else if (text && !url) mediaType = 'text'
  else if (!url) return null

  return {
    id: randomId(),
    mediaType,
    sourceKind: 'canvasNode',
    label: String(data.title ?? data.label ?? (t || node.id)),
    url: url || undefined,
    text: text || undefined,
    sourceNodeId: node.id,
  }
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

  function reorder(ids: string[]) {
    const byId = new Map(pendingAttachments.value.map((a) => [a.id, a]))
    pendingAttachments.value = ids
      .map((id) => byId.get(id))
      .filter((a): a is SidebarAttachment => Boolean(a))
  }

  function clear() {
    pendingAttachments.value = []
  }

  function assignRefKeys(): string[] {
    return assignRefKeysFor(pendingAttachments.value)
  }

  function addFromCanvasNode(node: FocusNodeLike): boolean {
    const item = nodeToSidebarAttachment(node)
    if (!item) return false
    if (pendingAttachments.value.length >= SIDEBAR_ATTACHMENT_MAX) return false
    addFromPayload(item)
    return true
  }

  function addFromCanvasNodes(nodes: FocusNodeLike[]): number {
    let count = 0
    for (const n of nodes) {
      if (pendingAttachments.value.length >= SIDEBAR_ATTACHMENT_MAX) break
      if (addFromCanvasNode(n)) count += 1
    }
    return count
  }

  function toPayload() {
    return { attachments: [...pendingAttachments.value], refOrder: refOrder.value }
  }

  return { pendingAttachments, refOrder, addFromFile, addFromPayload, addFromCanvasNode, addFromCanvasNodes, remove, reorder, clear, toPayload, assignRefKeys }
}
