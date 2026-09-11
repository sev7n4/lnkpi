# Refine 编辑意图 — 手工验收清单

> 对应 Catalog Fill（PR #279）Refine 侧栏：`GuidePickerPopover` `mode=edit_intent`  
> 自动化：`deploy/verify-refine-edit-intent-local.sh`（逻辑）+ `deploy/prod-refine-edit-intent-verify.py`（agent 盖章）

## 前置

1. 打开生产/预发画布，选中一张**图片节点**，进入精修（Refine）侧栏  
2. 确认模型为当前 image2（无透明底能力时 E5 应禁用）

## UI 壳层

- [ ] 标题栏有「编辑意图」四格图标；未选中时 muted，选中后 fuchsia 高亮 + 小圆点  
- [ ] 点击图标弹出下拉：搜索框 + 分组列表（局部手术 / 身份产品 / 参考合成）  
- [ ] 仍可见快捷芯片：**去除污渍瑕疵**、**替换选区内容**  
- [ ] **没有** E1–E8 平铺芯片墙  
- [ ] Esc：先关下拉，再关精修面板（嵌套）  
- [ ] 「清除意图」可清空当前编辑意图（不清空用户已改 prompt，除非产品另定）

## 模板 fill（选意图 → prompt 预填）

对下列意图各测一次「空 prompt 时选中 → 写入 changePreserveTemplate」：

| ID | 标签 | 预期 |
|----|------|------|
| e1 | 版面翻译 | 填入翻译/保留版面类模板 |
| e2 | 风格迁移 | 填入风格迁移模板 |
| e3 | 换装保身份 | 填入换装模板 |
| e4 | 多参考合成 | 可填模板；提交时若参考不足应拦截 |
| e5 | 透明抠图 | **无透明底能力时禁用**，不可选；有能力时可填 |
| e6 | 草图转写实 | 填入草图转写实模板 |
| e7 | 去物体 | 填入去物体模板 |
| e8 | 人物入景 | 填入人物入景模板 |

- [ ] 非空 prompt 时选意图：挂 id / 不强制覆盖全文（与现有 apply 行为一致）  
- [ ] 点「精修」submit：E5 无透明底仍拦截；minRef 不足时拦截并有中文原因

## 快捷芯片回归

- [ ] 去除污渍瑕疵：仍可用，并清除 activeGuideEditIntentId  
- [ ] 替换选区内容：仍聚焦 prompt / 不清错意图状态

## 记录

| 环境 | 日期 | 结果 | 备注 |
|------|------|------|------|
| 本地 unit | 2026-09-12 | PASS=4 | `bash deploy/verify-refine-edit-intent-local.sh` |
| 生产 agent stamp | 2026-09-12 | PASS=8 FAIL=0 | e1/e2/e3/e5/e6/e7/e8（未跑 e4，需双参考） |
| 生产 UI | | 未跑 | 需本清单勾选 |
