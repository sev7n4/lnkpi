import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_APIMART_BASE_URL,
  resolveApimartPlatformCredentials,
  resolvePlatformImageProviderOpts,
  usesApimartImageGateway,
  type PlatformCredentialEnv,
} from './platformCredentials'

const testEnv: PlatformCredentialEnv = {
  openaiApiKey: 'agnes-key',
  openaiBaseUrl: 'https://apihub.agnes-ai.cn/v1',
  apimartApiKey: 'apimart-key',
  apimartBaseUrl: 'https://api.apimart.ai/v1',
}

describe('platformCredentials', () => {
  const original = {
    openaiKey: process.env.OPENAI_API_KEY,
    openaiBase: process.env.OPENAI_BASE_URL,
    apimartKey: process.env.APIMART_API_KEY,
    apimartBase: process.env.APIMART_BASE_URL,
  }

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.APIMART_API_KEY
    delete process.env.APIMART_BASE_URL
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(original)) {
      const envKey =
        k === 'openaiKey'
          ? 'OPENAI_API_KEY'
          : k === 'openaiBase'
            ? 'OPENAI_BASE_URL'
            : k === 'apimartKey'
              ? 'APIMART_API_KEY'
              : 'APIMART_BASE_URL'
      if (v === undefined) delete process.env[envKey]
      else process.env[envKey] = v
    }
  })

  it('detects catalog APIMart image models', () => {
    expect(usesApimartImageGateway('seedream-5.0-pro')).toBe(true)
    expect(usesApimartImageGateway('image2')).toBe(true)
    expect(usesApimartImageGateway('agnes-image-2.1-flash')).toBe(false)
  })

  it('detects upstream gateway ids', () => {
    expect(usesApimartImageGateway('doubao-seedream-5-0-pro')).toBe(true)
    expect(usesApimartImageGateway('gpt-image-2-official')).toBe(true)
  })

  it('returns APIMart credentials for seedream/image2', () => {
    expect(resolveApimartPlatformCredentials('seedream-5.0-pro', testEnv)).toEqual({
      apiKey: 'apimart-key',
      baseUrl: 'https://api.apimart.ai/v1',
    })
    expect(resolveApimartPlatformCredentials('agnes-image-2.1-flash', testEnv)).toBeNull()
  })

  it('falls back to OPENAI_API_KEY when APIMART_API_KEY is unset', () => {
    expect(
      resolveApimartPlatformCredentials('image2', {
        ...testEnv,
        apimartApiKey: '',
      }),
    ).toEqual({
      apiKey: 'agnes-key',
      baseUrl: DEFAULT_APIMART_BASE_URL,
    })
  })

  it('resolvePlatformImageProviderOpts routes APIMart vs Agnes', () => {
    expect(resolvePlatformImageProviderOpts('image2', testEnv)).toEqual({
      apiKey: 'apimart-key',
      baseUrl: 'https://api.apimart.ai/v1',
    })
    expect(resolvePlatformImageProviderOpts('agnes-image-2.1-flash', testEnv)).toEqual({
      apiKey: 'agnes-key',
      baseUrl: 'https://apihub.agnes-ai.cn/v1',
    })
  })

  it('reads runtime env when explicit env is omitted', () => {
    process.env.APIMART_API_KEY = 'runtime-apimart'
    process.env.APIMART_BASE_URL = 'https://api.apimart.ai/v1'
    expect(resolveApimartPlatformCredentials('image2')).toEqual({
      apiKey: 'runtime-apimart',
      baseUrl: 'https://api.apimart.ai/v1',
    })
  })
})
