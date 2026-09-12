import { describe, expect, it } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { NodeRef } from '@/composables/useNodeRefs'
import DockRefChip from './DockRefChip.vue'
import DockRefStrip from './DockRefStrip.vue'
import DockPromptSection from './DockPromptSection.vue'

function imageRef(refKey: string): NodeRef {
  return {
    refId: refKey,
    refKey,
    mediaType: 'image',
    sourceKind: 'upload',
    label: refKey,
    preview: '',
    payload: { url: `https://example.com/${refKey}.jpg` },
  }
}

describe('DockRefChip click → @mention', () => {
  it('defaults mentionable=true so click emits @refKey without explicit prop', async () => {
    const wrapper = mount(DockRefChip, {
      props: { refItem: imageRef('I1') },
      attachTo: document.body,
    })
    await wrapper.get('.dock-ref-chip').trigger('click')
    expect(wrapper.emitted('mention')?.[0]).toEqual(['I1'])
    wrapper.unmount()
  })

  it('strip forwards chip click as mention', async () => {
    const wrapper = mount(DockRefStrip, {
      props: { refs: [imageRef('V2')] },
      attachTo: document.body,
    })
    await wrapper.get('.dock-ref-chip').trigger('click')
    expect(wrapper.emitted('mention')?.[0]).toEqual(['V2'])
    wrapper.unmount()
  })

  it('clicking chip inserts @I1 into DockPromptSection', async () => {
    const prompt = ref('')
    const promptSectionRef = ref<{ insertRefMention: (key: string) => void } | null>(null)

    const Harness = defineComponent({
      components: { DockRefStrip, DockPromptSection },
      setup() {
        function onRefMention(refKey: string) {
          promptSectionRef.value?.insertRefMention(refKey)
        }
        return { prompt, promptSectionRef, onRefMention, refs: [imageRef('I1')] }
      },
      template: `
        <DockRefStrip :refs="refs" @mention="onRefMention" />
        <DockPromptSection
          ref="promptSectionRef"
          :model-value="prompt"
          :mentions="[{ id: 'I1', label: 'I1', type: 'image' }]"
          @update:model-value="prompt = $event"
        />
      `,
    })

    const wrapper = mount(Harness, { attachTo: document.body })
    await nextTick()
    await wrapper.get('.dock-ref-chip').trigger('click')
    await nextTick()
    expect(prompt.value).toBe('@I1 ')
    wrapper.unmount()
  })
})
