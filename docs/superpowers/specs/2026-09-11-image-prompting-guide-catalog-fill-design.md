# Image Prompting Guide Catalog 补全（设计文档）

> 状态：§1–§2 已定稿并写入  
> 日期：2026-09-11  
> 父规格：[2026-09-11-image-prompting-guide-catalog-design.md](./2026-09-11-image-prompting-guide-catalog-design.md)（P0 已合并 #278）  
> 范围：一次交付「极简 Dock 入口 + 全量剩余 12 个官方场景/意图」；仍不接 Image 2.5 模型

## 决策摘要

| 项 | 选择 |
|---|---|
| 补全范围 | **A**：一次做满剩余 12 个（G2/G4–G9 + E1/E2/E6–E8） |
| 选择器形态 | **C 下拉搜索**（非扁平芯片、非分组折叠主交互） |
| Dock 极简入口 | 右上角 **场景模板图标替换 `×`**；关闭仅靠 **点空白 + Esc** |
| 实现路径 | **方案 2**：共享 `GuidePickerPopover` + 一次注册全量 Catalog |
| 三入口统一 | Prompt / Image Dock → 生成场景；Refine → 编辑意图下拉；去污/替换选区仍为快捷芯片 |
| 模型 | 仍 `image2`；G4/E5 透明底 capability 不足则列表禁用 |
| 不做 | Image 2.5 接线、ChatGPT Templates/Sketch、把 G/E 塞进 `PromptModeId` |

---

## §1 交互与壳层

### 1.1 Prompt / Image Dock

1. `DockToolbarShell` 右上角：以 **场景模板** 图标按钮替换关闭 `×`。
2. 未选场景：图标 muted；已选 `guideSceneId`：fuchsia 高亮 + 小圆点（验收态）。
3. 点击图标：锚定弹出 `GuidePickerPopover`（搜索框 + 分组列表 +「清除场景」）。
4. 选中行为沿用既有 `applyGuideSceneToPrompt`：空 prompt 预填 scaffold；非空只挂 id + toast「已套用约束，未改写原文」。
5. **关闭 Dock**：点击画布空白关闭（沿用 `CanvasPage` 现有逻辑）；**Esc 关闭**（若现状缺失则本期补齐）。不再提供 `×`。

### 1.2 Refine 侧栏

1. 保留快捷芯片：`去除污渍瑕疵`、`替换选区内容`。
2. 新增右上（或标题栏对称位置）**编辑意图** 图标 → 同一 `GuidePickerPopover`（mode=`edit_intent`）。
3. 列表含全部 E1–E8；capability / minRef 规则沿用 `applyGuideEditIntent`（fill 可填模板，submit 拦截）。
4. E5（及任何 `requiresTransparentBackground`）无透明底能力时禁用 + 中文原因。

### 1.3 关闭与可达性（已选 A 的约束）

- 产品明确接受：无 `×`，依赖空白点击 + Esc。
- 实现必须保证：Desktop 空白关闭路径可用；Esc 在 Dock / Refine 打开时关闭面板；下拉打开时 Esc 先关下拉再关 Dock（标准嵌套焦点）。

---

## §2 Catalog / taxonomy / 落点

### 2.1 生成场景（Prompt / Image 共用下拉）

| ID | 标签 | 分组 | 状态 |
|----|------|------|------|
| `g1_style_lighting` | 风格与光线 | 摄影/广告 | 已有 |
| `g3_exact_text` | 精确文字 | 摄影/广告 | 已有 |
| `g2_process_infographic` | 流程信息图 | 信息设计 | 新增 |
| `g8_scientific_visual` | 科学教育图 | 信息设计 | 新增 |
| `g9_slides_charts` | 幻灯片/图表 | 信息设计 | 新增 |
| `g4_reusable_logo` | 可复用 Logo | 品牌/UI | 新增；透明底 gate |
| `g7_interface_preview` | 界面预览 | 品牌/UI | 新增 |
| `g5_historical_context` | 历史语境 | 叙事 | 新增 |
| `g6_comic_strip` | 故事漫画分格 | 叙事 | 新增；`expandViaPromptMode: storyboard` |

