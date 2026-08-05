/** 商业品牌分镜提示词 — 战略层 / 规则库 / 金样例
 *  Keep in sync with services/agent-runtime/app/tools/commercial_storyboard_presets.py */

export type CommercialRhythmModel = 'lightning_cut' | 'aida_narrative' | 'immersive_empathy'

export interface CommercialRhythmPreset {
  id: CommercialRhythmModel
  label: string
  durationRange: string
  avgShotSec: string
  productFirstAppear: string
  copyDensity: string
  platform: string
  rules: string[]
}

export interface AitoProductSpec {
  model: string
  usp: string
  keyData: string[]
}

export const COMMERCIAL_RHYTHM_PRESETS: CommercialRhythmPreset[] = [
  {
    id: 'lightning_cut',
    label: '闪电切割模型',
    durationRange: '≤15秒',
    avgShotSec: '1.0–1.5',
    productFirstAppear: '前3秒 / 第2镜内',
    copyDensity: '高（大字为主，少旁白）',
    platform: '抖音 / 朋友圈 / 信息流前贴片',
    rules: [
      '平均镜长 ≤1.5秒，剪辑硬切为主',
      '前3帧必见产品或产品交互界面',
      '剪辑点对齐重低音鼓点',
      '结尾3秒纯视觉落版（Logo+Slogan），禁止旁白',
    ],
  },
  {
    id: 'aida_narrative',
    label: 'AIDA叙事模型',
    durationRange: '≈30秒',
    avgShotSec: '2.5–3.5',
    productFirstAppear: '总时长前30%内实体出现',
    copyDensity: '中（旁白+屏幕大字结合）',
    platform: '官网 / 发布会 / 视频号',
    rules: [
      'Attention 0–5s：冲突/痛点/反差',
      'Interest 5–12s：产品亮相+核心交互',
      'Desire 12–22s：功能/设计/场景体验',
      'Action 22–30s：品牌落版+Slogan',
    ],
  },
  {
    id: 'immersive_empathy',
    label: '沉浸移情模型',
    durationRange: '≥60秒',
    avgShotSec: '4–5',
    productFirstAppear: '前10秒仅意境空镜，产品远景第2镜后可出现',
    copyDensity: '极低（几乎无旁白，画面说话）',
    platform: '影院TVC / 品牌周年 / 高端形象片',
    rules: [
      '前10秒禁止产品细节特写，只拍情绪与空镜',
      '运镜极慢速推拉，呼吸感剪辑',
      '中段交替：匠心/科技/人文蒙太奇',
      '结尾回归自然意境，品牌落版留3秒静默',
    ],
  },
]

/** 视觉语法映射（品类 → 强制视角/运镜/光影） */
export const VISUAL_GRAMMAR_BY_CATEGORY: Record<string, string> = {
  科技数码: '视角：俯视45°+微距特写；运镜：滑轨横移；光影：冷蓝调+硬朗侧逆光',
  美妆快消: '视角：平视正脸+产品旋转；运镜：呼吸感手持微推；光影：柔光+高饱和度',
  汽车重工: '视角：低角度仰拍+大广角；运镜：大范围航拍跟甩；光影：黑金调+高对比度',
  高端服务金融: '视角：对称构图+人物中景；运镜：完全固定；光影：暖黄调+光影切割',
  智能汽车: '视角：低角度仰拍+车内主观视角交替；运镜：滑轨横移+航拍跟甩；光影：黑金/冷蓝硬光+光塑曲面反射',
}

export const AITO_PRODUCT_SPECS: AitoProductSpec[] = [
  {
    model: '问界M9 Ultimate 领世加长版',
    usp: '通过华为乾崑智驾ADS 5.0与六激光雷达矩阵，为旗舰家庭提供全场景领航与移动影院级豪华',
    keyData: [
      '5402×2026×1845mm，轴距3236mm',
      '6激光雷达，ADS 5.0',
      '三电机超900马力，CLTC纯电750km',
      '32英寸投影巨幕，43单元音响',
    ],
  },
  {
    model: '问界M8 改款',
    usp: '通过M9同款智驾硬件与800V架构，为中大型家庭提供旗舰级智能与安全',
    keyData: ['5190×1999×1795mm，轴距3105mm', '75kWh电池，WLTC纯电352km', '5/6座可选'],
  },
  {
    model: '问界M6 纯电 Max+',
    usp: '通过100kWh长续航与896线激光雷达，为年轻家庭提供760km无忧纯电出行',
    keyData: [
      '4960×1985×1736mm，轴距2950mm，风阻0.239',
      'CLTC 760km，800V快充20分钟10%-80%',
      '896线激光雷达，ADS 3.0',
    ],
  },
  {
    model: '问界M7 增程长续航版',
    usp: '通过增程长续航与192线激光雷达，为家庭用户提供1690km综合出行自由',
    keyData: ['5080×1999×1780mm', 'CLTC纯电327km，综合1690km', '192线激光雷达'],
  },
]

