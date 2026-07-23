import { onUnmounted } from 'vue'

export type DebouncedNodePatchOptions = {
  /** Called when a debounced patch settles (or flush), before persist — e.g. undo history commit. */
  onHistoryCommit?: () => void
}

export function useDebouncedNodePatch(
  applyPatch: (id: string, patch: Record<string, unknown>) => void,
  persist: () => Promise<void>,
  delayMs = 400,
  options?: DebouncedNodePatchOptions,
) {
  let timer: ReturnType<typeof setTimeout> | undefined

  function settle() {
    options?.onHistoryCommit?.()
    return persist()
  }

  function patchNode(id: string, patch: Record<string, unknown>) {
    applyPatch(id, patch)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void settle()
    }, delayMs)
  }

  async function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    await settle()
  }

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
  })

  return { patchNode, flush }
}
