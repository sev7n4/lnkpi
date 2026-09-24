/**
 * 媒体 URL 同源化（2026-09-24「原图加载失败」修复）。
 *
 * 背景：节点/生成数据中存在 `http://<api-host>/api/uploads/...` 形态的绝对地址。
 * `<img>` 展示不受影响，但 canvas 像素读取（裁剪 / 扩图 / 局部重绘 / 蒙版导出）
 * 必须 crossOrigin 加载，而图片服务未返回 CORS 头 → onerror「原图加载失败」，
 * 扩图/重绘 overlay 因 base 加载失败整体不渲染（表现为「点击没反应」）。
 *
 * 修复：把指向本产品媒体路径（/api/uploads/）的任意 host 绝对 URL 折叠为
 * 同源相对路径 —— 本地 dev 走 vite /api 代理、生产 8888 同源、Vercel 同域
 * /api 回源 proxy.ts，三入口全部同源；顺带规避 Vercel HTTPS 下的
 * http 绝对地址 mixed-content 拦截。
 */
export function sameOriginApiMediaUrl(url: string): string {
  if (!url || typeof window === 'undefined') return url
  if (/^(blob:|data:)/i.test(url)) return url
  try {
    const u = new URL(url, window.location.href)
    const idx = u.pathname.indexOf('/api/uploads/')
    if (idx === -1) return url
    return u.pathname.slice(idx) + u.search
  } catch {
    return url
  }
}
