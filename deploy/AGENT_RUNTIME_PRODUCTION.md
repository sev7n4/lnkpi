# Agent Runtime 生产部署 + 环境变量清单 + 画布人工验收

> 适用：腾讯云 CVM `/opt/lnkpi`（与现有 `lnkpi-api` 同机）。  
> 规格：`docs/superpowers/specs/2026-07-23-agent-runtime-langgraph-design.md`  
> 本地联调见：`services/agent-runtime/README.md`

---

## 0. 先搞清三件事

1. **Runtime 是第二个进程**（Python），不是画布前端，也不是「再配一个大模型 Key 的别名」。
2. **`AGENT_RUNTIME_*` / `LNKPI_NEST_*` 是服务互信与地址**，不等于 BYOK / 平台出图 Key。
3. **出图**仍走 Nest Studio（左栏 BYOK 或平台 Key）；**写方案的 LLM** 用 Runtime 的 `LNKPI_OPENAI_*`（一期未接左栏渠道）。

```
浏览器 → Nest(lnkpi-api:5100)
              ↕  token + URL
         Runtime(agent-runtime:8000，建议仅内网)
              → Nest internal tools → Studio 出图
```

---

## 1. 环境变量清单

### 1.1 Nest（`/opt/lnkpi/.env`，api 容器已 `env_file` 加载）

| 变量 | 必填 | 示例 | 含义 |
|------|------|------|------|
| `AGENT_RUNTIME_URL` | 要启用新 Agent 时必填 | Compose：`http://lnkpi-agent-runtime:8000`<br>systemd：`http://127.0.0.1:8000` | Nest 转发对话的 Runtime 根地址；**空或不健康 → 回退旧 CanvasAgent** |
| `AGENT_RUNTIME_SERVICE_TOKEN` | 启用时必填 | `openssl rand -hex 32` 生成的长串 | ① Nest 调 Runtime `POST /v1/runs` 的门禁<br>② Runtime 调 Nest `/api/agent/internal/*` 时，Nest 校验的门禁（同一把锁） |

> 生产复测若看到 `AGENT_RUNTIME_SERVICE_TOKEN is not configured`，说明 Nest 已上新代码但 **token 未写入 `.env` 并重启 api**。

### 1.2 Runtime（Compose 用 service `environment` / `env_file`；systemd 可写同一 `/opt/lnkpi/.env`）

| 变量 | 必填 | 示例 | 含义 |
|------|------|------|------|
| `LNKPI_NEST_BASE_URL` | 是 | Compose：`http://lnkpi-api:3001/api`<br>systemd：`http://127.0.0.1:5100/api` | Nest API 根路径，**必须含 `/api`** |
| `LNKPI_NEST_SERVICE_TOKEN` | 是 | **与** `AGENT_RUNTIME_SERVICE_TOKEN` **完全相同** | Runtime → Nest internal tools 请求头 `x-lnkpi-service-token` |
| `LNKPI_RUNTIME_AUTH_TOKEN` | 否 | 可省略 | Nest → Runtime 校验用；空则回退用 `LNKPI_NEST_SERVICE_TOKEN` |
| `LNKPI_OPENAI_API_KEY` | 建议填 | 平台文本模型 Key | **仅**供 Runtime 规划/拆解 LLM（一期不读左栏 BYOK） |
| `LNKPI_OPENAI_BASE_URL` | 否 | `https://api.openai.com/v1` 或兼容网关 | 规划 LLM 的 base |
| `LNKPI_OPENAI_CHAT_MODEL` | 否 | 默认 `gpt-4o`；可与 Nest `OPENAI_CHAT_MODEL` 相同 | 规划 LLM 模型名 |
| `LNKPI_SKILLS_DIR` | 否 | `/app/skills`（镜像内默认） | Skill 包目录 |
| `LNKPI_IMAGE_GEN_CONCURRENCY` | 否 | `3` | 编排出图并发上限 |
| `LNKPI_IMAGE_GEN_TIMEOUT_SEC` | 否 | `180` | 单图等待上限（秒） |

### 1.3 与「大模型 Key」对照（避免混）

| 用途 | 变量 / 来源 | 是否左栏 BYOK |
|------|-------------|---------------|
| 服务互信 | `AGENT_RUNTIME_*` / `LNKPI_NEST_*` | 否 |
| Agent **写方案** LLM | `LNKPI_OPENAI_API_KEY` | 否（一期） |
| Agent / Dock **出图** | Nest Studio → 平台 `OPENAI_*` 或用户渠道 BYOK | **是** |
| 旧 Agent 回退对话 | Nest `OPENAI_API_KEY` | 否 |

