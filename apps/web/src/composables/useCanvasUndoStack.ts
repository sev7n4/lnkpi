import { ref, toRaw, type Ref } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'

/**
 * Generation / poll / upload outcome fields — never enter the undo stack.
 * Restored on apply from live node data, or from session cache after delete-undo.
 *
 * Note: `content` / `prompt` stay undoable (user-editable). Generation-written
 * `content` may roll back with a later unrelated undo — accepted tradeoff.
 */
export const GENERATION_HISTORY_SKIP_KEYS = [
  'status',
  'url',
  'urls',
  'images',
  'coverUrl',
  'generationRecordId',
  'materialId',
  'errorMessage',
  'errorCode',
  'uploadProgress',
] as const

export type GenerationFieldsCache = Map<string, Record<string, unknown>>

export type CanvasSnapshotEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export type CanvasSnapshot = {
  nodes: EditableFlowNode[]
  edges: CanvasSnapshotEdge[]
}

export type CanvasUndoStackOptions = {
  maxDepth?: number
  getSnapshot: () => CanvasSnapshot
  applySnapshot: (s: CanvasSnapshot) => void
}

export type CanvasUndoStack = {
  /** Post-change commit: previous present → past, current snapshot becomes present; clears future. */
  commitAfterChange: () => void
  /** Alias of commitAfterChange (optional label ignored; kept for call-site clarity). */
  push: (label?: string) => void
  undo: () => boolean
  redo: () => boolean
  clear: () => void
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
}

export function stripGenerationFieldsFromData(
  data: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!data) return {}
  const out: Record<string, unknown> = { ...data }
  for (const key of GENERATION_HISTORY_SKIP_KEYS) {
    delete out[key]
  }
  return out
}

export function pickGenerationFieldsFromData(
  data: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!data) return {}
  const out: Record<string, unknown> = {}
  for (const key of GENERATION_HISTORY_SKIP_KEYS) {
    if (key in data) out[key] = data[key]
  }
  return out
}

/** True when a live patch writes any generation/upload outcome field. */
export function patchTouchesGenerationFields(patch: Record<string, unknown>): boolean {
  return GENERATION_HISTORY_SKIP_KEYS.some((key) => key in patch)
}

/** Merge picked generation fields into the session cache (live outcomes win on conflict). */
export function rememberGenerationFields(
  cache: GenerationFieldsCache,
  nodeId: string,
  data: Record<string, unknown> | undefined | null,
): void {
  const picked = pickGenerationFieldsFromData(data)
  if (Object.keys(picked).length === 0) return
  cache.set(nodeId, { ...(cache.get(nodeId) ?? {}), ...picked })
}

/**
 * Resolve generation fields for a restored node: prefer live (so poll/upload
 * aren't rolled back), fall back to session cache (delete → undo restores url).
 * Always refreshes the cache when live has fields.
 */
export function resolveGenerationFieldsForApply(
  cache: GenerationFieldsCache,
  nodeId: string,
  liveData: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const live = pickGenerationFieldsFromData(liveData)
  if (Object.keys(live).length > 0) {
    cache.set(nodeId, { ...(cache.get(nodeId) ?? {}), ...live })
    return live
  }
  return { ...(cache.get(nodeId) ?? {}) }
}

function cloneSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  return structuredClone(toRaw(snapshot)) as CanvasSnapshot
}

function snapshotKey(snapshot: CanvasSnapshot): string {
  return JSON.stringify(snapshot)
}

/**
 * Pure factory for canvas undo/redo. Call `commitAfterChange` **after** mutating the graph
 * (or after debounced param patches). First call seeds the baseline present without past.
 */
export function createCanvasUndoStack(opts: CanvasUndoStackOptions): CanvasUndoStack {
  const maxDepth = opts.maxDepth ?? 50
  const past: CanvasSnapshot[] = []
  const future: CanvasSnapshot[] = []
  let present: CanvasSnapshot | null = null

  const canUndo = ref(false)
  const canRedo = ref(false)

  function syncFlags() {
    canUndo.value = past.length > 0
    canRedo.value = future.length > 0
  }

  function commitAfterChange() {
    const next = cloneSnapshot(opts.getSnapshot())
    if (present === null) {
      present = next
      syncFlags()
      return
    }
    if (snapshotKey(present) === snapshotKey(next)) return
    past.push(present)
    while (past.length > maxDepth) past.shift()
    present = next
    future.length = 0
    syncFlags()
  }

  function push(_label?: string) {
    commitAfterChange()
  }

  function undo() {
    if (!present || past.length === 0) return false
    future.push(present)
    present = past.pop()!
    opts.applySnapshot(cloneSnapshot(present))
    syncFlags()
    return true
  }

  function redo() {
    if (!present || future.length === 0) return false
    past.push(present)
    while (past.length > maxDepth) past.shift()
    present = future.pop()!
    opts.applySnapshot(cloneSnapshot(present))
    syncFlags()
    return true
  }

  function clear() {
    past.length = 0
    future.length = 0
    present = null
    syncFlags()
  }

  return {
    commitAfterChange,
    push,
    undo,
    redo,
    clear,
    canUndo,
    canRedo,
  }
}

/** Vue-facing alias — same API as createCanvasUndoStack. */
export function useCanvasUndoStack(opts: CanvasUndoStackOptions): CanvasUndoStack {
  return createCanvasUndoStack(opts)
}
