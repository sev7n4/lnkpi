import type { InjectionKey } from 'vue'

export type CanvasNodeRenameFn = (nodeId: string, title: string) => void

export const CANVAS_NODE_RENAME_KEY: InjectionKey<CanvasNodeRenameFn> = Symbol('canvasNodeRename')