### 1.4 建议追加到 `/opt/lnkpi/.env` 的片段

```bash
# --- Agent Runtime（与 api 同机）---
AGENT_RUNTIME_SERVICE_TOKEN=请换成 openssl-rand-hex-32
# Compose 内网名（二选一，见 §2）:
AGENT_RUNTIME_URL=http://lnkpi-agent-runtime:8000
# systemd 本机:
# AGENT_RUNTIME_URL=http://127.0.0.1:8000

LNKPI_NEST_SERVICE_TOKEN=请与上面 AGENT_RUNTIME_SERVICE_TOKEN 相同
# Compose:
LNKPI_NEST_BASE_URL=http://lnkpi-api:3001/api
# systemd:
# LNKPI_NEST_BASE_URL=http://127.0.0.1:5100/api

LNKPI_OPENAI_API_KEY=
LNKPI_OPENAI_BASE_URL=https://api.openai.com/v1
LNKPI_IMAGE_GEN_CONCURRENCY=3
LNKPI_IMAGE_GEN_TIMEOUT_SEC=180
```

---

## 2. 方案 A：Docker Compose（推荐，与现有 api 同网络）

仓库已含：

- `deploy/docker/Dockerfile.agent-runtime`
- `deploy/docker-compose.prod.yml` 中的 `agent-runtime` 服务（**不映射公网端口**）

### 2.1 一次性准备

```bash
ssh root@<CVM>
cd /opt/lnkpi
# 拉取含 agent-runtime 的代码（或跟 deploy 同步源码）
git fetch && git checkout main && git pull

# 编辑 .env：写入 §1.4（Compose 用内网 URL）
nano /opt/lnkpi/.env
```

### 2.2 构建并启动

```bash
cd /opt/lnkpi
export IMAGE_TAG=$(git rev-parse --short HEAD)
export LNKPI_API_IMAGE=lnkpi-api:${IMAGE_TAG}

# 构建 Runtime 镜像
docker compose -f deploy/docker-compose.prod.yml build agent-runtime

# 启动（api 若已在跑，会读到新 env；建议 recreate）
docker compose -f deploy/docker-compose.prod.yml up -d --no-build api agent-runtime
# 若 api 也需重建：
# docker compose -f deploy/docker-compose.prod.yml up -d --build api agent-runtime
```

### 2.3 验收（机器上）

```bash
# Runtime 健康（容器内网；宿主机无公网映射时用 docker exec）
docker exec lnkpi-agent-runtime curl -fsS http://127.0.0.1:8000/health
# → {"ok":true,"service":"agent-runtime"}

# Nest 仍健康
curl -fsS http://127.0.0.1:5100/api/health

# 未配 token 时 internal 会 401；配好后无 token 仍应 401，带错 token 也 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:5100/api/agent/internal/get-canvas-summary \
  -H 'Content-Type: application/json' -d '{"sessionId":"x"}'
```

**安全：** 不要把 `8000` publish 到 `0.0.0.0`；仅 `lnkpi-net` 内访问。

---

## 3. 方案 B：systemd（宿主机 Python，不进 Docker）

适用：暂时不想改 api 镜像链路，只在本机起 Runtime。

```bash
# 代码与依赖
cd /opt/lnkpi
git pull
cd services/agent-runtime
python3.11 -m venv .venv
. .venv/bin/activate
pip install -e .

# .env 使用 systemd 行：AGENT_RUNTIME_URL=http://127.0.0.1:8000
#                 LNKPI_NEST_BASE_URL=http://127.0.0.1:5100/api

# 安装 unit（按实际 venv 路径改 ExecStart）
cp /opt/lnkpi/deploy/systemd/lnkpi-agent-runtime.service /etc/systemd/system/
# 建议把 ExecStart 改成：
# ExecStart=/opt/lnkpi/services/agent-runtime/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

systemctl daemon-reload
systemctl enable --now lnkpi-agent-runtime
systemctl status lnkpi-agent-runtime
curl -fsS http://127.0.0.1:8000/health

# 重启 api 容器以加载 AGENT_RUNTIME_URL
cd /opt/lnkpi && docker compose -f deploy/docker-compose.prod.yml up -d --force-recreate --no-build api
```

---

## 4. 部署后快速自检（运维）

| # | 检查 | 期望 |
|---|------|------|
| 1 | `curl …/api/health` | Nest `ok` |
| 2 | Runtime `…/health` | `service: agent-runtime` |
| 3 | `.env` 两 token 一致 | `AGENT_RUNTIME_SERVICE_TOKEN` = `LNKPI_NEST_SERVICE_TOKEN` |
| 4 | Nest 日志 / 行为 | 配置 `AGENT_RUNTIME_URL` 且健康时，对话走 Runtime；否则旧 Agent |
| 5 | 无公网 8000 | `ss -lntp \| grep 8000` 仅 127.0.0.1 或无宿主机监听 |

