# 编辑工具链全面排查（2026-09-23）

主线决策背景：Agent 线冻结至 pi-core 内核切换后再迭代；本排查只覆盖**画布编辑工具链**（精修工作室 + 画布节点工具），为「补齐能力 → 端到端打通 → 体验优化」提供依据。

排查基线：origin/main `4b60c8d9`（已上线，Vercel 与 CVM 双入口均 200，线上 = 最新 main）。方法：逐规格对照 main 上的符号/文件/测试命中。

> **复核修正（2026-09-23 晚，批次 C 执行时）**：初版排查有两处误报已修正——① 视频时长滑轨**已实现**（`VideoSettingsSelector.vue` 的 `<input type="range">`，接线 ShotDockPanel / VideoDockPanel / GenerationBar 三处；初版搜索漏检）；② M2 §7.4 验收债实际为零（含嵌套切分钉死测试 `nested re-slice stamps sourceNodeId with the direct slice parent`）。另发现一个初版未报的真缺口：`/video-studio` 独立页滑轨范围 3–10 与 shared clamp（4–15）不一致，已在批次 C 修复。selection-batch flag 经用户拍板**维持默认 on 转正**（规格 v4）。

## 一、状态总表

| # | 规格 | 状态 | 最大缺口 |
|---|---|---|---|
| 1 | refine-selection-unified（09-23，#404） | ✅ 已实现 | 无 |
| 2 | refine-matting-unified-apply（09-22，#402） | ✅ 已实现 | rembg 部署物不在仓库（`MATTING_SERVICE_URL` 指外部服务） |
| 3 | workbench-shell-and-outpaint-pilot（09-22） | ✅ 已实现 | GridSliceWorkbench 未迁入 WorkbenchShell（规格自declare「下一包」）；方向快捷键/Alt 对称拖（P2）延后 |
| 4 | refine-m2-capability-pack（09-22） | ✅ 已实现 | agent-runtime 的 `upscale_image` 死工具残留（Nest 端点已删，Python 侧仍注册）；§7.4 已逐项核实通过（含嵌套切分钉死测试），无验收债 |
| 5 | image-editor-unified（09-21） | ⚠️ **部分实现** | 引擎包/裁剪/四操作菜单/商业化整章缺失（见二.1） |
| 6 | canvas-workflow-exchange（09-12） | ✅ 已实现 | 无 P0 |
| 7 | image-grid-slice P0+P1（09-15） | ✅ 已实现 | 基本无 |
| 8 | generic-canvas-compose（09-16） | ⚠️ 部分实现 | G15 `pending_composition_extract` 续跑未做；recipe 四件套仍在写工具集（见二.2） |
| 9 | composition-source-bind（09-17） | ✅ 已实现 | 无 |
| 10 | composition-land-production-gaps（09-17） | ⚠️ 部分补齐 | 识图 cap=4、P/look copy 写死、HITL 人话摘要（见二.3） |
| 11 | selection-batch-generate（09-17） | ✅ 已实现 | ~~flag 临时 on 违背灰度~~ → 2026-09-23 拍板转正（规格 v4），已消除悬置 |
| 12 | canvas-task-undo-video-ux（07-23） | ✅ 已实现 | 滑轨已实现并接线三处；唯 `/video-studio` 独立页范围 3–10 越界（批次 C 已修） |
| 13 | canvas-node-duplicate / media-info-footer / failure-diagnostics | ✅ 已实现 | 无 |

**排除项**：canvas-operator-2e 及全部 agent 线规格（atomic 2d、planner gate、SSE tool-call 等）——按主线决策冻结至 pi-core 切换。

## 二、缺口明细（按修复批次组织）

### 批次 A：image-editor-unified 补完（最大缺口，编辑工具链核心）

已落地：宫格 7×7 选择器（`GridSliceDropdown.vue`）、一键抠图（`handleFloatingMatting` → `/studio/image/matting`）、灯箱编辑入口（`MediaPreviewOverlay.vue`）。

未落地：
1. **裁剪仍是禁用占位**：`selectionToolModel.ts` 中 `crop: disabled: true, '裁剪将在后续能力包点亮'`；
2. **`@lnkpi/image-editor` 引擎包**（规格 §4）：`packages/` 下零命中；
3. **服务端 `MediaEditModule`**（§5）零命中；
4. **点选修改四操作上下文菜单**（§3.3 重绘/删除元素/换背景 preset）零命中；
5. **免费额度商业化头**（§6）零命中。

建议顺序：先点亮裁剪（复用 refine 已有 mask/几何基建，成本最低）→ 四操作菜单 → 引擎包重构 → 商业化。

### 批次 B：composition 收尾（端到端打通向）

1. G15 `pending_composition_extract` 续跑：main 零痕迹——构图提取中断后无法续跑，属链路断点；
2. P/look copy 写死两套：`compositionCopy.ts` 的 `P_SKELETON_PROMPT` 不随 `garmentRefs.length` 变化，多参考图场景文案失真；
3. HITL 人话摘要、脏会话卫生（P2）：无痕迹。
4. ⚠️ 边界：recipe 四件套从 `EXPLORE_WRITE_TOOLS` 移除动的是 agent-runtime，**冻结期内不动**（登记到 pi-core 切换后清单）。

### 批次 C：小项速修（✅ 2026-09-23 已完成）

1. ~~视频滑轨~~ → 复核为**误报**（`VideoSettingsSelector` 已实现并接线三处）；复核中发现的真缺口是 `/video-studio` 独立页滑轨 3–10 与 shared clamp（4–15）不一致——已修；
2. selection-batch flag：用户拍板**维持 on 转正**，`useFeatureFlag.ts` 注释正式化 + 规格 v4 修订；
3. refine §7.4 逐项验收：A（选择器复刻）/B1 撤回/B2 loading/B3 64px 下限/B4 嵌套钉死测试**全部通过**，验收债清零。

### 批次 D：体验优化（精修工作台 P2 池）

1. 方向键微调 / Alt 对称拖拽（outpaint 手柄，workbench-shell P2 记录项）；
2. GridSliceWorkbench 迁入 WorkbenchShell（统一工作台壳，规格自declare「下一包」）。

### 批次 E：死代码与运维（低优先）

1. agent-runtime `upscale_image` 死工具删除（Nest 端点已删但 Python 仍注册调用）——动 runtime 但属死代码清理，可在冻结期内顺手做，也可并入 pi-core 切换批；
2. rembg（抠图服务）Dockerfile/compose 入仓，消除对仓外部署的隐式依赖。

## 三、端到端健康

- 线上 = main `4b60c8d9`（#405 部署成功）；Vercel `/api/health` 200（2.3s，偏慢可观测）、CVM 8888 200。
- 已交付链路（选区/抠图/扩图/分镜板/工作流导入导出/选区批量生成）主路径均有测试覆盖（合计 20+ 份对应 `.test.ts`）。

## 四、建议推进序

**C（速修）→ B（composition 收尾）→ A（裁剪先点亮）→ D（体验池）→ A 余项（引擎包/商业化）**，E 穿插。A 的引擎包与商业化体量大，建议按 SDD 另立规格评审。
