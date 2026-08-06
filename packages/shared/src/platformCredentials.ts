import { isApimartBackedImageModel } from './imageModelProfiles'
import { resolveModelKey } from './studioModelCatalog'

export const DEFAULT_APIMART_BASE_URL = 'https://api.apimart.ai/v1'

export function usesApimartImageGateway(modelKey: string): boolean {
  const trimmed = modelKey.trim()
  if (!trimmed) return false
  if (isApimartBackedImageModel(trimmed)) return true
  const { modelKey: resolvedKey, entry } = resolveModelKey('image', trimmed)
  return isApimartBackedImageModel(resolvedKey, entry.gatewayModelId)
}

export function resolveApimartPlatformCredentials(
  modelKey: string,
): { apiKey: string; baseUrl: string } | null {
  if (!usesApimartImageGateway(modelKey)) return null
  const apiKey =
    process.env.APIMART_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return null
  const baseUrl =
    process.env.APIMART_BASE_URL?.trim() || DEFAULT_APIMART_BASE_URL
  return { apiKey, baseUrl }
}

export function resolvePlatformImageProviderOpts(
  modelKey?: string,
): { apiKey: string; baseUrl: string } | undefined {
  if (modelKey) {
    const apimart = resolveApimartPlatformCredentials(modelKey)
    if (apimart) return apimart
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return undefined
  return {
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL?.trim() || '',
  }
}
