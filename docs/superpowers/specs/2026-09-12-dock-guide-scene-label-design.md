# Dock 场景显性名 + 中文脚手架（方案 A）

> 状态：已批准（2026-09-12）  
> 范围：Prompt/Image Dock 标题栏标签；Catalog 用户可见脚手架中文化

## 决策

| 项 | 选择 |
|----|------|
| Dock 显性 | 标题栏「图标 + 场景名」；未选「场景模板」 |
| 用户预填 | `promptScaffold` / `changePreserveTemplate` → **中文**（保留 `{{…}}` 占位） |
| 扩写约束 | `systemOverlay` → **仍英文** |
| 可选「切换英文」 | **本期不做**（方案 A） |

## Dock UI

- PromptDockPanel / ImageDockPanel：`activeGuideScene?.label ?? '场景模板'`
- 已选 fuchsia + 小圆点；长名 ellipsis
- Refine：已有意图名，不改交互；仅受益于中文 `changePreserveTemplate`

## Catalog

- 改写全部 G1–G9 / E1–E8 的用户可见模板为中文
- 不新增 `promptScaffoldEn` 字段（YAGNI）
- `applyGuideSceneToPrompt` / `applyGuideEditIntent` 逻辑不变（空框预填、非空只挂 id）

## 不做

- 一键英/中切换、机翻、locale 设置
- Dock popover portal（仍 above-end）
- Image 2.5 / preferredParams 全量接线
