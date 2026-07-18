import { computed, ref, type Ref } from 'vue'
export { EDITABLE_NODE_TYPES } from '@/constants/dockStudio'

export interface EditableFlowNode {
  id: string
  type?: string
  data?: Record<string, unknown>
  position: { x: number; y: number }
  selected?: boolean
  parentNode?: string
  extent?: 'parent' | [[number, number], [number, number]]
  expandParent?: boolean
}

export function useSelectedNodeEditor(nodes: Ref<EditableFlowNode[]>) {
  const selectedNodeId = ref<string | null>(null)

  const selectedNode = computed((): EditableFlowNode | null => {
    if (!selectedNodeId.value) return null
    for (const node of nodes.value) {
      if (node.id === selectedNodeId.value) return node
    }
    return null
  })

  function clearEditorSelection() {
    selectedNodeId.value = null
  }

  /** 不可变更新 selected，避免与 applyNodeChanges 抢状态时出现「幽灵多选」 */
  function clearSelection() {
    clearEditorSelection()
    nodes.value = nodes.value.map((node) =>
      node.selected ? { ...node, selected: false } : node,
    )
  }

  function selectNode(id: string | null) {
    selectedNodeId.value = id
    nodes.value = nodes.value.map((node) => {
      const selected = id !== null && node.id === id
      return node.selected === selected ? node : { ...node, selected }
    })
  }

  function patchNodeData(id: string, patch: Record<string, unknown>) {
    nodes.value = nodes.value.map((node) =>
      node.id === id ? { ...node, data: { ...(node.data ?? {}), ...patch } } : node,
    )
  }

  return {
    selectedNodeId,
    selectedNode,
    selectNode,
    clearEditorSelection,
    clearSelection,
    patchNodeData,
  }
}
