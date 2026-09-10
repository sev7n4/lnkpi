import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { StorageAdapter, StoragePutInput } from './storage.adapter'

export type S3CompatibleConfig = {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
  publicBaseUrl?: string
  forcePathStyle?: boolean
}

export class S3CompatibleStorageAdapter implements StorageAdapter {
  private readonly client: S3Client
  constructor(private readonly config: S3CompatibleConfig) {
    this.client = new S3Client({
      region: config.region || 'ap-guangzhou',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
    })
  }

  async putStream(input: StoragePutInput): Promise<{ publicUrl: string }> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ...(input.contentLength != null ? { ContentLength: input.contentLength } : {}),
      },
    })
    await upload.done()
    const base = (this.config.publicBaseUrl || this.config.endpoint).replace(/\/$/, '')
    const publicUrl = this.config.publicBaseUrl
      ? `${base}/${input.key}`
      : `${base}/${this.config.bucket}/${input.key}`
    return { publicUrl }
  }
}
