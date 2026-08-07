import { describe, expect, it } from 'vitest'
import {
  AGENT_SKILLS,
  agentInputPlaceholder,
  getAgentSkill,
} from './agentSkillMap'

describe('agentSkillMap', () => {
  it('lists only backend-connected skills', () => {
    expect(AGENT_SKILLS.length).toBeGreaterThan(0)
    for (const skill of AGENT_SKILLS) {
      expect(skill.runtimeSkillId).toBeTruthy()
    }
  })

  it('getAgentSkill returns undefined for auto mode', () => {
    expect(getAgentSkill(null)).toBeUndefined()
    expect(getAgentSkill(undefined)).toBeUndefined()
    expect(getAgentSkill('')).toBeUndefined()
  })

  it('getAgentSkill resolves canvas', () => {
    expect(getAgentSkill('canvas')?.runtimeSkillId).toBe('enterprise-marketing-campaign')
  })

  it('placeholder differs for auto vs skill', () => {
    expect(agentInputPlaceholder(undefined)).toContain('@')
    expect(agentInputPlaceholder(getAgentSkill('canvas'))).toContain('营销方案编排')
  })
})
