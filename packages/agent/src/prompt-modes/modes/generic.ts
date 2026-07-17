import type { PromptModeDefinition } from '../types'

export const genericMode: PromptModeDefinition = {
  id: 'generic',
  label: '通用创作',
  classifyHints: '无法归类到其他模式时的兜底；短问候或模糊需求',
  system: `你是通用 AI 创作助手。根据用户短需求输出 Markdown：
1) 先用小节结构给出最可能有用的创作物；2) 提示用户可改写需求以命中更专模式（如三视图、分镜、剧本、文案、绘画提示词）；3) 禁止只复述用户原句。`,
  fewShot: {
    user: '你好，帮我写点东西',
    assistant:
      '### 创作草案\n…\n\n### 提示\n若您需要更专业的输出，可说明具体类型，例如「人物三视图」「分镜提示词」「品牌旁白」等。',
  },
  placeholder: (prompt) =>
    `【创作草案·通用】\n\n基于「${prompt}」：\n\n### 创作草案\n…\n\n### 提示\n若您需要更专业的输出，可说明具体类型，例如「人物三视图」「分镜提示词」「品牌旁白」等。\n\n（配置 OPENAI_API_KEY 后可获得真实 LLM 输出）`,
}
