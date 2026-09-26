import { ValidationPipe } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { ImageEditDto } from './studio.controller'

/**
 * image/edit DTO 宽容校验回归（2026-09-26 线上故障）：
 * 旧前端 bundle 扩图链路发过 `outpaintTo.height: null`（NaN 序列化）或
 * 缺 key（undefined），严格 IsNumber 直接 400，重绘/扩图/元素编辑在用户侧
 * 全部不可用。现约定：缺失 / null 放行（service 兜底回 baseDims），数字
 * 字符串收敛为 number，其余非法值依旧 400。
 */
const pipe = new ValidationPipe({ transform: true, whitelist: true })

function transform(body: unknown): Promise<ImageEditDto> {
  return pipe.transform(body, { type: 'body', metatype: ImageEditDto }) as Promise<ImageEditDto>
}

const validBase = {
  prompt: 't',
  imageUrl: '/api/uploads/u/base.png',
  maskUrl: '/api/uploads/u/mask.png',
  model: 'image2',
  size: 'auto',
  mode: 'outpaint',
}

describe('ImageEditDto 宽容校验（outpaint 尺寸）', () => {
  it('合法完整载荷原样通过', async () => {
    const dto = await transform({ ...validBase, outpaintFrom: { width: 64, height: 64 }, outpaintTo: { width: 128, height: 96 } })
    expect(dto.outpaintFrom).toEqual({ width: 64, height: 64 })
    expect(dto.outpaintTo).toEqual({ width: 128, height: 96 })
  })

  it('outpaint 尺寸为 null（NaN 序列化）不再 400，null 透传由 service 兜底', async () => {
    const dto = await transform({ ...validBase, outpaintFrom: { width: null, height: null }, outpaintTo: { width: null, height: null } })
    expect(dto.outpaintTo?.width).toBeNull()
    expect(dto.outpaintTo?.height).toBeNull()
  })

  it('outpaint 尺寸缺 key（undefined 序列化丢字段）不再 400', async () => {
    const dto = await transform({ ...validBase, outpaintTo: { width: 128 } })
    expect(dto.outpaintTo?.width).toBe(128)
    expect(dto.outpaintTo?.height).toBeUndefined()
  })

  it('数字字符串经 Type(Number) 收敛为 number', async () => {
    const dto = await transform({ ...validBase, outpaintTo: { width: '128', height: '96' } })
    expect(dto.outpaintTo).toEqual({ width: 128, height: 96 })
  })

  it('非数字字符串依旧 400（白名单语义不松掉）', async () => {
    await expect(transform({ ...validBase, outpaintTo: { width: 'abc', height: 96 } })).rejects.toThrow()
  })

  it('model 白名单外依旧 400', async () => {
    await expect(transform({ ...validBase, model: 'not-a-model' })).rejects.toThrow()
  })
})
