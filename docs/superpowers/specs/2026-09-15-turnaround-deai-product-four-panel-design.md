# 写实四格去掉 AI 化 + 产品四格角度锁定

> 状态：**P0 已落地，待提交**（2026-09-15）  
> 日期：2026-09-15  
> 产品：超创平台角色/产品四格扩写（prompt-modes + image `expandPromptContent`）  
> 范围：写实人物三视图/四格的去 AI 化模版；产品四格扩写骨架与路由  
> 非范围：关闭 Call-1、文案拦截、G1/G3、Dock 结果卡、新 PromptModeId、换生图模型  
> 关联：[2026-08-05-turnaround-image-pipeline-design.md](./2026-08-05-turnaround-image-pipeline-design.md)

## 0. 决策

| # | 决策 |
|---|---|
| **D1** | 独立去 AI 化模版退出扩写：system 不再注入 `formatDeaiRulesForSystem()`；写实金样不再追加 Negative Prompt、85mm、f/2.8、胶片颗粒。 |
| **D2** | 写实商业模拍预设改回设定图几何：近景特写 + **正面 / 90° 侧面 / 背面**，四格同样清晰、均匀棚光。禁止「约 45° 微侧」「禁止机械正侧背」。 |
| **D3** | 非写实预设（Q 版、高定、赛博等）本轮不改。 |
| **D4** | `four_panel_product` 不是第八个 PromptModeId。产品句 `mode=generic`，用产品四格 overlay。 |
| **D5** | 产品四格第三格默认 **90° 侧面**，第四格默认 **背面**；用户明确说俯视才俯视。均匀棚灯，禁止浅景深与 Negative Prompt。 |
| **D6** | 「生成这个产品的三视图/四视图」必须在 **Call-1 之前** 走产品 overlay，禁止进 `character_turnaround`。 |
| **D7** | Image 节点：产品四格句即使没有 `pipeline=turnaround_image` 也要扩写 + 2:1。不承诺生图模型四格同框 100% 稳定。 |
| **D8** | TS 与 Python `prompt_templates` / presets 同步。生产冒烟不再要求写实句含 Negative Prompt / 85mm。 |

## 1. 问题

写实人物四格叠了去 AI 化（浅景深、45°、不对称站姿、文末英文 Negative），和设定图几何冲突，出图变差。产品四格常被打成人物模版；即便分开，overlay 把侧面写成「或 45°」、背面写成「或俯视」，角度不稳。

## 2. 验收

- 写实人物四格 system / few-shot **不含** `去AI化`、`Negative Prompt`、`85mm`、`约45度`。
- 写实预设 `panel3` 为 90° 侧面全身，`panel4` 为背面全身。
- `生成这个产品的三视图提示词` → `mode=generic`，扩写 system 含同一 SKU、90° 侧面、背面，不含全身/肤质/Negative Prompt。
- Image `startImageGeneration`：产品四格句无 pipeline 也调用 `expandPromptContent` 且 aspect 2:1。
- CG/Q 版等非写实四格仍走 `character_turnaround`，不注入去 AI 化。
