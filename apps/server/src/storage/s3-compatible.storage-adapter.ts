import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type {
  StorageAdapter,
  StoragePresignPutInput,
  StoragePresignPutResult,
  StoragePutInput,
} from './storage.adapter'

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
    return { publicUrl: this.buildPublicUrl(input.key) }
  }

  async presignPut(input: StoragePresignPutInput): Promise<StoragePresignPutResult> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ContentType: input.contentType,
    })
    const putUrl = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
    })
    return {
      putUrl,
      headers: { 'Content-Type': input.contentType },
      publicUrl: this.buildPublicUrl(input.key),
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    }
  }

  private buildPublicUrl(key: string): string {
    const base = (this.config.publicBaseUrl || this.config.endpoint).replace(/\/$/, '')
    return this.config.publicBaseUrl
      ? `${base}/${key}`
      : `${base}/${this.config.bucket}/${key}`
  }
}
