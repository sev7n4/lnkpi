import type { PromptModeDefinition } from '../types'
import {
  CHARACTER_TURNAROUND_EXAMPLES,
  formatStylePresetsForSystem,
} from './character-turnaround-presets'

/** 人物多视图 / 四视图提示词骨架（单段中文，可直接用于 AI 生图）
 *  Keep in sync with services/agent-runtime/app/tools/prompt_templates.py */
export const CHARACTER_TURNAROUND_TEMPLATE = `一张专业的{摄影风格}写实摄影{图类型}，主角是一位{角色一句话概述}。

角色特征：{性别}，{年龄}，{体型描述（含身高）}，{肤色}，
发型：{发型详细描述}，
五官：{五官详细描述}，
服装：{完整服装描述，含风格与面料}，
配饰/道具：{配饰列表}。

「{背景描述}」，确保角色清晰突出。

{光线描述}。

画面分为四格布局，统一水平对齐、相同比例、相同服装与细节：
第一格：{近景特写描述}，
第二格：{正面全身描述}，
第三格：{侧面全身描述}，
第四格：{背面全身描述}。

{摄影风格}摄影风格，高分辨率，{重点材质质感}，专业{图类型}参考图品质。`

const PRIMARY_FEW_SHOT =
  CHARACTER_TURNAROUND_EXAMPLES.find((e) => e.presetId === 'photoreal_commercial') ??
  CHARACTER_TURNAROUND_EXAMPLES[0]

export const characterTurnaroundMode: PromptModeDefinition = {
  id: 'character_turnaround',
  label: '人物多视图',
  classifyHints:
    '用户要人物三视图/模特图/角色设定图/多视图/模特定妆图/Q版/Q萌/chibi/洛丽塔/婚纱/战术/牛仔/皮克斯/绘本插画/turnaround/正侧背/四视图，强调同一角色一致性、四格拼图出图',
  system: `你是角色设定与 AI 绘画提示词专家。根据用户短需求，输出一份**可直接用于 AI 生图的单段中文提示词**（连贯段落，非 Markdown 分节、非中英对照）。

严格按以下骨架填充，将 {占位符} 替换为具体内容：

${CHARACTER_TURNAROUND_TEMPLATE}

【风格预设库（按用户意图选最接近者，可混合但需自洽）】
${formatStylePresetsForSystem()}

【默认值（用户未指定时使用）】
- 优先匹配上述预设；无明确风格时用「写实商业模拍」
- 图类型：角色设定图 / 模特定妆参考图
- 背景：「纯白背景」（赛博朋克/3D 等预设除外）
- 光线：见对应预设
- 四格：近景特写 + 正 / 侧 / 背全身

【质量要求】
1. 四格必须为同一角色、同一服装发型，禁止每格换人换装
2. 第一格为近景/特写，后三格为正 / 侧 / 背全身；四格同框、一次出图
3. 根据用户输入合理推断缺失细节，但不得与用户矛盾
4. 若用户要求多种风格，按风格分段输出多个完整提示词（每段之间空一行，段首标注风格名）
5. Q版/Q萌/chibi（二头身、超大眼）用 chibi_kawaii，勿与 Sweet Lolita 时装或普通日系动画正比混淆
6. 若用户只要单张定妆/肖像（不含多视图），省略四格布局，改为单张半身或全身描述
7. 禁止只复述用户原句；禁止输出 Markdown 标题或 JSON`,
  fewShot: {
    user: PRIMARY_FEW_SHOT.user,
    assistant: PRIMARY_FEW_SHOT.assistant,
  },
  placeholder: (prompt) => {
    const styleHints = CHARACTER_TURNAROUND_EXAMPLES.slice(0, 3)
      .map((e) => `· ${e.user}`)
      .join('\n')
    return `【提示词草案·人物多视图】\n\n基于「${prompt}」：\n\n${CHARACTER_TURNAROUND_TEMPLATE.replace(/\{[^}]+\}/g, '…')}\n\n可选风格样例：\n${styleHints}\n\n（配置 OPENAI_API_KEY 后可获得完整填充版本）`
  },
}

export {
  CHARACTER_TURNAROUND_STYLE_PRESETS,
  CHARACTER_TURNAROUND_EXAMPLES,
  formatStylePresetsForSystem,
} from './character-turnaround-presets'
