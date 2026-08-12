import { describe, expect, it } from 'vitest'
import {
  chipSetFromInterrupt,
  defaultDeliverySelections,
  defaultMacroSchemeSelection,
  buildMacroSchemeConfirmMessage,
  buildClientDeliveryGroups,
  buildMacroAbFooterHint,
  buildRetakeContinueMessage,
  defaultShotDeliverySelections,
  filterAssistantVisibleText,
  filterUserVisibleText,
  resolveGatePrimaryActionLabel,
  IMAGE_QA_OPTIONS,
  interruptPayloadFromThreadState,
  isRetakePendingPhase,
  resolveImageQaChecks,
  resolveImageQaBodyText,
  resolveImageQaOptions,
  resolveImageQaTitle,
  toggleMacroSchemeSelection,
} from './agentInterruptGate'

describe('IMAGE_QA_OPTIONS', () => {
  it('uses friendly confirm_pass label aligned with copy YAML', () => {
    expect(IMAGE_QA_OPTIONS[0]).toEqual({
      id: 'confirm_pass',
      label: '就用这张图，继续',
      message: '就用这张图，继续',
    })
  })
})

describe('chipSetFromInterrupt', () => {
  it('maps await_confirm phase to plan chips', () => {
    expect(
      chipSetFromInterrupt({ interrupted: true, phase: 'await_confirm', node: 'await_confirm' }),
    ).toBe('plan')
  })

  it('maps await_copy_confirm to copy chips', () => {
    expect(chipSetFromInterrupt({ interrupted: true, phase: 'await_copy_confirm' })).toBe('copy')
  })

  it('maps await_atomic_confirm to atomic chips', () => {
    expect(chipSetFromInterrupt({ interrupted: true, phase: 'await_atomic_confirm' })).toBe('atomic')
  })

  it('maps await_topo node to topo chips', () => {
    expect(chipSetFromInterrupt({ interrupted: true, node: 'await_topo' })).toBe('topo')
  })

  it('maps await_image_qa to image_qa chips', () => {
    expect(chipSetFromInterrupt({ interrupted: true, phase: 'await_image_qa' })).toBe('image_qa')
  })

  it('maps await_scheme_select to scheme_select chips', () => {
    expect(chipSetFromInterrupt({ interrupted: true, phase: 'await_scheme_select' })).toBe(
      'scheme_select',
    )
  })

  it('maps await_macro_scheme_select to macro_scheme_select chips', () => {
    expect(chipSetFromInterrupt({ interrupted: true, phase: 'await_macro_scheme_select' })).toBe(
      'macro_scheme_select',
    )
  })

  it('maps await_shot_confirm to topo chips', () => {
    expect(chipSetFromInterrupt({ interrupted: true, phase: 'await_shot_confirm' })).toBe('topo')
  })

  it('maps await_shot_topo_confirm to topo chips', () => {
    expect(chipSetFromInterrupt({ interrupted: true, phase: 'await_shot_topo_confirm' })).toBe(
      'topo',
    )
  })

  it('maps await_delivery_confirm to delivery_confirm chips', () => {
    expect(chipSetFromInterrupt({ interrupted: true, phase: 'await_delivery_confirm' })).toBe(
      'delivery_confirm',
    )
  })

  it('returns null for unknown gate', () => {
    expect(chipSetFromInterrupt({ interrupted: true, phase: 'orchestrate_gen' })).toBe(null)
  })
})

describe('interruptPayloadFromThreadState', () => {
  it('builds payload when interrupted', () => {
    expect(
      interruptPayloadFromThreadState({
        interrupted: true,
        phase: 'await_topo',
        nextNodes: ['await_topo'],
      }),
    ).toEqual({
      interrupted: true,
      phase: 'await_topo',
      node: 'await_topo',
      presentation: null,
      retakePending: null,
      effectiveUtterance: null,
      imageQaReason: null,
      imageQaMetrics: null,
    })
  })

  it('builds payload when retake pending without interrupted flag', () => {
    expect(
      interruptPayloadFromThreadState({
        interrupted: false,
        phase: 'await_retake_upload',
        retakePending: true,
        effectiveUtterance: '巨峰葡萄礼盒',
      }),
    ).toMatchObject({
      interrupted: true,
      phase: 'await_retake_upload',
      retakePending: true,
      effectiveUtterance: '巨峰葡萄礼盒',
    })
  })

  it('includes presentation from thread state', () => {
    const presentation = {
      kind: 'shot_table',
      stepper: { current: 'shot_plan', completed: [] },
      primary_action: { label: '确认构图，生成预览', message: '确认出图' },
    }
    expect(
      interruptPayloadFromThreadState({
        interrupted: true,
        phase: 'await_shot_confirm',
        nextNodes: ['await_shot_confirm'],
        presentation,
      }),
    ).toMatchObject({ presentation })
  })

  it('returns null when not interrupted', () => {
    expect(interruptPayloadFromThreadState({ interrupted: false, phase: 'done' })).toBe(null)
  })
})

