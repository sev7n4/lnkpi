import axios from 'axios'
import { getApiBaseUrl } from './api-base'

export const api = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 120_000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 仅当「本次请求携带的 token 就是当前存储的 token 且被服务端明确拒绝」时才清除本地会话。
    // 否则并发的旧请求（token 过期风暴、登录竞态期间在途的无 token 请求）返回 401 时，
    // 会把刚重新登录存入的新 token 误删，导致界面显示已登录但所有请求永久 401。
    if (error.response?.status === 401) {
      const sent = extractBearerToken(error.config?.headers?.Authorization)
      const stored = localStorage.getItem('token')
      if (sent !== null && sent === stored) {
        localStorage.removeItem('token')
      }
    }
    return Promise.reject(error)
  },
)

function extractBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+(.+)$/.exec(header.trim())
  return match ? match[1]! : null
}
