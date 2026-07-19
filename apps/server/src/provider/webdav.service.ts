import { BadRequestException, Injectable } from '@nestjs/common'
import { assertSafeOutboundUrl } from './ssrf'

export type WebdavCredentials = {
  url: string
  directory: string
  username: string
  password: string
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
}

function sanitizeDirectory(directory: string): string {
  const trimmed = directory.trim().replace(/^\/+|\/+$/g, '')
  if (!trimmed) return ''
  const segments = trimmed.split('/').filter(Boolean)
  if (segments.some((seg) => seg === '.' || seg === '..')) {
    throw new BadRequestException('invalid WebDAV directory')
  }
  return segments.join('/')
}

function safeWebdavUrl(url: string): URL {
  try {
    return assertSafeOutboundUrl(url, {
      allowHttpLocalhost: process.env.NODE_ENV !== 'production',
    })
  } catch (err) {
    if (err instanceof BadRequestException) throw err
    const message = err instanceof Error ? err.message : 'Invalid URL'
    throw new BadRequestException(message)
  }
}

function joinRemoteUrl(baseUrl: string, directory: string, filename?: string): URL {
  const base = safeWebdavUrl(baseUrl)
  const dir = sanitizeDirectory(directory)
  const parts = [dir, filename].filter((p): p is string => Boolean(p && p.length > 0))
  const suffix = parts.join('/')
  const joined = suffix
    ? new URL(suffix, base.toString().replace(/\/?$/, '/'))
    : new URL(base.toString())
  // Re-validate after join (blocks redirect-style host changes via odd relative paths)
  return safeWebdavUrl(joined.toString())
}

function assertNoRedirect(status: number, context: string) {
  if (status >= 300 && status < 400) {
    throw new BadRequestException(`redirects are not allowed during WebDAV ${context}`)
  }
}

@Injectable()
export class WebdavService {
  async testConnection(creds: WebdavCredentials): Promise<{ ok: true }> {
    if (!creds.url?.trim()) {
      throw new BadRequestException('WebDAV url is required')
    }
    const target = joinRemoteUrl(creds.url, creds.directory)
    const headers: Record<string, string> = {
      Authorization: basicAuthHeader(creds.username ?? '', creds.password ?? ''),
      Depth: '0',
      Accept: '*/*',
    }

    const propfind = await fetch(target, {
      method: 'PROPFIND',
      redirect: 'manual',
      headers,
    })
    assertNoRedirect(propfind.status, 'test')

    if (propfind.status === 405 || propfind.status === 501) {
      const options = await fetch(target, {
        method: 'OPTIONS',
        redirect: 'manual',
        headers: {
          Authorization: headers.Authorization,
          Accept: '*/*',
        },
      })
      assertNoRedirect(options.status, 'test')
      if (!options.ok && options.status !== 204) {
        throw new BadRequestException(`WebDAV connection failed (${options.status})`)
      }
      return { ok: true }
    }

    // 207 Multi-Status is the common success for PROPFIND
    if (!propfind.ok && propfind.status !== 207) {
      throw new BadRequestException(`WebDAV connection failed (${propfind.status})`)
    }
    return { ok: true }
  }

  async uploadJson(
    creds: WebdavCredentials,
    filename: string,
    body: unknown,
  ): Promise<void> {
    if (!creds.url?.trim()) {
      throw new BadRequestException('WebDAV url is required')
    }
    if (!filename || filename.includes('/') || filename.includes('..')) {
      throw new BadRequestException('invalid WebDAV filename')
    }

    const target = joinRemoteUrl(creds.url, creds.directory, filename)
    const payload = JSON.stringify(body)
    const response = await fetch(target, {
      method: 'PUT',
      redirect: 'manual',
      headers: {
        Authorization: basicAuthHeader(creds.username ?? '', creds.password ?? ''),
        'Content-Type': 'application/json; charset=utf-8',
        Accept: '*/*',
      },
      body: payload,
    })
    assertNoRedirect(response.status, 'sync')
    if (!response.ok && response.status !== 201 && response.status !== 204) {
      throw new BadRequestException(`WebDAV sync failed (${response.status})`)
    }
  }
}