export const COMMERCIAL_STORYBOARD_TABLE_HEADER = `| 序号 | 时长(秒) | 景别与视角 | 画面内容 | 镜头运动 | 营销文案(旁白/大字) | 声音设计 | 剪辑节奏 |
| :---: | :---: | :--- | :--- | :--- | :--- | :--- | :--- |`

export const COMMERCIAL_QUALITY_CHECKLIST = [
  '开头3秒验证：是否建立冲突/痛点/反差？否则废弃重设计镜1',
  '产品露出验证：总时长前30%内产品是否实体出现？',
  '文字可读性验证：屏幕大字每行≤5字，深色背景对比度足够？',
  '声音独占验证：旁白时BGM中频挖孔；品牌落版时绝对安静仅留音效',
  '物理可行性验证：运镜是否需要轨道/伸缩炮？成本过高则给固定机位替代',
]

export function formatRhythmPresetsForSystem(): string {
  return COMMERCIAL_RHYTHM_PRESETS.map(
    (p) =>
      `- ${p.label}（${p.durationRange}）：镜长${p.avgShotSec}s；${p.platform}；规则：${p.rules.join('；')}`,
  ).join('\n')
}

export function formatAitoSpecsForSystem(): string {
  return AITO_PRODUCT_SPECS.map(
    (s) => `- ${s.model}：USP「${s.usp}」；参数：${s.keyData.join('；')}`,
  ).join('\n')
}

/** 30秒叙事型 · 问界M9 · 金样例（完整表格） */
export const COMMERCIAL_STORYBOARD_PRIMARY_EXAMPLE = {
  user: '问界M9，30秒官网发布会暖场片，受众商务男性，强调乾崑智驾ADS 5.0与32英寸投影巨幕',
  assistant: `## 1. 商业策略上下文（Agent内部推理，简要展示）
- 品类：智能汽车（问界/AITO）
- USP：通过华为乾崑智驾ADS 5.0，帮商务用户在都市通勤场景下实现全场景Hands-off领航
- 受众：35-45岁商务男性，焦虑时间碎片与通勤疲劳
- 平台/时长：官网/发布会 · 30秒
- 战役阶段：新品上市 · 技术说服+情感共鸣
- 选用节奏模型：**AIDA叙事模型**

## 2. 规则映射摘要
- 视觉语法：低角度仰拍+车内主观视角；滑轨横移；黑金/冷蓝硬光+光塑曲面
- 声音：弦乐+电子融合；结尾3秒品牌落版+Mnemonic，禁止旁白

## 3. 分镜执行脚本

${COMMERCIAL_STORYBOARD_TABLE_HEADER}
| 1 | 0-3 | 全景+俯视大广角 | 城市天际线晨雾，问界M9从地下车库缓缓驶出 | 航拍俯冲降至车顶 | （无旁白） | 城市白噪音；弦乐起 | 叠化 |
| 2 | 3-5 | 中景+平视车内 | 商务男性坐进驾驶座，手轻抚Nappa真皮方向盘 | 缓慢推镜至侧脸 | 旁白：「每一天，都是新的征途。」 | 车门关闭厚重声 | 硬切 |
| 3 | 5-8 | 特写+俯视45° | 寰宇三连屏点亮，导航路线自动规划完成 | 微距推至路线图中央 | 旁白：「但真正的领航者，从不亲自掌舵。」 | 屏幕点亮「叮」 | 硬切 |
| 4 | 8-11 | 近景+后排视角 | 双手离开方向盘，城区自动行驶，HUD标注行人车辆 | 手持微晃 | 旁白：「华为乾崑智驾 ADS 5.0，全场景领航。」 | 轻柔科技环境音 | 硬切 |
| 5 | 11-14 | 微距+平视 | 6颗激光雷达依次点亮，蓝色立体矩阵扫描 | 固定+光效 | 屏幕大字：6激光雷达·立体矩阵 | 脉冲扫描声叠加 | 硬切 |
| 6 | 14-18 | 全景+低角度仰拍 | 沿海公路行驶，光塑曲面反射夕阳 | 跟拍+缓慢拉镜 | 旁白：「从容，源于对技术的绝对自信。」 | 海浪+风声 | 叠化 |
| 7 | 18-21 | 中景+后排平视 | 32英寸投影巨幕观影，孩子安静入睡 | 缓慢横移 | 旁白：「而豪华，是让每一个人都感到被尊重。」 | 极低音量影片对白 | 叠化 |
| 8 | 21-25 | 特写+平视正面 | 驾驶者嘴角微扬，眼神自信直视前方 | 呼吸感微推 | 旁白：「问界M9，为每一次出发，定义新的高度。」 | 轻柔风声 | 叠化 |
| 9 | 25-30 | 特写+低角度仰拍 | 车头正面，智慧投影大灯点亮，Logo发光，Slogan浮现 | 完全固定 | AITO 问界M9 + 领世而上 | 品牌落版金属混响；BGM收束 | 硬切 |

## 4. 质量校验锁（已通过）
${COMMERCIAL_QUALITY_CHECKLIST.map((c) => `- [x] ${c}`).join('\n')}`,
}

