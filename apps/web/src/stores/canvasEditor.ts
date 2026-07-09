import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ImageEditTarget {
  nodeId: string
  url: string
  prompt?: string
}

export const useCanvasEditorStore = defineStore('canvasEditor', () => {
  const imageTarget = ref<ImageEditTarget | null>(null)

  function openImageEditor(target: ImageEditTarget) {
    imageTarget.value = target
  }

  function closeImageEditor() {
    imageTarget.value = null
  }

  return { imageTarget, openImageEditor, closeImageEditor }
})
