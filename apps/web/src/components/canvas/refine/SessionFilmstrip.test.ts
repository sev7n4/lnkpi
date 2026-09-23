import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionFilmstrip from './SessionFilmstrip.vue'

const results = [
  { id: 'a', url: 'u-a', prompt: '', createdAt: '2026-09-22T00:00:00Z' },
  { id: 'b', url: 'u-b', prompt: '', createdAt: '2026-09-22T00:00:01Z' },
  { id: 'c', url: 'u-c', prompt: '', createdAt: '2026-09-22T00:00:02Z' },
]

describe('SessionFilmstrip', () => {
  it('渲染 3 项缩略图，点击触发 select', async () => {
    const w = mount(SessionFilmstrip, {
      props: { results, currentId: 'b' },
    })
    expect(w.find('[data-testid="session-filmstrip"]').exists()).toBe(true)
    expect(w.findAll('[data-testid="filmstrip-item"]')).toHaveLength(3)
    expect(w.find('[data-testid="filmstrip-item"].is-current').attributes('data-id')).toBe('b')
    await w.findAll('[data-testid="filmstrip-item"]')[0].trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['a'])
  })

  it('disabled 时点击不 emit', async () => {
    const w = mount(SessionFilmstrip, {
      props: { results, currentId: null, disabled: true },
    })
    await w.findAll('[data-testid="filmstrip-item"]')[0].trigger('click')
    expect(w.emitted('select')).toBeUndefined()
  })
})
