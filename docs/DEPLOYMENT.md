# lnkpi 部署指南

> **架构**：Vercel 托管前端（`apps/web`）+ 腾讯云 CVM 托管 API（`apps/server`），与 pintuotuo / aimarket 同机隔离部署。

## 1. 架构概览

```text
GitHub (main)
├── CI (.github/workflows/ci.yml)     → pnpm build + Docker build 验证
├── Deploy (.github/workflows/deploy.yml) → TCR 镜像 + SSH /opt/lnkpi
└── Vercel Git Integration            → apps/web Preview / Production

腾讯云 CVM
├── pintuotuo   :8080
├── aimarket    :3100 / :4100   (/opt/aimarket)
└── lnkpi-api   :5100           (/opt/lnkpi)
```

| 组件 | 位置 | 说明 |
|------|------|------|
| 前端 | Vercel | Root Directory = `apps/web` |
| API | Docker `lnkpi-api` | 宿主机 `5100` → 容器 `3001` |
| 数据库 | SQLite volume | `lnkpi-data` |
| 上传 | Docker volume | `lnkpi-uploads` |

---

## 2. 一次性：服务器初始化

SSH 到腾讯云 CVM 后，在本机仓库根目录执行：

```bash
bash deploy/bootstrap-server.sh /opt/lnkpi
```

或手动：

```bash
sudo mkdir -p /opt/lnkpi/deploy
sudo cp deploy/* /opt/lnkpi/deploy/
sudo cp deploy/.env.production.example /opt/lnkpi/.env
# 编辑 JWT_SECRET、CORS_ORIGIN、API_PUBLIC_URL
sudo nano /opt/lnkpi/.env
```

**`.env` 关键项**（`/opt/lnkpi/.env`）：

```bash
CORS_ORIGIN=http://localhost:5173,https://*.vercel.app,https://your-app.vercel.app
JWT_SECRET=<随机长字符串>
API_PUBLIC_URL=http://<服务器IP>:5100
```

确认端口未冲突：

```bash
ss -tlnp | grep -E '5100|4100|8080'
docker ps
```

---

## 3. GitHub Secrets / Variables

在 GitHub 仓库 **Settings → Environments → production** 配置（可与 aimarket 复用同机密钥）：

| 名称 | 说明 |
|------|------|
| `TENCENT_CLOUD_IP` | 腾讯云公网 IP |
| `TENCENT_CLOUD_USER` | SSH 用户（如 `ubuntu`） |
| `TENCENT_CLOUD_SSH_KEY` | SSH 私钥 |
| `TCR_USERNAME` | 腾讯云 TCR 用户名 |
| `TCR_PASSWORD` | 腾讯云 TCR 密码 |

可选 Variables：

| 名称 | 默认 |
|------|------|
| `TCR_REGISTRY` | `ccr.ccs.tencentyun.com` |
| `TCR_NAMESPACE` | `lnkpi`（需在 TCR 控制台创建命名空间） |

---

## 4. Vercel 前端

1. [vercel.com](https://vercel.com) 导入 GitHub 仓库
2. **Root Directory**：`apps/web`
3. **Environment Variables**（Production + Preview）：

```bash
VITE_API_BASE_URL=http://<服务器IP>:5100/api
```

4. 部署完成后，将 Vercel 域名加入服务器 `.env` 的 `CORS_ORIGIN`

本地 `apps/web/vercel.json` 已配置 monorepo 构建命令；Vite 环境变量见 `apps/web/src/vite-env.d.ts`。

---

## 5. CI / CD 流程

### CI（每个 PR / push）

```bash
pnpm install --frozen-lockfile
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm --filter @lnkpi/agent test
# + Docker build 验证（不 push）
```

### CD（push `main`）

1. 构建 `lnkpi-api` 镜像 push 到 TCR
2. SSH 同步 `deploy/` 到 `/opt/lnkpi`
3. `deploy/deploy-remote.sh` pull + up
4. 探测 `http://<IP>:5100/api/health`

手动触发：**Actions → Deploy API to Tencent Cloud → Run workflow**

---

## 6. 本地 Docker 调试

```bash
cp deploy/.env.production.example .env
# 编辑 .env
docker compose -f deploy/docker-compose.prod.yml up -d --build
curl http://127.0.0.1:5100/api/health
```

---

## 7. 冒烟清单

- [ ] `GET /api/health` → `{ ok: true }`
- [ ] Vercel 打开画布页无白屏
- [ ] 登录 / 发送验证码（或 mock）
- [ ] 画布保存 session
- [ ] mediaInput 上传 → URL 为 `/api/uploads/...`（经 API 域名访问）
- [ ] Agent 流式对话（SSE fetch 走 `VITE_API_BASE_URL`）

---

## 8. 常见问题

### CORS 错误

检查 `/opt/lnkpi/.env` 的 `CORS_ORIGIN` 是否包含完整 Vercel 域名；支持 `https://*.vercel.app` 通配。

### 上传文件 404

上传文件存于 Docker volume `lnkpi-uploads`；确保通过 API 公网地址访问 `/api/uploads/...`，不要期待 Vercel 静态托管这些文件。

### TCR pull 失败

确认 TCR 命名空间 `lnkpi` 已创建，且服务器已 `docker login ccr.ccs.tencentyun.com`。

### 与 aimarket 资源争用

三套栈独立网络；若内存不足，可为 `lnkpi-api` 在 compose 中加 `mem_limit`。

---

## 9. 后续升级

| 项 | 说明 |
|----|------|
| OSS/COS | 替换本地 `uploads/` volume |
| Postgres | 将 Prisma provider 改为 postgresql |
| 域名 + HTTPS | Nginx 反代 `api.lnkpi.xxx` → `:5100` |
| GHCR 镜像 | 可改用 GHCR 替代 TCR（改 deploy workflow tags） |

---

**相关文档**：[DOCK_STUDIO_E2E_TRACKING.md](./DOCK_STUDIO_E2E_TRACKING.md)
