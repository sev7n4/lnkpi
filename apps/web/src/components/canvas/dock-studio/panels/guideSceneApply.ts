import { getGenerationScene } from '@lnkpi/shared'

export function applyGuideSceneToPrompt(input: {
  sceneId: string
  currentPrompt: string
}): { prompt: string; guideSceneId: string; didPrefill: boolean; label: string } {
  const scene = getGenerationScene(input.sceneId)
  const label = scene?.label ?? input.sceneId
  const guideSceneId = input.sceneId
  const empty = !input.currentPrompt.trim()

  if (empty && scene?.promptScaffold) {
    return {
      prompt: scene.promptScaffold,
      guideSceneId,
      didPrefill: true,
      label,
    }
  }

  return {
    prompt: input.currentPrompt,
    guideSceneId,
    didPrefill: false,
    label,
  }
}

export function clearGuideScene(): { guideSceneId: null } {
  return { guideSceneId: null }
}
