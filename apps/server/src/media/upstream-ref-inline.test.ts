import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const uploadsRoot = join(process.cwd(), 'uploads')

describe('inlineUpstreamReferenceImages', () => {
  let inlineUpstreamReferenceImages: typeof import('./upstream-ref-inline').inlineUpstreamReferenceImages

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('./upstream-ref-inline')
    inlineUpstreamReferenceImages = mod.inlineUpstreamReferenceImages
    await mkdir(join(uploadsRoot, 'u-test'), { recursive: true })
    await writeFile(join(uploadsRoot, 'u-test', 'ref.png'), Buffer.from('fake-png'))
  })

  afterEach(async () => {
    await rm(join(uploadsRoot, 'u-test'), { recursive: true, force: true })
  })

  it('inlines lnkpi upload URL to data URL', async () => {
    const [out] = await inlineUpstreamReferenceImages([
      'http://119.29.173.89:8888/api/uploads/u-test/ref.png',
    ])
    expect(out).toMatch(/^data:image\/png;base64,/)
  })

  it('passes through public CDN URLs unchanged', async () => {
    const url = 'https://platform-outputs.agnes-ai.space/out.png'
    const [out] = await inlineUpstreamReferenceImages([url])
    expect(out).toBe(url)
  })
})
