/**
 * 媒体 URL 同源化（2026-09-24「原图加载失败」修复；2026-09-25 扩展覆盖外部生成图）。
 *
 * 背景：canvas 像素读取（裁剪 / 扩图 / 局部重绘 / 蒙版导出）必须 crossOrigin 加载，
 * 而两类媒体 URL 都没有 CORS 头：
 *  1. `http://<api-host>/api/uploads/...` 绝对地址（上传 / 本地合成产物）
 *  2. 生成图 provider 外部地址（platform-outputs.agnes-ai.space 等，直传不转存）
 * → onerror「原图加载失败」，扩图/重绘 overlay 因 base 加载失败整体不渲染
 *   （表现为「点击没反应」）；精修链路报 "The source image cannot be decoded"。
 *
 * 修复：
 *  - /api/uploads/ 绝对地址 → 折叠为同源相对路径（8888 同源 / Vercel 同域回源）。
 *  - 其余 http(s) 外部地址 → 折叠为同源代理 `/api/media/proxy?url=...`
 *    （server 白名单 + 仅图片，见 apps/server/src/media/media.controller.ts）。
 *  `<img>` 展示路径不走本函数，始终用原始 URL。
 */
export function sameOriginApiMediaUrl(url: string): string {
  if (!url || typeof window === 'undefined') return url
  if (/^(blob:|data:)/i.test(url)) return url
  try {
    const u = new URL(url, window.location.href)
    const idx = u.pathname.indexOf('/api/uploads/')
    if (idx !== -1) return u.pathname.slice(idx) + u.search
    // 已是同源地址（相对路径解析后同 origin）→ 直接取路径
    if (u.origin === window.location.origin) return u.pathname + u.search
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return url
    return `/api/media/proxy?url=${encodeURIComponent(u.href)}`
  } catch {
    return url
  }
}