分组仅用于下拉分区标题与搜索过滤，不作为主栏芯片。

### 2.2 编辑意图（Refine 下拉）

| ID | 标签 | 分组 | 状态 |
|----|------|------|------|
| `e1_translate_layout` | 版面翻译 | 局部手术 | 新增 |
| `e7_remove_object` | 去物体 | 局部手术 | 新增 |
| `e3_identity_clothing` | 换装保身份 | 身份/产品 | 已有 |
| `e5_transparent_cutout` | 透明抠图 | 身份/产品 | 已有；透明底 gate |
| `e8_insert_person` | 人物入景 | 身份/产品 | 新增 |
| `e2_style_transfer` | 风格迁移 | 参考合成 | 新增 |
| `e4_combine_refs` | 多参考合成 | 参考合成 | 已有 |
| `e6_drawing_to_realistic` | 草图转写实 | 参考合成 | 新增 |

### 2.3 类型扩展

在既有 `GenerationScene` / `EditIntent` 上增加可选：

```ts
groupId?: 'photo_ad' | 'info_design' | 'brand_ui' | 'narrative'
  | 'local_edit' | 'identity_product' | 'ref_compose'
groupLabel?: string
```

`GuidePickerPopover` 按 `groupId` 聚类；搜索匹配 `label` / `description` / taxonomy 关键词。

### 2.4 组件与文件

| 路径 | 职责 |
|------|------|
| `apps/web/.../GuidePickerPopover.vue` | 搜索下拉、分组、禁用、清除 |
| `apps/web/.../DockToolbarShell.vue` | 场景入口 slot；移除默认 `×`（由调用方决定） |
| `PromptDockPanel.vue` / `ImageDockPanel.vue` | 去掉芯片行；接场景图标 + popover |
| `RefineSidePanel.vue` | 编辑意图图标 + popover；保留去污/替换芯片 |
| `packages/shared/src/imagePromptingGuide/scenes/*` | 新增 G2/G4–G9 |
| `packages/shared/src/imagePromptingGuide/intents/*` | 新增 E1/E2/E6–E8 |
| `catalog.ts` + tests | 注册全量 id |
| `image-prompting-guide-taxonomy.yaml`（agent + skill assets） | 关键词补齐 |
| `guide_taxonomy.py` / tests | 解析新 id |

### 2.5 Agent

继续 **仅 taxonomy 钩子** 写 `guideSceneId` / `guideEditIntentId`；不强制自动多轮编辑。双命中时仍优先 edit intent（换装/抠图/合成等）。

### 2.6 测试与验收

1. Catalog：9 生成 + 8 编辑 id 齐全；G4/E5 `requiresTransparentBackground`。  
2. Popover：搜索过滤；禁用项不可选；清除清空 guide id。  
3. Dock：无 `×`；Esc / 空白关闭；图标高亮随 `guideSceneId`。  
4. Refine：去污芯片仍在；E* 经下拉；submit 门禁回归。  
5. taxonomy：新关键词命中测试。  
6. 生产：扩展 `deploy/prod-image-prompting-guide-verify.py` 覆盖至少 1 个新 scene + 1 个新 intent stamp。

### 2.7 明确不做

- Image 2.5 Flare/Sunburst 接线与透明底解锁（仍走父规格附录 A）  
- ChatGPT Poster/Merch / Sketch  
- 主栏恢复扁平芯片墙  
- 新增 `PromptModeId` 枚举项承载 G/E

---

## Spec Self-Review

- [x] 无 TBD 占位需求  
- [x] 与父规格双轨 Catalog / capability 一致  
- [x] 关闭策略（无 ×）与 Esc/空白要求写死  
- [x] 全量 id 列表无歧义  
- [x] 范围可单 PR 交付（UI 壳 + 12 资产 + taxonomy）

## 关系

本规格是父规格「下期 A：Catalog 补全」的落地设计；「下期 B：Image 2.5」仍独立专项。
