# 生产金标复测指南（Composition Source Bind B1–B9）

> **Generated:** 2026-09-18 16:00 UTC+8
> **PR merged:** #364 (docs) + #365 (代码) + #366 (journey trace) + #367 (import fix)
> **Spec:** `docs/superpowers/specs/2026-08-13-product-visual-journey-trace-design.md` + `docs/superpowers/plans/2026-09-17-composition-source-bind.md`

## ⚠️ 严禁

**Do NOT run on session `cmu4kmyy6000fo301p08o6zjn`** (H8 canvas). 必须用全新 canvas。

---

## 步骤 0: 部署验证

```bash
# 检查 API 健康
curl -s http://119.29.173.89:8888/api/health | jq .

# 检查 agent runtime 健康（如果是分开部署）
curl -s http://119.29.173.89:5100/health | jq .
```

期望：返回 200 + status ok

## 步骤 1: 登录 + 创建新 Canvas

```text
URL: http://119.29.173.89:8888
Phone: 17279698608
Code:  123456
```

**新建一个 canvas**（不复用 H8 session），记录新 sessionId。

## 步骤 2: 侧栏加 5 张图片（参考图）

| 序号 | 角色 | 上传 |
|---|---|---|
| **I1** | 模特 | 上传任意人物正脸照（穿简单 T 恤） |
| **I2** | 服装 A | 上传任意服装图 |
| **I3** | 服装 B | 上传任意服装图 |
| **I4** | 服装 C | 上传任意服装图 |
| **I5** | 服装 D | 上传任意服装图 |

**关键**：每张图在侧栏 chip 上要看到 `@I1`、`@I2`...`@I5` 标识。

## 步骤 3: 发送 Production Oral

```
@I1 这个是模特， @I2  @I3  @I4  @I5 这几个是服装，请帮我设计一套模特换装工作流方案，含一键生图生视频
```

## 步骤 4: 验证清单

### ✅ B1: image-src-* 节点必须有 `localRefs[].url`

- 等待 Agent 回复，看 preview 摘要
- 在 DevTools Network 看 SSE `done` envelope 是否含 `executionTrace` 字段
- 检查画布上的 source 节点（I1/I2-I5）`localRefs` 数组是否有 `url` 非空

### ✅ B2: 绑定源仅两条，禁止扫画布

- 观察 Agent 回复，确认只用了侧栏 5 张图（不引入其他）
- DevTools Network：看 `preview_composition` 请求 body 的 `attachments` 字段是否包含 I1-I5

### ✅ B3: bind-fail 时正确 copy

**测试 1**（移除 I3 后重发）：
```
1. 删除侧栏 I3 那张图
2. 重发 production oral
3. Agent 应该返回：「参考图还没挂到构图上。请确认侧栏 @I1 起仍在本轮，或先把图加入 Agent 引用。」
4. **不应**出现「请确认是否把构图落到画布」
5. 画布不应有任何新增节点（空写集）
```

### ✅ B5: 同 slotKey 替换

```
1. 第一次 confirm 后，画布应有 I0 (白底三视图)、P、V、A/B 节点
2. 删掉侧栏 I3，重新加一张新图作 I3
3. 重发 production oral
4. 第二次 confirm → **应该替换**（删旧的 A/B 节点，再 import 新的）
5. **不应**叠加（不应有两套 A/B）
```

### ✅ B7-B8: 路由不变

- L0 路由：应为 `composition_structure`
- **不应**走 `sidebar_img2img` / `product_visual_intent`
- **不应** instantiate `i2v` 模板
- **不应** mandatory propose

### ✅ B9: gold-1 补全 G4

- 测试用例 production oral 完整带 I1-I5
- preview/confirm 应都正常返回（不报错）
- **不应**出现"无 attachments 仍出确认句"的情况

### ✅ AC-JT-03: done summary 含交付数

- 整流程跑完后，检查 Trace UI 第 9 步
- summary 应包含类似「已交付 N 张定稿」的文本（如果有出图）

### ✅ executionTrace 持久化（Issue #1）

- 完成后刷新页面
- Trace UI「操作明细」section 应能展开（之前是丢失的）
- 历史对话列表点击旧 session，Trace 也应能展开

---

## 步骤 5: 失败时回滚

如果 B1-B9 任一失败：
```bash
# 1. 在 main 上 revert PR #365 + #366 + #367
gh pr create --base main --head revert/journey-trace-revert --title "revert: B1-B9 + journey trace" --body "revert due to gold test failure"
# 2. 自动部署 revert 版本
# 3. 重新评估
```

## 步骤 6: 通过后

```bash
# 1. 更新 task-7-report.md + task-8-report.md 标记通过
# 2. 在 PR #364 评论 + Resolution: production gold passed
# 3. 关闭 milestone「production p0 fix」
```
