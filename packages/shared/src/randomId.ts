/**
 * 生成随机 id。
 *
 * `crypto.randomUUID` 只在安全上下文（HTTPS / localhost）可用；通过明文
 * `http://<ip>:<port>` 访问（生产 CVM 的部署形态）时它是 undefined，
 * 直接调用会抛 `TypeError`。这里统一降级为时间戳 + 随机串，
 * 保证非安全上下文下依赖 id 的功能同样可用。
 */
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}
