export type ModelCapability = 'text' | 'image' | 'video' | 'audio'
export type ApiCallFormat = 'openai' | 'gemini'

export const CHANNEL_MODEL_SEPARATOR = '::'

export function encodeChannelModel(channelId: string, modelName: string): string {
  return `${channelId}${CHANNEL_MODEL_SEPARATOR}${modelName}`
}

export function decodeChannelModel(value: string): { channelId: string; modelName: string } | null {
  const separatorIndex = value.indexOf(CHANNEL_MODEL_SEPARATOR)
  if (separatorIndex === -1) return null

  const channelId = value.slice(0, separatorIndex)
  const modelName = value.slice(separatorIndex + CHANNEL_MODEL_SEPARATOR.length)
  if (!channelId || !modelName) return null

  return { channelId, modelName }
}

export function modelOptionName(value: string): string {
  const decoded = decodeChannelModel(value)
  return decoded?.modelName ?? value
}
