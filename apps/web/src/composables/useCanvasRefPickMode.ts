import { computed, ref } from 'vue'

const active = ref(false)
const pickedNodeIds = ref<Set<string>>(new Set())

/** Agent 🎯 画布引用 Pick 模式 — CanvasPage 与 AgentSideRail 共享 */
export function useCanvasRefPickMode() {
  const pickedCount = computed(() => pickedNodeIds.value.size)

  function activate() {
    active.value = true
    pickedNodeIds.value = new Set()
  }

  function deactivate() {
    active.value = false
    pickedNodeIds.value = new Set()
  }

  function toggle() {
    if (active.value) deactivate()
    else activate()
  }

  function markPicked(nodeId: string) {
    const next = new Set(pickedNodeIds.value)
    next.add(nodeId)
    pickedNodeIds.value = next
  }

  function isPicked(nodeId: string) {
    return pickedNodeIds.value.has(nodeId)
  }

  return {
    active,
    pickedNodeIds,
    pickedCount,
    activate,
    deactivate,
    toggle,
    markPicked,
    isPicked,
  }
}
