import type { InjectionKey } from 'vue'

export type CanvasNodeRenameFn = (nodeId: string, title: string) => void
export type CanvasNodePatchFn = (nodeId: string, patch: Record<string, unknown>) => void

export const CANVAS_NODE_RENAME_KEY: InjectionKey<CanvasNodeRenameFn> = Symbol('canvasNodeRename')
export const CANVAS_NODE_PATCH_KEY: InjectionKey<CanvasNodePatchFn> = Symbol('canvasNodePatch')
