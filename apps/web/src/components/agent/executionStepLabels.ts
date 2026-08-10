/** User-facing labels for execution trace steps (not internal routing names). */

const TYPE_LABELS: Record<string, string> = {
  image: '图片',
  text: '文本',
  video: '视频',
  audio: '音频',
  prompt: '提示词',
}

export function labelFromTextReplace(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  if (t.includes('我来生成') || t.includes('将为你创建') || t.includes('我将创建')) {
    return '理解需求'
  }
  if (t.includes('已在画布创建')) {
    if (t.includes('角色设定图') || t.includes('四格')) return '角色设定图扩写与出图'
    return '创建画布节点'
  }
  if (t.includes('生成完成') || t.includes('部分完成') || t.includes('生成未完成')) {
    return '生成完成'
  }
  if (t.includes('拟定拆解') || (t.includes('方案') && t.includes('节点'))) {
    return '拟定方案'
  }
  if (t.includes('请确认') || t.includes('确认方案')) {
    return '等待确认'
  }
  return '处理中'
}

export function canvasActionLabel(action: {
  type: string
  payload?: {
    nodeType?: string
    data?: Record<string, unknown>
    id?: string
  }
}): string {
  const payload = action.payload ?? {}
  const data = payload.data ?? {}
  const title = String(data.title ?? data.prompt ?? '').trim()
  const shortTitle = title ? `「${title.slice(0, 24)}${title.length > 24 ? '…' : ''}」` : ''
  const typeLabel = TYPE_LABELS[String(payload.nodeType ?? '')] ?? '画布'

  switch (action.type) {
    case 'add_node':
      return `添加${typeLabel}节点${shortTitle}`
    case 'update_node':
      return `更新节点${shortTitle}`
    case 'remove_node':
      return `移除节点${shortTitle}`
    case 'add_edge':
      return '连接画布节点'
    case 'remove_edge':
      return '移除连线'
    case 'set_viewport':
      return '调整画布视图'
    default:
      return '更新画布'
  }
}

export function nodeStatusLabel(status: string): string {
  const s = status.toLowerCase()
  if (s === 'generating' || s === 'running' || s === 'pending') return '节点出图中'
  if (s === 'completed' || s === 'done' || s === 'success') return '节点出图完成'
  if (s === 'failed' || s === 'error') return '节点出图失败'
  return '节点状态更新'
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}m ${rem}s` : `${m}m`
}

const PHASE_HINT_LABELS: Record<string, string> = {
  await_confirm: '等待你确认方案',
  await_copy_confirm: '等待你确认主文案',
  await_topo: '等待你确认节点结构',
  await_atomic_confirm: '等待你确认生成参数',
  await_image_qa: '等待你确认成图效果',
}

export function phaseHintFromInterrupt(payload: {
  phase?: string | null
  node?: string | null
} | null): string | null {
  if (!payload) return null
  const phase = payload.phase?.trim()
  if (phase && PHASE_HINT_LABELS[phase]) return PHASE_HINT_LABELS[phase]
  const node = payload.node?.trim()
  if (node && PHASE_HINT_LABELS[node]) return PHASE_HINT_LABELS[node]
  return null
}