describe('defaultMacroSchemeSelection', () => {
  it('prefers recommended macro schemes up to 2', () => {
    const schemes = [
      { id: 'A', recommended: false },
      { id: 'B', recommended: true },
      { id: 'C', recommended: true },
    ]
    expect(defaultMacroSchemeSelection(schemes)).toEqual(['B', 'C'])
  })
})

describe('toggleMacroSchemeSelection', () => {
  const schemes = [
    { id: 'A', recommended: true },
    { id: 'B', recommended: false },
    { id: 'C', recommended: false },
  ]

  it('keeps recommended A when adding B then C', () => {
    let sel = defaultMacroSchemeSelection(schemes)
    expect(sel).toEqual(['A'])
    sel = toggleMacroSchemeSelection(sel, 'B', true, schemes)
    expect(sel).toEqual(['A', 'B'])
    sel = toggleMacroSchemeSelection(sel, 'C', true, schemes)
    expect(sel).toEqual(['A', 'C'])
  })

  it('removes unchecked scheme', () => {
    expect(toggleMacroSchemeSelection(['A', 'B'], 'B', false, schemes)).toEqual(['A'])
  })
})

describe('buildMacroSchemeConfirmMessage', () => {
  it('embeds selected ids', () => {
    const msg = buildMacroSchemeConfirmMessage(['A', 'B'])
    expect(msg).toContain('__macro_scheme_decision__')
    expect(msg).toContain('"selected_ids":["A","B"]')
  })
})

describe('buildClientDeliveryGroups', () => {
  it('builds user-language labels and macro subtitles', () => {
    const groups = buildClientDeliveryGroups(
      [
        { shot_id: 'hero__1', type_id: 'packaging_hero', label: '礼盒主视觉', macro_scheme_id: 'A', variant_count: 1 },
        { shot_id: 'scene__1', type_id: 'lifestyle_gifting', label: '送礼场景', macro_scheme_id: 'B', variant_count: 1 },
      ],
      {
        hero__1: { url: 'https://example.com/a.png', title: '候选 A' },
        scene__1: { url: 'https://example.com/b.png', title: '候选 B' },
      },
      ['礼盒长什么样', '送人场景'],
      { hero__1: 'hero__1', scene__1: 'scene__1' },
    )
    expect(groups).toHaveLength(2)
    expect(groups[0].label).toBe('礼盒长什么样')
    expect(groups[0].subtitle).toContain('[方案A]')
    expect(groups[1].label).toBe('送人场景')
  })
})

describe('buildMacroAbFooterHint', () => {
  it('returns empty for single selection', () => {
    expect(buildMacroAbFooterHint(1, 3)).toBe('')
  })

  it('includes k and p for dual selection', () => {
    const hint = buildMacroAbFooterHint(2, 3)
    expect(hint).toContain('2 套')
    expect(hint).toContain('3 张')
    expect(hint).toContain('A/B')
  })

  it('uses 若干 when delivery count unknown', () => {
    expect(buildMacroAbFooterHint(2, 0)).toContain('若干')
  })
})

describe('filterAssistantVisibleText', () => {
  it('strips macro, scheme, and delivery machine payload lines', () => {
    const raw = [
      '请确认宏观方案',
      '__scheme_decision__{"action":"confirm_schemes","selections":{}}',
      '__macro_scheme_decision__{"action":"confirm","selected_ids":["A"]}',
      '__delivery_decision__{"action":"confirm_delivery","selections":{}}',
      '底部说明',
    ].join('\n')
    expect(filterAssistantVisibleText(raw)).toBe('请确认宏观方案\n底部说明')
  })

  it('returns empty string when only machine payloads present', () => {
    expect(
      filterAssistantVisibleText('__macro_scheme_decision__{"action":"confirm"}'),
    ).toBe('')
  })

  it('strips quoted machine payload lines (user confirm bubbles)', () => {
    expect(
      filterUserVisibleText(
        '"__macro_scheme_decision__{\\"action\\":\\"confirm\\",\\"selected_ids\\":[\\"A\\",\\"B\\"]}"',
      ),
    ).toBe('')
  })

  it('filters internal QA error strings from assistant text', () => {
    expect(
      filterAssistantVisibleText('识图模型返回格式异常，请重试\n自动识图暂时不可用'),
    ).toBe('自动识图暂时不可用')
  })
})

