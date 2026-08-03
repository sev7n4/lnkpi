export interface AgentSkillDef {
  id: string
  label: string
  desc: string
  icon: 'canvas' | 'storyboard' | 'polish' | 'organize'
  runtimeSkillId: string | null
  ready: boolean
}

export const AGENT_SKILLS: AgentSkillDef[] = [
  { id: 'canvas', label: '画布编排', desc: '创建节点与连线，驱动画布创作', icon: 'canvas', runtimeSkillId: 'enterprise-marketing-campaign', ready: true },
  { id: 'storyboard', label: '分镜脚本', desc: '拆解剧情，生成分镜与镜头描述', icon: 'storyboard', runtimeSkillId: null, ready: false },
  { id: 'polish', label: '提示词优化', desc: '润色扩写提示词，提升生成质量', icon: 'polish', runtimeSkillId: null, ready: false },
  { id: 'organize', label: '素材整理', desc: '归纳画布素材，梳理创作结构', icon: 'organize', runtimeSkillId: null, ready: false },
]
