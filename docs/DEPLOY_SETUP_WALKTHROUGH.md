# lnkpi 部署上手（零基础逐步操作）

> 你的服务器 IP：**119.29.173.89**（与 aimarket / pintuotuo 同机）  
> lnkpi API 端口：**5100**（aimarket 4100，pintuotuo 8080）

---

## 当前进度

| 步骤 | 状态 | 说明 |
|------|------|------|
| 3. 服务器 `/opt/lnkpi` 初始化 | ✅ 已完成 | 已通过 SSH 创建目录和 `.env` |
| 1. TCR 命名空间 `lnkpi` | ⏳ 需你扫码登录 | 见下方步骤 1 |
| 2. GitHub Secrets | ⏳ 需你网页操作 | 复用 aimarket 同款密钥，见步骤 2 |
| 4. Vercel 导入 | ⏳ 需你登录 Vercel | 见步骤 4 |

---

## 步骤 1：腾讯云 TCR 创建命名空间 `lnkpi`（约 5 分钟）

aimarket 已经开过 TCR，**只需再加一个命名空间**，密码和账号 ID 复用即可。

1. 打开 [容器镜像服务控制台](https://console.cloud.tencent.com/tcr)
2. **微信扫码登录**（与 aimarket 部署时相同账号）
3. 左侧点 **实例管理**
4. 左上角地域选 **广州**（个人版只在这里显示）
5. 若从未设过密码：点个人版卡片 → **初始化密码**（与 aimarket 用的是同一个密码）
6. 左侧 **命名空间** → 顶部实例类型选 **个人版实例**
7. 点 **新建**：
   - 名称：`lnkpi`
   - 访问级别：私有
8. 记下登录信息（与 aimarket 相同）：
   - Registry：`ccr.ccs.tencentyun.com`
   - Username：腾讯云 **账号 ID**（纯数字，在「登录实例」里可见）

**不需要**手动创建 `lnkpi-api` 仓库，首次 GitHub 部署 push 时会自动创建。

---

## 步骤 2：GitHub Secrets（复用 aimarket，约 5 分钟）

### 2.1 创建 production 环境

1. 打开 https://github.com/sev7n4/lnkpi/settings/environments
2. 点 **New environment** → 名称填 **`production`** → **Configure environment**

### 2.2 添加 Secrets

在 **Environment secrets** 里逐个 **Add secret**（**值从 aimarket 复制**，名称相同）：

| Secret 名称 | 值从哪里找 |
|-------------|-----------|
| `TENCENT_CLOUD_IP` | `119.29.173.89` |
| `TENCENT_CLOUD_USER` | `root` |
| `TENCENT_CLOUD_SSH_KEY` | 本机文件 `~/.ssh/tencent_cloud_deploy` 的**完整内容** |
| `TCR_USERNAME` | 腾讯云账号 ID（与 aimarket 的 TCR_USERNAME 相同） |
| `TCR_PASSWORD` | TCR 个人版固定密码（与 aimarket 相同） |

查看 aimarket 已配置了哪些：https://github.com/sev7n4/aimarket/settings/environments

> GitHub **不能查看**已有 secret 明文，若忘记 TCR 密码：腾讯云 TCR 控制台 → 个人版 → **重置登录密码**。

### 2.3 添加 Repository Variable

1. 打开 https://github.com/sev7n4/lnkpi/settings/variables/actions
2. **New repository variable**：
   - Name: `TCR_NAMESPACE` → Value: `lnkpi`

---

## 步骤 3：服务器初始化 ✅（已代你完成）

已在服务器执行：

- 目录：`/opt/lnkpi/deploy/`
- 配置：`/opt/lnkpi/.env`（JWT 已随机生成）
- 端口 5100 空闲

你可在本机验证 SSH：

```bash
ssh -i ~/.ssh/tencent_cloud_deploy root@119.29.173.89 "ls -la /opt/lnkpi"
```

---

## 步骤 4：Vercel 导入前端（约 10 分钟）

### 4.1 先把代码 push 到 GitHub

在本机 lnkpi 目录（若尚未 push 部署相关文件）：

```bash
cd ~/workspace/lnkpi
git add .
git commit -m "feat: CI/CD and deployment infrastructure"
git push origin main
```

### 4.2 在 Vercel 导入

1. 打开 https://vercel.com/new
2. 用 **GitHub 账号登录**（授权访问 `sev7n4/lnkpi`）
3. 在列表里选 **`lnkpi`** → **Import**
4. **Configure Project** 重要设置：

| 配置项 | 填什么 |
|--------|--------|
| Framework Preset | Vite（应自动识别） |
| Root Directory | 点 Edit → 选 **`apps/web`** |
| Build Command | 留空（用 `apps/web/vercel.json` 里的） |
| Output Directory | 留空（默认 `dist`） |

5. **Environment Variables** 添加：

| Name | Value |
|------|-------|
| `VITE_API_BASE_URL` | `http://119.29.173.89:5100/api` |

Production 和 Preview 都勾选。

6. 点 **Deploy**，等待构建完成，得到类似 `https://lnkpi-xxx.vercel.app` 的地址。

### 4.3 更新服务器 CORS

部署成功后，SSH 到服务器编辑 CORS（把 Vercel 域名加进去）：

```bash
ssh -i ~/.ssh/tencent_cloud_deploy root@119.29.173.89
nano /opt/lnkpi/.env
```

把 `CORS_ORIGIN` 改成（换成你的真实 Vercel 域名）：

```bash
CORS_ORIGIN=http://localhost:5173,https://*.vercel.app,https://lnkpi-xxx.vercel.app
```

保存后（API 容器跑起来后）重启：

```bash
cd /opt/lnkpi
docker compose -f deploy/docker-compose.prod.yml restart api
```

---

## 步骤 5：触发 API 部署

Secrets 配好后：

1. 打开 https://github.com/sev7n4/lnkpi/actions/workflows/deploy.yml
2. 点 **Run workflow** → Branch `main` → **Run workflow**
3. 等待绿色 ✅
4. 验证：

```bash
curl http://119.29.173.89:5100/api/health
# 期望: {"ok":true,"service":"lnkpi-api",...}
```

---

## 步骤 6：端到端验证

1. 浏览器打开 Vercel 给的 URL
2. 登录 / 创建画布
3. 拖入图片 → Dock 上传 → 预览正常

---

## 一键辅助脚本（本机）

```bash
# 查看 GitHub Secrets 配置指引
bash deploy/setup-github-secrets.sh

# 重新同步 deploy 文件到服务器
scp -i ~/.ssh/tencent_cloud_deploy -r deploy/* root@119.29.173.89:/opt/lnkpi/deploy/
```

---

## 遇到问题？

| 现象 | 处理 |
|------|------|
| Deploy 报 Missing TCR_* | Secret 必须加在 **Environment production**，不是 Repository secrets |
| Vercel 页面空白 / API 报错 | 检查 `VITE_API_BASE_URL` 是否含 `/api` 后缀 |
| CORS 错误 | 更新 `/opt/lnkpi/.env` 的 `CORS_ORIGIN` 并重启 api 容器 |
| pull 镜像 401 | TCR 密码错误或 Username 不是账号 ID |

详细说明见 [DEPLOYMENT.md](./DEPLOYMENT.md)。
