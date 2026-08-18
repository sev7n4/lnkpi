import { describe, expect, it } from 'vitest'
import { buildImageRefConsistencyBlock } from './generation-adapter'
import { buildEditPrompt, buildImageEditRequest, IMAGE_EDIT_PROMPT_PREFIX } from './edit-adapter'

describe('buildImageEditRequest', () => {
  it('sends image_urls[0] + mask_url + auto size and prefixed prompt', () => {
    const built = buildImageEditRequest({
      userPrompt: '去除选区内的污渍',
      imageUrl: 'https://cdn/base.png',
      maskUrl: 'https://cdn/mask.png',
    })
    expect(built.body).toEqual({
      model: 'gpt-image-2-official',
      prompt: built.prompt,
      image_urls: ['https://cdn/base.png'],
      mask_url: 'https://cdn/mask.png',
      size: 'auto',
    })
    expect(built.prompt.startsWith(IMAGE_EDIT_PROMPT_PREFIX)).toBe(true)
    expect(built.prompt).toContain('去除选区内的污渍')
    expect(built.meta.editMode).toBe('inpaint')
    expect(JSON.stringify(built)).not.toContain('【参考图一致性】')
  })

  it('does not reuse generate consistency block', () => {
    const generateBlock = buildImageRefConsistencyBlock([
      { refKey: 'I1', label: 'I1' },
    ])
    const edit = buildEditPrompt('换红色衣服')
    expect(edit).not.toContain(generateBlock.slice(0, 12))
  })
})
