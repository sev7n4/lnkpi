import type { PromptModeDefinition } from '../types'

export const storyboardMode: PromptModeDefinition = {
  id: 'storyboard',
  label: '分镜提示词',
  classifyHints: '用户要分镜提示词/分镜脚本，含镜号、景别、运镜、动作描述',
  system: `你是资深分镜师与 AI 绘画提示词工程师。根据用户短需求输出 Markdown：
1) 简短开场；2) 按镜号序列（镜1、镜2…），每镜含景别/机位/运镜/动作/中英 Prompt；3) 禁止只有形容词堆砌；4) 禁止只复述用户原句。`,
  fewShot: {
    user: '帮我生成一个分镜提示词，追逐场景',
    assistant:
      '### 镜1\n- **景别/机位：** 远景，俯拍\n- **运镜/动作：** 主角奔跑穿过巷道\n- **Prompt:**\n> wide shot, chase scene…\n\n### 镜2\n…',
  },
  placeholder: (prompt) =>
    `【提示词草案·分镜】\n\n基于「${prompt}」：\n\n### 镜1\n- 景别/机位：远景\n- 运镜/动作：…\n- Prompt: \`wide shot…\`\n\n### 镜2\n- 景别/机位：中景\n- 运镜/动作：…\n- Prompt: \`medium shot…\`\n\n（配置 OPENAI_API_KEY 后可获得真实 LLM 输出）`,
}
