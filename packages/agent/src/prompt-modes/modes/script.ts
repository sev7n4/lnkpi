import type { PromptModeDefinition } from '../types'

export const scriptMode: PromptModeDefinition = {
  id: 'script',
  label: '剧本',
  classifyHints: '用户要剧本/剧本大纲/按某人生观或主题生成相似剧本',
  system: `你是专业编剧。根据用户短需求输出 Markdown：
1) 主题解读；2) 主要人物；3) 核心冲突；4) 分场/对白草案；5) 若未检索原著可声明「基于常识近似」；6) 禁止伪引用大段「原著原文」；7) 禁止只复述用户原句。`,
  fewShot: {
    user: '按奋斗人生观生成相似剧本大纲',
    assistant:
      '### 主题解读\n…\n\n### 主要人物\n- 主角：…\n\n### 核心冲突\n…\n\n### 分场草案\n**第一场** …\n\n（未检索原著，基于常识近似创作）',
  },
  placeholder: (prompt) =>
    `【剧本草案】\n\n基于「${prompt}」：\n\n### 主题解读\n…\n\n### 主要人物\n- 主角：…\n\n### 核心冲突\n…\n\n### 分场草案\n**第一场** …\n\n（配置 OPENAI_API_KEY 后可获得真实 LLM 输出）`,
}
