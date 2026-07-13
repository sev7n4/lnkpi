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

  function clearSelection() {
    clearEditorSelection()
    for (const node of nodes.value) {
      node.selected = false
    }
  }

  function selectNode(id: string | null) {
    selectedNodeId.value = id
    for (const node of nodes.value) {
      node.selected = id !== null && node.id === id
    }
  }

  function patchNodeData(id: string, patch: Record<string, unknown>) {
    for (const node of nodes.value) {
      if (node.id === id) {
        node.data = { ...(node.data ?? {}), ...patch }
        break
      }
    }
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
