import { describe, it, expect } from 'vitest'
import { validateCommercialStoryboardOutput } from './commercial-storyboard-validate'

describe('validateCommercialStoryboardOutput', () => {
  it('passes well-formed commercial storyboard', () => {
    const content = `## 1. 商业策略上下文
- 品类：智能汽车

## 2. 规则映射摘要
- 视觉语法：低角度仰拍

## 3. 分镜执行脚本

| 序号 | 时长(秒) | 景别与视角 | 画面内容 | 镜头运动 | 营销文案(旁白/大字) | 声音设计 | 剪辑节奏 |
| 1 | 0-3 | 中景+平视 | 手指点击按钮，居中构图，冷蓝硬调 | 固定 | 大字：交给它 | 触控声 | 硬切 |
| 2 | 3-6 | 特写+俯视45° | 屏幕点亮，居中构图，冷蓝硬调 | 微推 | 无 | 叮 | 硬切 |
| 3 | 6-9 | 近景+平视 | 双手离盘，居中构图，冷蓝硬调 | 固定 | 无 | 环境音 | 硬切 |
| 4 | 9-12 | 微距+平视 | 雷达点亮，居中构图，冷蓝硬调 | 固定 | 无 | 脉冲 | 硬切 |
| 5 | 12-15 | 全景+低角度仰拍 | 车辆转弯，居中构图，黑金硬调 | 跟拍 | 无 | 风声 | 硬切 |
| 6 | 15-18 | 中景+平视 | 后排观影，居中构图，暖调 | 横移 | 无 | 环绕 | 叠化 |
| 7 | 18-21 | 特写+平视 | 嘴角上扬15度，居中构图，暖调 | 微推 | 无 | 风声 | 叠化 |
| 8 | 21-24 | 特写+低角度仰拍 | Logo发光，居中构图，黑金硬调 | 固定 | AITO | 混响 | 硬切 |

## 4. 质量校验锁
- [x] 开头3秒验证：已建立冲突
- [x] 产品露出验证：前30%已出现
- [x] 文字可读性验证：通过
- [x] 声音独占验证：通过
- [x] 物理可行性验证：通过`

    const result = validateCommercialStoryboardOutput(content)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('fails when sections missing', () => {
    const result = validateCommercialStoryboardOutput('只有一段散文')
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })
})
