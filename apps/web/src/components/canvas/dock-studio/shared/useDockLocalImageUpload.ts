import { ref } from 'vue'
import type { LocalRefBinding } from '@/composables/useNodeRefs'
import { persistMediaUrl } from '@/composables/useMediaUpload'

function createLocalRefId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Shared Image/Video/Prompt/Text/Audio Dock local reference image upload. */
export function useDockLocalImageUpload(options: {
  getExistingLocalRefs: () => LocalRefBinding[]
  onPatch: (patch: Record<string, unknown>) => void
  /** Also write legacy referenceImageUrl (Image / Video i2v). */
  syncReferenceImageUrl?: boolean
}) {
  const inputRef = ref<HTMLInputElement | null>(null)
  const uploading = ref(false)
  const uploadProgress = ref(0)
  const uploadError = ref('')

  function pick() {
    inputRef.value?.click()
  }

  async function onFileChange(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file || !file.type.startsWith('image/')) return

    uploadError.value = ''
    uploadProgress.value = 0
    uploading.value = true
    const blobUrl = URL.createObjectURL(file)

    try {
      const url = await persistMediaUrl(file, blobUrl, {
        onProgress: (p) => {
          uploadProgress.value = p
        },
      })
      if (url !== blobUrl) URL.revokeObjectURL(blobUrl)

      const binding: LocalRefBinding = {
        id: createLocalRefId('upload'),
        mediaType: 'image',
        sourceKind: 'upload',
        label: file.name,
        url,
      }
      const patch: Record<string, unknown> = {
        localRefs: [...options.getExistingLocalRefs(), binding],
      }
      if (options.syncReferenceImageUrl) {
        patch.referenceImageUrl = url
      }
      options.onPatch(patch)
    } catch (err) {
      uploadError.value = err instanceof Error ? err.message : '参考图上传失败，请重试'
      URL.revokeObjectURL(blobUrl)
    } finally {
      uploading.value = false
      uploadProgress.value = 0
    }
  }

  return {
    inputRef,
    uploading,
    uploadProgress,
    uploadError,
    pick,
    onFileChange,
  }
}
