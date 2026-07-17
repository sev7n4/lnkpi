import type { PromptModeDefinition } from '../types'

export const copywritingMode: PromptModeDefinition = {
  id: 'copywriting',
  label: '文案/旁白',
  classifyHints: '用户要旁白/口播/品牌文案/广告词，可直接使用的文案结构',
  system: `你是资深文案与口播撰稿人。根据用户短需求输出 Markdown：
1) 目标受众与语气；2) 短版与长版（或主文案 + 备选）；3) 可直接口播的完整文案；4) 禁止只复述用户原句。`,
  fewShot: {
    user: '写一段品牌旁白，科技创业公司',
    assistant:
      '### 目标受众与语气\n…\n\n### 短版（15秒口播）\n…\n\n### 长版（30秒口播）\n…',
  },
  placeholder: (prompt) =>
    `【文案草案】\n\n基于「${prompt}」：\n\n### 目标受众与语气\n…\n\n### 短版（口播）\n…\n\n### 长版（口播）\n…\n\n（配置 OPENAI_API_KEY 后可获得真实 LLM 输出）`,
}
