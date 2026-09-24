import { describe, expect, it } from 'vitest'
import { sameOriginApiMediaUrl } from './media-url'

/**
 * 媒体 URL 同源化：数据中存在 http://<api-host>/api/uploads/... 绝对地址，
 * 跨域页面下 canvas 加载（crossOrigin）因无 CORS 头失败。折叠为相对路径修复。
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

  it('非本产品媒体（外部 URL / blob / data）原样返回', () => {
    expect(sameOriginApiMediaUrl('https://cos.example.com/bucket/a.png')).toBe(
      'https://cos.example.com/bucket/a.png',
    )
    expect(sameOriginApiMediaUrl('blob:http://localhost:5173/abc')).toBe(
      'blob:http://localhost:5173/abc',
    )
    expect(sameOriginApiMediaUrl('data:image/png;base64,xxx')).toBe('data:image/png;base64,xxx')
  })

  it('空串与非本产品路径原样返回', () => {
    expect(sameOriginApiMediaUrl('')).toBe('')
    expect(sameOriginApiMediaUrl('/other/path.png')).toBe('/other/path.png')
  })
})