> 说明：当前 GitHub `deploy.yml` 的 path 过滤**不含** `services/agent-runtime/**`；合并后不会自动构建 Runtime。上线 Runtime 可用：
>
> ```bash
> # GitHub → Actions → Deploy API to Tencent Cloud → Run workflow
> # enable_agent_runtime = true（会 sync 源码 + 写 .env token + compose build/up Runtime + recreate api）
> ```
>
> 或在 CVM 手工执行 `bash /opt/lnkpi/deploy/enable-agent-runtime.sh`（见 `deploy/enable-agent-runtime.sh`）。

---

## 5. 登录后画布侧人工验收 Checklist

前置：§2 或 §3 已完成；前端指向生产 API（`VITE_API_BASE_URL` / 现有配置）；准备好出图可用的平台 Key 或左栏 BYOK。

### 5.1 登录与会话

- [ ] 能登录（验证码 / 固定码按环境）
- [ ] 新建或打开一个**空白/干净**画布会话
- [ ] 打开画布内 Agent 对话侧栏

### 5.2 规划阶段（洁具营销）

- [ ] 输入：`帮我设计一套卫生洁具的营销方案。`
- [ ] 对话中出现可评审的方案摘要/正文
- [ ] 画布出现 **prompt 方案节点**（可标为 T1），内容为方案长文（或对话摘要 + 节点全文）
- [ ] Agent **征询确认**（未确认前不应批量出图）

### 5.3 修改（revise）

- [ ] 回复：`改成更偏天猫详情页`
- [ ] **同一**方案节点被更新（不是又新建一个无关方案节点）
- [ ] 仍停在确认前，未自动出图

### 5.4 确认 → 拆骨架

- [ ] 回复：`确认，按这个拆并出图`（或「确认」）
- [ ] 出现下游节点：至少含 **白底图 / 主图** 等 image（及可选 text）；video 若有仅为骨架
- [ ] 方案节点到下游有**连线**
- [ ] 下游 Dock 可见 **prompt** 与**上游 Ref 芯片**

### 5.5 自动出图

- [ ] 白底等 t2i 节点进入生成中 → 完成后有 **url / 缩略图**
- [ ] 依赖白底的主图（i2i）在白底成功后生成，且有图
- [ ] 至少 **2** 张图成功回写（建议白底 + 主图）
- [ ] 出图计费/渠道：与左栏所选模型/BYOK 或平台 Key 行为一致（失败有明确错误，非静默）

### 5.6 失败与回退（可选但推荐）

- [ ] 人为让某一节点缺 prompt / 断 Key：对话中有失败/跳过说明，其它无依赖节点仍可成功
- [ ] 临时停 Runtime 或清空 `AGENT_RUNTIME_URL` 并重启 api：对话仍可用（旧 Agent 回退），行为与「新 Runtime」可区分

### 5.7 非目标（一期不要当成 bug）

- [ ] 视频节点**不**自动出片（可有骨架）
- [ ] 仅改上游 Ref **不会**静默级联重跑下游（只有确认后的编排会出图）

---

## 6. 常见问题

| 现象 | 排查 |
|------|------|
| 一直像旧 Agent，不落方案节点 | `AGENT_RUNTIME_URL` 未设 / Runtime 未起 / health 失败 |
| internal 401 `TOKEN is not configured` | Nest `.env` 缺 `AGENT_RUNTIME_SERVICE_TOKEN`，改后 recreate api |
| Runtime 调 Nest 403/401 | token 两边不一致，或 `LNKPI_NEST_BASE_URL` 少了 `/api` |
| 有方案节点但不出图 | Studio / BYOK / 积分；看节点 `errorMessage` 与 Nest 日志 |
| 方案文案很差或 placeholder | `LNKPI_OPENAI_API_KEY` 未配（规划 LLM），与出图 Key 无关 |

---

## 7. 相关文件

| 路径 | 用途 |
|------|------|
| `deploy/docker/Dockerfile.agent-runtime` | Runtime 镜像 |
| `deploy/docker-compose.prod.yml` | `api` + `agent-runtime` |
| `deploy/systemd/lnkpi-agent-runtime.service` | systemd 单元模板 |
| `deploy/.env.production.example` | 生产 env 示例（含 Runtime 段） |
| `services/agent-runtime/README.md` | 本地双进程开发 |