/** 15秒闪电型 · 问界M6 · 金样例（完整表格） */
export const COMMERCIAL_STORYBOARD_LIGHTNING_EXAMPLE = {
  user: '问界M6纯电Max+，15秒抖音前贴片，强调智驾解放双手与760km续航',
  assistant: `## 1. 商业策略上下文
- 品类：智能汽车（问界/AITO）
- USP：通过100kWh长续航与896线激光雷达，帮年轻家庭在都市通勤场景下实现760km无忧纯电出行
- 受众：28-38岁白领，焦虑通勤堵车与时间碎片
- 平台/时长：抖音 · 15秒
- 战役阶段：大促引流 · 强曝光+强转化
- 选用节奏模型：**闪电切割模型**

## 2. 规则映射摘要
- 视觉语法：低角度仰拍+车内主观视角；滑轨横移；黑金/冷蓝硬光
- 声音：重低音鼓点对齐硬切；12-15s 品牌落版 Mnemonic，禁止旁白

## 3. 分镜执行脚本

${COMMERCIAL_STORYBOARD_TABLE_HEADER}
| 1 | 0-1.5 | 特写+主观视角 | 高架桥方向盘前视角，前方尾灯红色长龙，仪表盘显示时速0km/h，居中构图，冷蓝硬调 | 固定 | 屏幕大字：还在堵着？ | 喇叭声放大；BGM 不和谐电子警报单音 | 硬切 |
| 2 | 1.5-3.5 | 特写+俯视45° | 手指轻触中控屏「智驾领航」图标，界面流光切换至导航路线图，图标居中 | 微推+轻微旋转 | 屏幕大字：交给它 | 触控「嗒」；BGM 急促变奏 | 硬切 |
| 3 | 3.5-5.5 | 中景+平视后排 | 驾驶员双手离开方向盘，城区道路自动行驶，窗外街景快速掠过 | 滑轨横移 | 屏幕大字：华为ADS 3.0 | 科技感 Whoosh；BGM 鼓点加强 | 快切 |
| 4 | 5.5-7.0 | 微距+平视 | 896线激光雷达特写，蓝色光脉冲扫过雷达面罩，居中构图 | 固定+呼吸感 | （无文字） | 脉冲扫描「嗡——嗡——」；BGM 推向副歌 | 硬切 |
| 5 | 7.0-8.5 | 特写+低角度仰拍 | 车轮碾过积水，水花飞溅，AITO 车标在水花中清晰可见 | 跟拍+60fps升格 | （无文字） | 水花声放大拉长；BGM 副歌持续 | 叠化 |
| 6 | 8.5-10.0 | 全景+平视 | 车辆驶出隧道，阳光洒满车身，光塑曲面反射流动光影 | 拉镜至全景 | 屏幕大字：CLTC 760km | 风声渐起；BGM 最高潮 | 硬切 |
| 7 | 10.0-12.0 | 近景+平视后排 | 后排乘客靠椅背，中控屏显示剩余续航760km，手指指向数字 | 缓慢推镜 | （无文字） | 轻柔提示音；BGM 旋律舒缓 | 叠化 |
| 8 | 12.0-15.0 | 特写+低角度仰拍 | 问界M6 车头正面，智慧大灯点亮，Logo 发光，Slogan 浮现 | 完全固定 | 问界M6 + 纯电新标杆 | 品牌落版金属混响一击即收；BGM 戛然而止 | 硬切 |

## 4. 质量校验锁（已通过）
${COMMERCIAL_QUALITY_CHECKLIST.map((c) => `- [x] ${c}`).join('\n')}`,
}

