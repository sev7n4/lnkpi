import {
  listModels,
  defaultModelKey,
  resolveModelKey,
  getModelEntry,
  decodeChannelModel,
  encodeChannelModel,
  modelOptionName,
  type StudioModality,
  type StudioModelEntry,
  type StudioVoiceOption,
} from '@lnkpi/shared'

export {
  listModels,
  defaultModelKey,
  resolveModelKey,
  getModelEntry,
  decodeChannelModel,
  encodeChannelModel,
  modelOptionName,
  type StudioModality,
  type StudioModelEntry,
  type StudioVoiceOption,
}

export function modelsAsSelectorOptions(modality: StudioModality) {
  return listModels(modality).map((m) => ({
    id: m.modelKey,
    name: m.displayName,
    provider: 'catalog',
  }))
}

/** Normalize node/API model values to `channelId::modelName` for BYOK. */
export function resolveGenerationModel(
  modality: StudioModality,
  requested?: string | null,
): string {
  const trimmed = requested?.trim()
  if (trimmed) {
    if (decodeChannelModel(trimmed)) return trimmed
    return encodeChannelModel('platform', resolveModelKey(modality, trimmed).modelKey)
  }
  return encodeChannelModel('platform', defaultModelKey(modality))
}

export function catalogModelKeyFromValue(value: string): string {
  return decodeChannelModel(value)?.modelName ?? value
}

/** DeepSeek V4 family (pro/flash) — used for Dock thinking UI visibility. */
export function isDeepSeekV4Model(model?: string | null): boolean {
  if (!model) return false
  return /deepseek-v4/i.test(model)
}
