import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const editor = {
  previewTarget: null as null | Record<string, unknown>,
  closeMediaPreview: vi.fn(),
  openImageEditor: vi.fn(),
}
vi.mock('@/stores/canvasEditor', () => ({
  useCanvasEditorStore: () => editor,
}))
vi.mock('@/composables/useMediaInspector', () => ({ useMediaInspector: () => ({ openInspector: vi.fn() }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {} }) }))

import MediaPreviewOverlay from './MediaPreviewOverlay.vue'

function previewButtons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
}

describe('MediaPreviewOverlay hub actions', () => {
  it('hides edit/save without nodeId', async () => {
    editor.previewTarget = { url: 'https://cdn/a.png', kind: 'image' }
    const wrapper = mount(MediaPreviewOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(document.body.textContent).not.toContain('编辑')
    expect(document.body.textContent).not.toContain('存入资产库')
    wrapper.unmount()
  })

  it('edit button closes preview and opens editor with nodeId', async () => {
    editor.previewTarget = { url: 'https://cdn/a.png', kind: 'image', nodeId: 'n1' }
    const wrapper = mount(MediaPreviewOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    const editBtn = previewButtons().find((b) => (b.textContent ?? '').trim() === '编辑')
    expect(editBtn).toBeTruthy()
    editBtn!.click()
    expect(editor.closeMediaPreview).toHaveBeenCalled()
    expect(editor.openImageEditor).toHaveBeenCalledWith({ nodeId: 'n1', url: 'https://cdn/a.png' })
    wrapper.unmount()
  })
})
