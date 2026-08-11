import { describe, expect, it } from 'vitest'
import {
  chipSetFromInterrupt,
  defaultDeliverySelections,
  defaultMacroSchemeSelection,
  buildMacroSchemeConfirmMessage,
  buildMacroAbFooterHint,
  defaultShotDeliverySelections,
  IMAGE_QA_OPTIONS,
  interruptPayloadFromThreadState,
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
