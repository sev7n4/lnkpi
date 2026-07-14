---
name: mydev-github-workflow
description: >-
  Automates GitHub development workflow with CI monitoring, branch lifecycle,
  local validation, and PR creation. Use when creating branches, commits, or PRs
  for lnkpi features/fixes. Inherited from pintuotuo project workflow.
---

# MyDev GitHub Workflow (lnkpi)

继承自 pintuotuo `.cursor/skills/mydev-github-workflow/`，针对本 monorepo 适配。

## 硬约束

```
[1] 禁止直接 push 到 main — 必须走 feature 分支 + PR
[2] 禁止跳过本地验证 — 提交前必须 pnpm build 通过
[3] PR 创建后监控 CI（.github/workflows/ci.yml）全绿再合并
[4] 合并使用 Squash & Merge
```

## 分支命名

`{type}/{short-description}`

- type: `feature` | `fix` | `enhancement`
- 示例: `feature/scene-composer-d1-d4`

## 本地验证 (Step 8)

```bash
pnpm install --frozen-lockfile
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm --filter @lnkpi/agent test
```

## 提交与 PR (Step 9)

```bash
git checkout main && git pull origin main
git checkout -b feature/your-feature

# 仅 stage 本 PR 相关文件，勿 git add -A 混入无关改动
git add <files...>
git commit -m "feat: your description"

git push -u origin HEAD
gh pr create --base main --title "feat: ..." --body "$(cat <<'EOF'
## Summary
- ...

## Test plan
- [ ] pnpm build
- [ ] ...

EOF
)"
```

## CI 监控 (Step 10)

```bash
gh run list --branch=$(git branch --show-current) --limit 5
gh run watch
```

## 合并 (Step 12)

```bash
gh pr merge <number> --squash --delete-branch
```

合并后 `deploy.yml` 会自动部署 API 到腾讯云；Vercel 前端随 main push 自动部署。