describe('resolveGatePrimaryActionLabel', () => {
  it('prefers presentation primary_action label', () => {
    expect(
      resolveGatePrimaryActionLabel(
        {
          kind: 'shot_table',
          stepper: { current: 'shot_plan', completed: [] },
          primary_action: { label: '确认构图，生成预览', message: '确认出图' },
        },
        'await_shot_confirm',
      ),
    ).toBe('确认构图，生成预览')
  })

  it('falls back to phase defaults when presentation missing', () => {
    expect(resolveGatePrimaryActionLabel(null, 'await_shot_confirm')).toBe('确认构图，生成预览')
    expect(resolveGatePrimaryActionLabel(null, 'await_topo')).toBe('开始出图')
  })
})

describe('defaultShotDeliverySelections', () => {
  it('picks first ready variant per shot', () => {
    const shots = [
      { shot_id: 'hero__1', type_id: 'hero', variant_count: 2 },
      { shot_id: 'detail__1', type_id: 'detail', variant_count: 1 },
    ]
    const genByKey = {
      hero__1__v2: { url: 'u2' },
      detail__1: { url: 'u3' },
    }
    expect(defaultShotDeliverySelections(shots, genByKey)).toEqual({
      hero__1: 'hero__1__v2',
      detail__1: 'detail__1',
    })
  })
})

describe('defaultDeliverySelections', () => {
  it('prefers recommended scheme per type', () => {
    const plan = {
      visual_intent: {},
      image_types: [
        {
          type_id: 'hero_main',
          type_label: '主图',
          schemes: [
            { scheme_id: 'c1', recommended: false, prompt: 'a' },
            { scheme_id: 'c2', recommended: true, prompt: 'b' },
          ],
          selected_scheme_ids: ['c1', 'c2'],
        },
      ],
    }
    const genByKey = { hero_main__c1: { url: 'u1' }, hero_main__c2: { url: 'u2' } }
    expect(defaultDeliverySelections(plan, genByKey)).toEqual({ hero_main: 'c2' })
  })
})

describe('isRetakePendingPhase', () => {
  it('detects retakePending flag', () => {
    expect(isRetakePendingPhase({ retakePending: true })).toBe(true)
  })

  it('detects await_retake_upload phase', () => {
    expect(isRetakePendingPhase({ phase: 'await_retake_upload' })).toBe(true)
  })

  it('returns false when idle', () => {
    expect(isRetakePendingPhase({ phase: 'await_image_qa', retakePending: false })).toBe(false)
  })
})

describe('buildRetakeContinueMessage', () => {
  it('returns trimmed effective utterance', () => {
    expect(buildRetakeContinueMessage('  巨峰葡萄礼盒  ')).toBe('巨峰葡萄礼盒')
  })
})

describe('resolveImageQaPresentation', () => {
  const presentation = {
    kind: 'callout_info',
    stepper: { current: 'image_qa', completed: [] },
    title: '自动识图暂时不可用',
    body: {
      text: '图片本身看起来可用',
      checks: [
        { label: '清晰度', ok: true },
        { label: '白底背景', ok: false },
      ],
    },
    options: [
      { id: 'confirm_pass', label: '就用这张图，继续', message: '就用这张图，继续' },
      { id: 'retake', label: '重新拍摄', message: '我重新拍摄上传' },
    ],
  }

  it('uses presentation title and checks, not raw reason', () => {
    expect(resolveImageQaTitle(presentation)).toBe('自动识图暂时不可用')
    expect(resolveImageQaChecks(presentation)).toHaveLength(2)
    expect(resolveImageQaOptions(presentation)[0].label).toBe('就用这张图，继续')
  })

  it('includes understanding in body text when present', () => {
    const withUnderstanding = {
      ...presentation,
      body: {
        ...presentation.body,
        understanding: '识图理解：不锈钢保温杯，圆柱形',
        text: '请核对识图理解',
      },
    }
    expect(resolveImageQaBodyText(withUnderstanding)).toContain('保温杯')
    expect(resolveImageQaBodyText(withUnderstanding)).toContain('请核对识图理解')
  })

  it('falls back to IMAGE_QA_OPTIONS when presentation has no options', () => {
    expect(resolveImageQaOptions({ ...presentation, options: undefined })).toEqual(IMAGE_QA_OPTIONS)
  })
})
