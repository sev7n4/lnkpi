import { inject, ref } from 'vue'
import { CANVAS_NODE_PATCH_KEY } from '@/composables/canvasNodeActions'
import { fileToPersistedPayload } from '@/composables/useMediaUpload'

export type NodeMediaKind = 'image' | 'video' | 'audio'

const ACCEPT: Record<NodeMediaKind, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
}

export function useNodeMediaUpload(nodeId: string, kind: NodeMediaKind) {
  const patchNode = inject(CANVAS_NODE_PATCH_KEY, null)
  const dragOver = ref(false)
  const rejectFlash = ref(false)
  const fileInput = ref<HTMLInputElement | null>(null)

  function matchesKind(file: File) {
    if (kind === 'image') return file.type.startsWith('image/')
    if (kind === 'video') return file.type.startsWith('video/')
    return file.type.startsWith('audio/')
  }

  function flashReject() {
    rejectFlash.value = true
    window.setTimeout(() => {
      rejectFlash.value = false
    }, 600)
  }

  async function applyFile(file: File) {
    if (!patchNode) return
    if (!matchesKind(file)) {
      flashReject()
      return
    }
    const payload = await fileToPersistedPayload(file)
    patchNode(nodeId, {
      url: payload.url,
      status: 'idle',
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      source: 'upload',
    })
  }

  function openPicker() {
    fileInput.value?.click()
  }

  function onFileChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (file) void applyFile(file)
    ;(event.target as HTMLInputElement).value = ''
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    dragOver.value = true
  }

  function onDragLeave(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    dragOver.value = false
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    dragOver.value = false
    const file = event.dataTransfer?.files?.[0]
    if (file) void applyFile(file)
  }

  return {
    accept: ACCEPT[kind],
    dragOver,
    rejectFlash,
    fileInput,
    openPicker,
    onFileChange,
    onDragOver,
    onDragLeave,
    onDrop,
  }
}
