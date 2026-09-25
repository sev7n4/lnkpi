import { describe, expect, it } from 'vitest'
import { sameOriginApiMediaUrl } from './media-url'

/**
 * 媒体 URL 同源化：canvas 像素读取（crossOrigin）要求同源。
 * 1) /api/uploads/ 绝对地址 → 折叠为同源相对路径；
 * 2) 外部生成图（无 CORS 头）→ 折叠为同源代理 /api/media/proxy?url=...。
 */
describe('sameOriginApiMediaUrl', () => {
  it('把任意 host 的 /api/uploads/ 绝对地址折叠为同源相对路径', () => {
    expect(sameOriginApiMediaUrl('http://119.29.173.89:8888/api/uploads/u1/a.png')).toBe(
      '/api/uploads/u1/a.png',
    )
    expect(sameOriginApiMediaUrl('https://api.example.com/api/uploads/u2/b.png?token=x')).toBe(
      '/api/uploads/u2/b.png?token=x',
    )
  })

  it('多段前缀路径同样折叠（保留 /api/uploads/ 起的尾段）', () => {
    expect(sameOriginApiMediaUrl('http://cdn.host.com/v2/api/uploads/u3/c.png')).toBe(
      '/api/uploads/u3/c.png',
    )
  })

  it('相对路径与同源绝对地址原样返回', () => {
    expect(sameOriginApiMediaUrl('/api/uploads/u1/a.png')).toBe('/api/uploads/u1/a.png')
    expect(sameOriginApiMediaUrl('http://localhost:5173/api/uploads/u1/a.png')).toBe(
      '/api/uploads/u1/a.png',
    )
  })

  it('外部生成图地址折叠为同源代理路径（2026-09-25 CORS 修复）', () => {
    const src = 'https://platform-outputs.agnes-ai.space/images/t2i/task_X/output.png'
    expect(sameOriginApiMediaUrl(src)).toBe(`/api/media/proxy?url=${encodeURIComponent(src)}`)
    expect(sameOriginApiMediaUrl('https://cos-platform-outputs.agnes-ai.cn/a/b.png?sig=1')).toBe(
      `/api/media/proxy?url=${encodeURIComponent('https://cos-platform-outputs.agnes-ai.cn/a/b.png?sig=1')}`,
    )
  })

  it('blob / data / 非 http(s) 协议原样返回', () => {
    expect(sameOriginApiMediaUrl('blob:http://localhost:5173/abc')).toBe(
      'blob:http://localhost:5173/abc',
    )
    expect(sameOriginApiMediaUrl('data:image/png;base64,xxx')).toBe('data:image/png;base64,xxx')
  })

  it('空串与非媒体路径原样返回', () => {
    expect(sameOriginApiMediaUrl('')).toBe('')
    expect(sameOriginApiMediaUrl('/other/path.png')).toBe('/other/path.png')
  })
})
