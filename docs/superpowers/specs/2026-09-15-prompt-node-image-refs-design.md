# 提示词节点图片 refs 识图对齐 — 设计规格

> 状态：**已确认，实施中**（2026-09-15）  
> 范围：画布 `prompt` 节点 Dock / Agent `runPromptGeneration` 生成时消费图片 refs，识图链路与 `text` 节点对齐。  
> 非范围：#324 对话 `parse_sidebar_media`；文字 refs 的 LLM merge（仍不 merge）；`expandPromptContent` 周转图管线。

## 决策

| 项 | 选择 |
|---|---|
| 抽图 | 与文本节点相同：`resolveStudioRefs` / `toStudioRefs` → `extractReferenceImages` → `inlineUpstreamReferenceImages` |
| 识图 | 扩写调用使用 `supportsVisionTextModel`：视觉模型最后一轮 user 带 `image_url`；非视觉走 `appendImageRefsForTextOnlyPrompt` |
| 分类 | 仍纯文本（空需求时用固定短句分类） |
| 模式模板 | 保留 few-shot / 商业分镜校验 / guide overlay；**不**整段改走 `generateTextForRefs` |
| 空需求 + 仅图 | 允许生成 |
| `@` 提及 | 图仍全部进识图；system 写「优先参考」 |
| 元数据 | 记录 `visionUsed`、`referenceImages`、`refsCount` |
| 积分 | 仍 5 点「提示词模式生成」 |

## AC

1. Flash/Gemini + 参考图：扩写请求含 `image_url`，`visionUsed=true`，正文描述画面而非只扩写输入字。  
2. `deepseek-v4-pro` + 参考图：无 `image_url`，正文含「不支持直接识图」，`visionUsed=false`。  
3. 无图：行为与现网一致，`visionUsed=false`。  
4. 空 prompt + 至少一张图片 URL：可点生成。  
5. Agent `runPromptGeneration` 把节点 localRefs/连线图传给 `generatePrompt`。
