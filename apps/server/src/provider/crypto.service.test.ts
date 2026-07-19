import { describe, expect, it, afterEach } from 'vitest'
import { CryptoService } from './crypto.service'

describe('CryptoService', () => {
  const originalKey = process.env.BYOK_ENCRYPTION_KEY_V1

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.BYOK_ENCRYPTION_KEY_V1
    } else {
      process.env.BYOK_ENCRYPTION_KEY_V1 = originalKey
    }
  })

  it('round-trips plaintext', () => {
    process.env.BYOK_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 7).toString('base64')
    const crypto = new CryptoService()
    const enc = crypto.encrypt('sk-test')
    expect(crypto.decrypt(enc)).toBe('sk-test')
  })

  it('rejects missing key', () => {
    delete process.env.BYOK_ENCRYPTION_KEY_V1
    expect(() => new CryptoService()).toThrow(/BYOK_ENCRYPTION_KEY_V1/)
  })
})
