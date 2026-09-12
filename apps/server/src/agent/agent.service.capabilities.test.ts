import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentService } from './agent.service'

const OBJECT_STORAGE_ENV_KEYS = [
  'OBJECT_STORAGE_DRIVER',
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ACCESS_KEY',
  'OBJECT_STORAGE_SECRET_KEY',
] as const

function createAgentService() {
  return new AgentService(
    {} as never,
    { create: vi.fn() } as never,
    { createFromAgent: vi.fn() } as never,
    { resolveForGeneration: vi.fn() } as never,
  )
}

describe('AgentService getCapabilities', () => {
  const savedEnv: Partial<Record<(typeof OBJECT_STORAGE_ENV_KEYS)[number], string | undefined>> = {}

  beforeEach(() => {
    for (const key of OBJECT_STORAGE_ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of OBJECT_STORAGE_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
  })

  it('exposes stsDirectUpload from object storage env', () => {
    const svc = createAgentService()
    expect(svc.getCapabilities()).toEqual(
      expect.objectContaining({ stsDirectUpload: expect.any(Boolean) }),
    )
  })

  it('returns stsDirectUpload false when object storage is not configured', () => {
    const svc = createAgentService()
    expect(svc.getCapabilities().stsDirectUpload).toBe(false)
  })

  it('returns stsDirectUpload true when object storage env is complete', () => {
    process.env.OBJECT_STORAGE_ENDPOINT = 'https://s3.example.com'
    process.env.OBJECT_STORAGE_BUCKET = 'uploads'
    process.env.OBJECT_STORAGE_ACCESS_KEY = 'ak'
    process.env.OBJECT_STORAGE_SECRET_KEY = 'sk'

    const svc = createAgentService()
    expect(svc.getCapabilities().stsDirectUpload).toBe(true)
  })

  it('returns stsDirectUpload false when driver is none', () => {
    process.env.OBJECT_STORAGE_DRIVER = 'none'
    process.env.OBJECT_STORAGE_ENDPOINT = 'https://s3.example.com'
    process.env.OBJECT_STORAGE_BUCKET = 'uploads'
    process.env.OBJECT_STORAGE_ACCESS_KEY = 'ak'
    process.env.OBJECT_STORAGE_SECRET_KEY = 'sk'

    const svc = createAgentService()
    expect(svc.getCapabilities().stsDirectUpload).toBe(false)
  })
})
