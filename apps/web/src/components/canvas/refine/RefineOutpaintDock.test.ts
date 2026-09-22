import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RefineOutpaintDock from './RefineOutpaintDock.vue'
import { IMAGE_EDIT_MODEL_KEYS, P1_IMAGE_EDIT_MODEL_KEY } from '@lnkpi/shared'
import { OUTPAINT_FALLBACK_PROMPT } from './outpaintFallback'

const mountDock = (props: Record<string, unknown> = {}) =>
  mount(RefineOutpaintDock, {
    props: {
      prompt: '',
      modelKey: P1_IMAGE_EDIT_MODEL_KEY,
      availableModelKeys: IMAGE_EDIT_MODEL_KEYS,
      credits: 10,
      canRun: true,
      ...props,
    },
  })

describe('RefineOutpaintDock', () => {
  it('渲染退出 / 模型 / 提示词开关 / 积分 / 圆形箭头 CTA', () => {
    const w = mountDock()
    expect(w.find('[data-testid="outpaint-dock"]').exists()).toBe(true)
    expect(w.find('[data-testid="outpaint-dock-exit"]').attributes('title')).toContain('退出扩图')
    expect(w.find('[data-testid="outpaint-dock-prompt-toggle"]').exists()).toBe(true)
    expect(w.findComponent({ name: 'DockCreditBadge' }).props('credits')).toBe(10)
    const cta = w.find('[data-testid="outpaint-dock-cta"]')
    expect(cta.classes()).toContain('dock-generate-btn')
    expect(cta.classes()).toContain('dock-generate-btn--lg')
    expect(cta.attributes('aria-label')).toBe('扩图生成')
  })

  it('size=md：CTA 为 32px 档（panel 落点，§4.3）', () => {
    const w = mountDock({ size: 'md' })
    expect(w.find('[data-testid="outpaint-dock-cta"]').classes()).toContain('dock-generate-btn--md')
  })

  it('未扩出（canRun=false）：CTA 禁用 + 守卫 tooltip，仍保留箭头图标', () => {
    const w = mountDock({ canRun: false })
    const cta = w.find('[data-testid="outpaint-dock-cta"]')
    expect(cta.attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="outpaint-dock-guard"]').text()).toContain('先拖动')
    expect(cta.find('svg').exists()).toBe(true)
  })

  it('busy：CTA 禁用且退出按钮变为取消（emit cancel 而非 exit）', async () => {
    const w = mountDock({ busy: true })
    expect(w.find('[data-testid="outpaint-dock-cta"]').attributes('disabled')).toBeDefined()
    const exit = w.find('[data-testid="outpaint-dock-exit"]')
    expect(exit.attributes('title')).toContain('取消')
    await exit.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('exit')).toBeUndefined()
  })

  it('点 CTA emit run；点退出 emit exit', async () => {
    const w = mountDock()
    await w.find('[data-testid="outpaint-dock-cta"]').trigger('click')
    expect(w.emitted('run')).toHaveLength(1)
    await w.find('[data-testid="outpaint-dock-exit"]').trigger('click')
    expect(w.emitted('exit')).toHaveLength(1)
  })

  it('提示词默认折叠不占位；展开后 textarea 显示空串并以兜底文案作 placeholder', async () => {
    const w = mountDock()
    expect(w.find('[data-testid="outpaint-dock-prompt"]').exists()).toBe(false)
    await w.find('[data-testid="outpaint-dock-prompt-toggle"]').trigger('click')
    const area = w.find('[data-testid="outpaint-dock-prompt"]')
    expect(area.exists()).toBe(true)
    expect(area.attributes('placeholder')).toBe(OUTPAINT_FALLBACK_PROMPT)
  })

  it('提示词展开后输入 → emit update:prompt', async () => {
    const w = mountDock()
    await w.find('[data-testid="outpaint-dock-prompt-toggle"]').trigger('click')
    await w.find('[data-testid="outpaint-dock-prompt"]').setValue('加一片森林')
    expect(w.emitted('update:prompt')).toEqual([['加一片森林']])
  })

  it('已有错误时显示错误并可重试', async () => {
    const w = mountDock({ errorMessage: '扩图失败，请重试' })
    expect(w.text()).toContain('扩图失败，请重试')
    await w.find('[data-testid="outpaint-dock-retry"]').trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
  })

  it('canApply 时才显示「应用到节点」次级动作', () => {
    expect(mountDock().find('[data-testid="outpaint-dock-apply"]').exists()).toBe(false)
    expect(mountDock({ canApply: true }).find('[data-testid="outpaint-dock-apply"]').exists()).toBe(true)
  })
})
