export type CompositionVideoCanvas = {
  nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>
  compositionRunGroup?: { nodeIds: string[]; dumpHash: string; createdAt: string }
}

export type CompositionVideoPromptResult =
  | { prompt: string }
  | { error: 'empty_p_block_v' }

function trimmedField(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function blockText(data: Record<string, unknown> | undefined): string {
  return trimmedField(data, 'prompt') || trimmedField(data, 'content')
}

function firstRunGroupTextNode(canvas: CompositionVideoCanvas) {
  const ids = canvas.compositionRunGroup?.nodeIds
  if (!ids?.length) return undefined
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]))
  for (const id of ids) {
    const node = byId.get(id)
    if (node?.type === 'text') return node
  }
  return undefined
}

export function resolveCompositionVideoPrompt(
  canvas: CompositionVideoCanvas,
  videoNodeId: string,
): CompositionVideoPromptResult {
  const textP = canvas.nodes.find((node) => node.id === 'text-p')
  if (textP) {
    const prompt = blockText(textP.data)
    return prompt ? { prompt } : { error: 'empty_p_block_v' }
  }

  const runText = firstRunGroupTextNode(canvas)
  if (runText) {
    const prompt = blockText(runText.data)
    return prompt ? { prompt } : { error: 'empty_p_block_v' }
  }

  const video = canvas.nodes.find((node) => node.id === videoNodeId)
  return { prompt: trimmedField(video?.data, 'prompt') }
}
