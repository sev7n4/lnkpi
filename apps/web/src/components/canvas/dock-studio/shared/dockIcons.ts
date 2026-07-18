/** Shared SVG path helpers for Dock Studio icon buttons. */

export type DockNodeIconKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'prompt'
  | 'input'
  | 'shot'
  | 'director'
  | 'composition'
  | 'world'
  | 'group'

export const DOCK_TYPE_LABELS: Record<string, string> = {
  text: '文本生成',
  image: '图片生成',
  video: '视频生成',
  audio: '音频生成',
  prompt: '提示词',
  mediaInput: '媒体输入',
  shot: '分镜',
  sceneComposer: '导演台',
  videoComposition: '视频合成',
  worldModel: '3D World',
}

export function dockTypeToIcon(type: string): DockNodeIconKind {
  if (type === 'mediaInput') return 'input'
  if (type === 'sceneComposer') return 'director'
  if (type === 'videoComposition') return 'composition'
  if (type === 'worldModel') return 'world'
  if (
    type === 'text' ||
    type === 'image' ||
    type === 'video' ||
    type === 'audio' ||
    type === 'prompt' ||
    type === 'shot' ||
    type === 'group'
  ) {
    return type
  }
  return 'text'
}
