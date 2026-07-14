/** 生产/Vercel 用 VITE_API_BASE_URL；本地 dev 默认走 Vite proxy `/api` */
export function getApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim()
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    const onVercel = host.endsWith('.vercel.app') || host === 'vercel.app'
    if (onVercel || window.location.protocol === 'https:') {
      if (!configured || /^http:\/\//i.test(configured)) return '/api'
    }
  }
  if (configured) return configured.replace(/\/$/, '')
  return '/api'
}

/** 将 `/api/...` 或 `/agent/...` 拼到当前 API 根路径 */
export function apiUrl(path: string) {
  const base = getApiBaseUrl()
  let suffix = path.startsWith('/') ? path : `/${path}`
  if (suffix.startsWith('/api/')) suffix = suffix.slice(4)
  else if (suffix === '/api') suffix = '/'
  if (base === '/api') return `/api${suffix}`
  return `${base}${suffix}`
}

/** 将 `/api/uploads/...` 解析为可跨域访问的绝对地址（Vercel 前端 + 远程 API） */
export function resolveMediaUrl(url: string) {
  const trimmed = url.trim()
  if (!trimmed || /^(blob:|data:|https?:)/i.test(trimmed)) return trimmed
  if (!trimmed.startsWith('/')) return trimmed
  const base = getApiBaseUrl()
  if (base === '/api') return trimmed
  const apiRoot = base.replace(/\/api\/?$/, '')
  return `${apiRoot}${trimmed}`
}
