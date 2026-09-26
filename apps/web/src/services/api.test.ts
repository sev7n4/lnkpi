import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { api } from './api'

type Deferred = {
  config: AxiosRequestConfig
  reject: (status?: number) => void
  resolve: (value: AxiosResponse) => void
}

/** Let the axios interceptor chain + adapter invoke (async microtasks) settle. */
async function waitForAdapter(deferreds: Deferred[]): Promise<Deferred> {
  await vi.waitFor(() => {
    if (deferreds.length === 0) throw new Error('adapter not invoked yet')
  })
  return deferreds[deferreds.length - 1]!
}

/** Install an adapter that captures requests and lets each test decide the response. */
function installDeferredAdapter(): Deferred[] {
  const deferreds: Deferred[] = []
  api.defaults.adapter = (config) =>
    new Promise<AxiosResponse>((resolve, reject) => {
      deferreds.push({
        config: config as AxiosRequestConfig,
        reject: (status = 401) =>
          reject(
            new AxiosError(
              status === 401 ? 'Unauthorized' : 'Server error',
              AxiosError.ERR_BAD_RESPONSE,
              config,
              {},
              { status, statusText: status === 401 ? 'Unauthorized' : 'Internal Server Error', data: {}, headers: {}, config } as AxiosResponse,
            ),
          ),
        resolve: (value) => resolve(value),
      })
    })
  return deferreds
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('api response interceptor (401 handling)', () => {
  it('clears the stored token when the request carried the same token and got 401', async () => {
    const deferreds = installDeferredAdapter()
    localStorage.setItem('token', 'token-a')

    const pending = api.get('/studio/generations/x').catch((e) => e)
    const deferred = await waitForAdapter(deferreds)
    deferred.reject()

    await pending
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('keeps a freshly stored token when an in-flight stale-token request 401s', async () => {
    const deferreds = installDeferredAdapter()
    localStorage.setItem('token', 'stale-token')

    const pending = api.get('/studio/generations/x').catch((e) => e)
    const deferred = await waitForAdapter(deferreds)
    // Simulate the user re-logging in while the stale request is still in flight.
    localStorage.setItem('token', 'fresh-token')

    deferred.reject()
    await pending

    // The stale 401 must NOT erase the just-logged-in token.
    expect(localStorage.getItem('token')).toBe('fresh-token')
  })

  it('does not touch storage when the 401 came from a request without a token', async () => {
    const deferreds = installDeferredAdapter()
    // No token in storage: the request goes out unauthenticated.
    const pending = api.get('/studio/generations/x').catch((e) => e)
    const deferred = await waitForAdapter(deferreds)
    localStorage.setItem('token', 'fresh-token')

    deferred.reject()
    await pending

    expect(localStorage.getItem('token')).toBe('fresh-token')
  })

  it('leaves non-401 errors untouched', async () => {
    const deferreds = installDeferredAdapter()
    localStorage.setItem('token', 'token-a')

    const pending = api.get('/studio/generations/x').catch((e) => e)
    pending.catch(() => undefined)
    const deferred = await waitForAdapter(deferreds)
    deferred.reject(500)
    await pending

    expect(localStorage.getItem('token')).toBe('token-a')
  })
})
