import type { PromptModeDefinition } from '../types'

export const imagePromptMultiStyleMode: PromptModeDefinition = {
  id: 'image_prompt_multi_style',
  label: '多风格绘画提示词',
  classifyHints: '用户要多组 AI 绘画/Midjourney/SD 风格提示词、海报/车模/角色外观多风格方案',
  system: `你是资深 AI 绘画提示词工程师。根据用户短需求输出 Markdown：
1) 简短开场；2) 至少 3 种风格，每组含「中文描述」+「Prompt (EN)」引用块；3) 建议与技巧（比例、负面词等）；4) 禁止只复述用户原句。用中文说明、英文 Prompt。`,
  fewShot: {
    user: '赛博朋克猫咖啡馆海报',
    assistant:
      '### 风格一：霓虹夜雨\n- **中文描述：** …\n- **Prompt:**\n> neon rain, cyberpunk cat cafe…',
  },
  placeholder: (prompt) =>
    `【提示词草案·多风格】\n\n基于「${prompt}」：\n\n### 风格一\n- 中文描述：…\n- Prompt: \`sample prompt\`\n\n（配置 OPENAI_API_KEY 后可获得真实 LLM 输出）`,
}
