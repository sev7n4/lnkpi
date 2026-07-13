import { onUnmounted } from 'vue'

export function useDebouncedNodePatch(
  applyPatch: (id: string, patch: Record<string, unknown>) => void,
  persist: () => Promise<void>,
  delayMs = 400,
) {
  let timer: ReturnType<typeof setTimeout> | undefined

  function patchNode(id: string, patch: Record<string, unknown>) {
    applyPatch(id, patch)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void persist()
    }, delayMs)
  }

  async function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    await persist()
  }

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
  })

  return { patchNode, flush }
}
