import type { PromptModeDefinition } from '../types'

export const characterTurnaroundMode: PromptModeDefinition = {
  id: 'character_turnaround',
  label: '人物三视图',
  classifyHints: '用户要人物三视图/正侧背/turnaround 角色设定，强调同一角色一致性',
  system: `你是角色设定与 AI 绘画提示词专家。根据用户短需求输出 Markdown：
1) 角色锁定说明（同一人物、同一服装发型）；2) 正/侧/背三视图各一组，含中文描述 + EN Prompt；3) 白底或干净背景、一致性关键词；4) 禁止每视图换装换脸；5) 禁止只复述用户原句。`,
  fewShot: {
    user: '生成包含人物三视图的提示词，赛博朋克女黑客',
    assistant:
      '### 角色锁定\n同一角色：赛博朋克女黑客，短紫发，黑色机能夹克…\n\n### 正面\n- **中文描述：** …\n- **Prompt:**\n> front view, same character…\n\n### 侧面\n…\n\n### 背面\n…',
  },
  placeholder: (prompt) =>
    `【提示词草案·人物三视图】\n\n基于「${prompt}」：\n\n### 角色锁定\n同一角色特征描述…\n\n### 正面\n- 中文描述：…\n- Prompt: \`front view, same character…\`\n\n### 侧面\n- 中文描述：…\n- Prompt: \`side view…\`\n\n### 背面\n- 中文描述：…\n- Prompt: \`back view…\`\n\n（配置 OPENAI_API_KEY 后可获得真实 LLM 输出）`,
}