/** 60秒沉浸型 · 问界M9 · 金样例（完整表格） */
export const COMMERCIAL_STORYBOARD_IMMERSIVE_EXAMPLE = {
  user: '问界M9 Ultimate，60秒品牌周年形象片，强调科技与人文交汇，几乎无旁白',
  assistant: `## 1. 商业策略上下文
- 品类：智能汽车（问界/AITO）
- USP：通过华为乾崑智驾ADS 5.0与六激光雷达矩阵，为旗舰家庭提供全场景领航与移动影院级豪华
- 受众：35-50岁高净值家庭，焦虑品质生活与家庭时间
- 平台/时长：影院TVC / 品牌周年 · 60秒
- 战役阶段：品牌周年 · 强情感+强调性
- 选用节奏模型：**沉浸移情模型**

## 2. 规则映射摘要
- 视觉语法：前10s 极远景空镜；中段低角度+航拍；黑金光塑曲面+暖冷交替
- 声音：极简钢琴+环境 ASMR；55-60s 品牌落版留 3 秒静默，禁止旁白

## 3. 分镜执行脚本

${COMMERCIAL_STORYBOARD_TABLE_HEADER}
| 1 | 0-5 | 极远景+平视 | 戈壁公路天地一线，朝阳从地平线升起，远处小黑点缓缓驶来 | 极慢速推镜 | （无旁白无文字） | 纯净风声；极简钢琴单音 | 叠化 |
| 2 | 5-10 | 远景+低角度仰拍 | 问界M9 从镜头前驶过，车身倒映天空云彩，光塑曲面流动 | 极慢速横移跟拍 | （无旁白无文字） | 轮胎低频轰鸣；钢琴渐入 | 叠化 |
| 3 | 10-15 | 特写+平视 | 工匠之手在灯下打磨车漆，细微颗粒在灯光下闪烁，手部居中 | 微距极慢推镜 | （无旁白） | 打磨 ASMR；弦乐加入 | 叠化 |
| 4 | 15-20 | 中景+平视 | 设计师铅笔划过图纸，窗外深夜城市灯火，设计师半身居中 | 缓慢拉镜 | （无旁白） | 铅笔沙沙声；弦乐渐强 | 叠化 |
| 5 | 20-25 | 特写+俯视45° | 鸿蒙座舱4.0界面流转，小艺图标闪烁，屏幕显示「连接万物」 | 固定+屏幕光效呼吸 | （无旁白） | 轻柔电子脉冲；电子融入弦乐 | 硬切 |
| 6 | 25-30 | 微距+平视 | 激光雷达精密内部结构，电路板光信号传输，居中构图 | 微距推镜+旋转 | （无旁白） | 精密机械细微声；科技节奏铺陈 | 硬切 |
| 7 | 30-35 | 全景+俯视航拍 | 车辆行驶蜿蜒山路，车灯划出光轨，车辆沿 S 弯居中 | 大范围航拍跟甩 | （无旁白） | 风声+轮胎声；情绪推向高潮 | 叠化 |
| 8 | 35-40 | 近景+平视车内 | 不同年龄性别驾驶者从容表情蒙太奇，每张脸停留1.5秒 | 呼吸感微推 | （无旁白） | 极微弱心跳；旋律回归平和 | 叠化 |
| 9 | 40-45 | 中景+平视后排 | 一家人车内，孩子看投影巨幕动画，父母轻声交谈，全家居中 | 缓慢横移 | （无旁白） | 模糊笑声对话；温暖弦乐 | 叠化 |
| 10 | 45-50 | 特写+低角度仰拍 | 夜幕城市行驶，智慧投影大灯地面迎宾光毯展开 | 固定+光效流动 | 屏幕大字：科技应有温度 | 光毯展开轻柔声；旋律收束前奏 | 叠化 |
| 11 | 50-55 | 远景+平视 | 车辆停悬崖边，远方雪山，晨光照亮车身，车居中 | 极慢速拉镜 | （无旁白） | 风声+远处鸟鸣；钢琴独奏 | 叠化 |
| 12 | 55-60 | 特写+低角度仰拍 | 品牌 Logo 浮现画面中央，背景流动星空，Slogan 小字下方 | 完全固定 | AITO 问界 + 探索智能出行新边界 | 宇宙感混响；BGM 完全静默留3秒 | 硬切 |

## 4. 质量校验锁（已通过）
${COMMERCIAL_QUALITY_CHECKLIST.map((c) => `- [x] ${c}`).join('\n')}`,
}

/** @deprecated use COMMERCIAL_STORYBOARD_LIGHTNING_EXAMPLE */
export const COMMERCIAL_STORYBOARD_LIGHTNING_SAMPLE = {
  rhythm: 'lightning_cut' as const,
  product: '问界M6 纯电 Max+',
  duration: '15秒',
  shotCount: '8镜',
  hook: COMMERCIAL_STORYBOARD_LIGHTNING_EXAMPLE.user,
}

/** @deprecated use COMMERCIAL_STORYBOARD_IMMERSIVE_EXAMPLE */
export const COMMERCIAL_STORYBOARD_IMMERSIVE_SAMPLE = {
  rhythm: 'immersive_empathy' as const,
  product: '问界M9 Ultimate',
  duration: '60秒',
  shotCount: '12镜',
  hook: COMMERCIAL_STORYBOARD_IMMERSIVE_EXAMPLE.user,
}
