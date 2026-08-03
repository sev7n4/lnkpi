import { describe, expect, it } from 'vitest'
import {
  chipSetFromInterrupt,
  interruptPayloadFromThreadState,
} from './agentInterruptGate'

describe('chipSetFromInterrupt', () => {
  it('maps await_confirm phase to plan chips', () => {
    expect(
      chipSetFromInterrupt({ interrupted: true, phase: 'await_confirm', node: 'await_confirm' }),
    ).toBe('plan')
  })

  it('maps await_copy_confirm to copy chips', () => {
    expect(chipSetFromInterrupt({ interrupted: true, phase: 'await_copy_confirm' })).toBe('copy')
  })

  it('maps await_topo node to topo chips', () => {
    expect(chipSetFromInterrupt({ interrupted: true, node: 'await_topo' })).toBe('topo')
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
    })
  })

  it('returns null when not interrupted', () => {
    expect(interruptPayloadFromThreadState({ interrupted: false, phase: 'done' })).toBe(null)
  })
})
