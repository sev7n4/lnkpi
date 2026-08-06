import { isApimartBackedImageModel } from './imageModelProfiles'
import { resolveModelKey } from './studioModelCatalog'

export const DEFAULT_APIMART_BASE_URL = 'https://api.apimart.ai/v1'

export type PlatformCredentialEnv = {
  apimartApiKey?: string
  apimartBaseUrl?: string
  openaiApiKey?: string
  openaiBaseUrl?: string
}

function readEnv(name: string): string | undefined {
  const env = (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env
  const value = env?.[name]
  return typeof value === 'string' ? value.trim() : undefined
}

export function readPlatformCredentialEnv(
  env: PlatformCredentialEnv = {},
): Required<PlatformCredentialEnv> {
  return {
    apimartApiKey: env.apimartApiKey ?? readEnv('APIMART_API_KEY') ?? '',
    apimartBaseUrl:
      env.apimartBaseUrl ?? readEnv('APIMART_BASE_URL') ?? DEFAULT_APIMART_BASE_URL,
    openaiApiKey: env.openaiApiKey ?? readEnv('OPENAI_API_KEY') ?? '',
    openaiBaseUrl: env.openaiBaseUrl ?? readEnv('OPENAI_BASE_URL') ?? '',
  }
}

export function usesApimartImageGateway(modelKey: string): boolean {
  const trimmed = modelKey.trim()
  if (!trimmed) return false
  if (isApimartBackedImageModel(trimmed)) return true
  const { modelKey: resolvedKey, entry } = resolveModelKey('image', trimmed)
  return isApimartBackedImageModel(resolvedKey, entry.gatewayModelId)
}

export function resolveApimartPlatformCredentials(
  modelKey: string,
  env?: PlatformCredentialEnv,
): { apiKey: string; baseUrl: string } | null {
  if (!usesApimartImageGateway(modelKey)) return null
  const vars = readPlatformCredentialEnv(env)
  const apiKey = vars.apimartApiKey || vars.openaiApiKey
  if (!apiKey) return null
  return { apiKey, baseUrl: vars.apimartBaseUrl || DEFAULT_APIMART_BASE_URL }
}

export function resolvePlatformImageProviderOpts(
  modelKey?: string,
  env?: PlatformCredentialEnv,
): { apiKey: string; baseUrl: string } | undefined {
  if (modelKey) {
    const apimart = resolveApimartPlatformCredentials(modelKey, env)
    if (apimart) return apimart
  }
  const vars = readPlatformCredentialEnv(env)
  if (!vars.openaiApiKey) return undefined
  return {
    apiKey: vars.openaiApiKey,
    baseUrl: vars.openaiBaseUrl,
  }
}
