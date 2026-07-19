import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const KEY_VERSION = 1

export type EncryptedPayload = {
  ciphertext: string
  iv: string
  authTag: string
  keyVersion: number
}

function loadKey(): Buffer {
  const raw = process.env.BYOK_ENCRYPTION_KEY_V1
  if (!raw) {
    throw new Error('BYOK_ENCRYPTION_KEY_V1 is required')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('BYOK_ENCRYPTION_KEY_V1 must decode to 32 bytes')
  }
  return key
}

@Injectable()
export class CryptoService {
  private readonly key: Buffer

  constructor() {
    this.key = loadKey()
  }

  encrypt(plaintext: string): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyVersion: KEY_VERSION,
    }
  }

  decrypt(parts: EncryptedPayload): string {
    if (parts.keyVersion !== KEY_VERSION) {
      throw new Error(`Unsupported keyVersion: ${parts.keyVersion}`)
    }
    const iv = Buffer.from(parts.iv, 'base64')
    const authTag = Buffer.from(parts.authTag, 'base64')
    const ciphertext = Buffer.from(parts.ciphertext, 'base64')
    const decipher = createDecipheriv(ALGORITHM, this.key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  }
}
