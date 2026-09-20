# lnkpi 域名 + HTTPS 证书方案

> 日期：2026-09-20
> 状态：待决策（决策点见 §8）
> 关联：PR #374（Vercel 代理上游 5100→8888）、PR #380（仓库卫生收尾）

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| `lnkpi-web.vercel.app` 国内能直接访问吗？ | **不能。**`*.vercel.app` 被 DNS 污染，Vercel 官方承认大陆无节点。只有走境外代理/VPN 才通 |
| 换个自有域名指向 Vercel 能救吗？ | 能改善，**但只是缓解**：延迟降到 50-100ms 级、稳定性无保证。Vercel 自己也说"不保证大陆可用性" |
| 真正根治要什么？ | **自有域名 + ICP 备案 + CVM 自托管 HTTPS**（域名解析到大陆 IP 必须备案，否则 80/443 被阻断） |
| 备案要多久？ | 腾讯云初审 1-2 工作日 → 短信核验（24h 内）→ 管局 1-20 工作日（**实际 7-15 天**） |
| 证书怎么选？ | 腾讯云免费 DV 证书**只有 90 天且不支持续费**，需人工轮换；**推荐 acme.sh + Let's Encrypt 自动续期**（DNS-01，绕开被占用的 80 端口） |
| 最短多久拿到可用 HTTPS？ | **当天**（走 §5.2 过渡方案，免备案）；**根治约 2-3 周**（含备案） |

---

## 1. 当前真实状态（本次实测）

### 1.1 CVM `119.29.173.89`

| 端口 | 状态 | 说明 |
|---|---|---|
| 22 | OPEN | SSH |
| **80** | **OPEN，已被占用** | `nginx/1.31.3`，返回 476B 占位页（Last-Modified 2026-08-06）——**是别的项目** |
| **443** | **TCP 有监听，但 TLS 握手失败** | `SSL_ERROR_SYSCALL`，需上机确认是谁在听、是否残留配置 |
| 8888 | OPEN | lnkpi 前端 nginx（`deploy/nginx.conf`），响应 28ms |
| 5100 | OPEN | lnkpi API |

### 1.2 服务链路（现状）

```
浏览器 ──HTTPS──> Vercel Edge ──HTTP──> 119.29.173.89:8888 (nginx) ──> :5100 (API)
                        └── 静态资源由 Vercel 托管
浏览器 ──HTTP──> 119.29.173.89:8888 (明文直连，仅内网/白名单可用)
```

**问题**：前端入口完全依赖 Vercel，而 Vercel 在国内不可达 → 国内用户拿不到入口。

---

## 2. ⚠️ 确认：`lnkpi-web.vercel.app` 只有境外/VPN 通道才可用

**是的，你的判断正确。** 这不是配置问题，是网络层问题。

### 2.1 证据一：本机测量被代理接管（反证）

在本机实测时发现：

```
$ curl https://lnkpi-web.vercel.app/
code=200  ...  ip=127.0.0.1

$ dig lnkpi-web.vercel.app
198.18.0.70          <-- RFC2544 保留段，fake-IP 代理特征
```

- `198.18.0.0/15` 是基准测试保留网段，正常 DNS 绝不会返回它——这是代理工具 **fake-IP 模式**的指纹
- 连 `baidu.com` 的 `remote_ip` 也是 `127.0.0.1`，说明**本机所有流量都走本地代理**
- 因此"本机能打开"这件事**恰恰证明了它是靠代理通的**，不能作为国内可达性的证据

### 2.2 证据二：权威结论

- Vercel Knowledge Base 原文：
  > "Vercel does not have servers or CDN nodes in mainland China and cannot guarantee availability or performance within mainland China."
- `*.vercel.app` 默认域名被 GFW **DNS 污染**，大陆直接超时或跳反诈页
- Vercel 在大陆**没有任何边缘节点**，最近的是中国香港/日本/新加坡

### 2.3 补充结论

- 把自定义域名指向 Vercel（CNAME）**可以绕过 DNS 污染**，延迟降到 50-100ms 级——但 Vercel 官方明确"不保证稳定性"，且联通/电信/移动表现不一致，中继 IP 还会周期性刷新
- **Vercel Hobby（免费）计划 ToS 明确禁止商业用途**，商用必须上 Pro（$20/席/月）
- 所以 Vercel 的定位应该是：**CI/CD 与预览环境**，而不是国内生产入口

---

## 3. 三条路线对比

| 维度 | **A. 域名 → Vercel** | **B. 域名 → CVM 自托管**（推荐主线） | **C. 域名 → EdgeOne → CVM** |
|---|---|---|---|
| 需要 ICP 备案 | ❌ 不需要 | ✅ 必须 | ✅ 必须 |
| 上线耗时 | **当天** | **2-3 周** | 备案后再 +1-2 天 |
| 国内延迟 | 50-100ms，抖动大 | 取决于 CVM 带宽，稳定 | 最优（CDN 边缘） |
| 稳定性 | 无 SLA，可能被间歇性阻断 | 可控 | 高（有防护 + 多节点） |
| 证书 | Vercel 自动签发/续期，零运维 | 需自建（acme.sh 可自动化） | EdgeOne 自动签发/续期 |
| 额外成本 | Vercel Pro ~$20/月 | 证书免费 | EdgeOne 免费版可用 |
| 主要风险 | 随时可能整体不可用 | 80 端口已被占用，需协调 | 备案门槛同上 |
| 定位 | **过渡/预览** | **生产正解** | 规模化后演进 |

**建议：A 作为立即止血的过渡入口，B 作为生产主线，C 作为后续演进。**

---

## 4. 推荐执行顺序

```
Day 0    ┌─ 注册域名 + 实名认证（实名需满 3 天才能备案）
         └─ 【过渡】域名 CNAME → Vercel，当天拿到可用的 HTTPS 入口
Day 3    └─ 提交 ICP 备案（域名实名满 3 天后）
Day 3-18 └─ 管局审核期，并行完成：CVM 443 清理、nginx 配置、acme.sh 部署、验收脚本
Day 18+  └─ 【切换】域名 A 记录 → CVM，HTTPS 生效，Vercel 降级为预览环境
```

---

## 5. 详细步骤

### 5.1 阶段一：注册域名 + 实名认证

**在哪注册**：腾讯云（DNSPod）。理由：备案同平台，解析/备案/证书一条链，少一次跨平台认证。

| 后缀 | 腾讯云参考价（2026-09） | 备注 |
|---|---|---|
| `.com` | ¥83/首年，续费约 ¥90/年 | 商用首选 |
| `.cn` | ¥33/首年，续费约 ¥40-80/年 | 需实名，国内适配好 |

> 价格为官网参考值，以购买页为准。注册时**务必勾选自动续费**——国内用户因忘续费掉域名的比例约 18%。

**步骤：**

1. 腾讯云控制台 → 域名注册 → 搜索可用域名 → 购买（建议一次买 3-5 年）
2. 立即做**域名实名认证**：控制台上传身份证/营业执照，**审核 1-3 个工作日**
   - ⚠️ 实名主体必须与后续备案主体**完全一致**，否则备案必被驳回
   - ⚠️ 备案要求**实名认证成功满 3 个自然日**，所以这一步越早越好
3. 确认域名后缀在**工信部可备案名单**内（`.com` `.cn` `.net` 均可；`.xyz`/`.icu` 等部分后缀不可备案，**不要图便宜选错**）

---

### 5.2 阶段二-A：过渡入口（免备案，当天可用）

**目标**：当天拿到一个不依赖"翻墙"的 HTTPS 地址，先让国内同事能点开。

1. Vercel Dashboard → 项目 `lnkpi-web` → **Settings → Domains** → 添加 `app.<yourdomain>.com`
2. Vercel 会给出需要配置的 DNS 记录，**以控制台实际显示为准**。常见形式：
   - 标准：`CNAME app → cname.vercel-dns.com`（**灰云直连，先别开 Cloudflare 橙云代理**，会干扰 Vercel 域名校验）
   - 大陆优化：部分资料提到 `cname-china.vercel-dns.com` 或社区中继方案（如 enhanced-FaaS-in-China），**能降延迟但不保证稳定，且中继 IP 会周期性刷新**
3. 到腾讯云 DNSPod 添加对应 CNAME 记录
4. 等 Vercel Domains 页面出现**两个绿色勾**（域名校验 + 证书签发通过）
5. 证书：**Vercel 自动用 Let's Encrypt 签发并自动续期，无需你做任何运维**
6. 验收：

```bash
curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" https://app.<yourdomain>.com/
curl -sS https://app.<yourdomain>.com/api/health
```

> ⚠️ **务必先合并 PR #374**（Vercel 代理上游 5100→8888）。当前 `api/proxy.ts` 默认指向 `:5100`，而 Vercel Edge → 5100 是 8s 超时的。不合并的话自定义域名会"首页能开、接口全挂"。

---

### 5.3 阶段二-B：ICP 备案（生产主线的前置硬门槛）

**为什么必须**：服务器在大陆，域名解析到大陆 IP 提供网站服务，**强制要求 ICP 备案**。未备案域名会被云厂商监测系统识别并**阻断 80/443**。

**备案前必须满足：**

- [ ] 域名已完成实名认证，**且满 3 个自然日**
- [ ] 域名持有者 = 备案主体（个人用身份证姓名 / 企业用营业执照全称）
- [ ] CVM 剩余时长 **≥ 3 个月**（腾讯云备案服务码有此要求）
- [ ] ⚠️ **网站备案期间，该域名不要保留指向境外的解析**（部分管局会校验，会导致驳回）

**流程：**

| 步骤 | 内容 | 耗时 |
|---|---|---|
| 1 | 腾讯云控制台 → ICP 备案 → 新增备案，填主体信息 + 网站信息 | — |
| 2 | 2026 年起启用**小程序端人脸活体核验**（约 3 分钟） | — |
| 3 | 腾讯云初审（含**电话回访**：会问网站用途、名称与内容是否一致） | 1-2 工作日 |
| 4 | 工信部**短信核验**——收到验证码后**必须 24 小时内**到工信部备案系统验证，超时自动驳回 | 24h 内 |
| 5 | 管局终审（各省差异大：北京/上海 10-15 天，广东/浙江 7-10 天，四川/陕西 4-7 天） | 1-20 工作日 |
| 6 | 通过后拿到备案号，**须在网站页脚展示并链接** `https://beian.miit.gov.cn` | — |
| 7 | ⚠️ **ICP 通过后 30 日内完成公安联网备案**，否则可能被关停 | — |

**高频驳回原因（提前规避）：**

1. 网站名称含「中国」「中华」「国家」等受限词
2. 主体证件姓名 ≠ 域名实名认证的持有人姓名
3. 个人主体选了「电子商务」「在线交易」等经营性内容（个人备案禁止商业用途）

> 若为企业商用 → 走**企业备案**，需营业执照 + 法人身份证 + 网站负责人授权书。

---

### 5.4 阶段三：CVM 443 + nginx + 证书

**前置：先查清 80/443 到底是谁在听**

```bash
ssh root@119.29.173.89
ss -tlnp | grep -E ':(80|443)\b'
nginx -T 2>/dev/null | grep -E 'server_name|listen'
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '80|443'
```

当前已知：**80 被另一个项目的 nginx 占用**，443 有监听但 TLS 不工作。三种处理方式：

| 方式 | 做法 | 评价 |
|---|---|---|
| **复用现有 nginx** | 在占用 80 的那个 nginx 里加一个 `server_name lnkpi.<domain>` 的 vhost，专供 lnkpi | ✅ 推荐，不动别人 |
| 让 nginx 统一入口 | 用这个 nginx 做 80/443 总入口，按 `server_name` 分流到 lnkpi 与老项目 | 需与老项目负责人协调 |
| lnkpi 独占 443 | lnkpi 容器自己 listen 443 | 需先确认 443 现状，避免端口冲突 |

**证书方案对比：**

| 方案 | 有效期 | 续期 | 通配符 | 评价 |
|---|---|---|---|---|
| 腾讯云免费 DV | **90 天** | **不支持续费**，到期需重新申请替换 | ❌ | 官方定位"前期测试用"，**正式项目不推荐** |
| **acme.sh + Let's Encrypt** | 90 天 | **全自动** | ✅（DNS-01） | ✅ **推荐** |
| 付费 DV | 1 年 | 手动 | ✅ | 有 SLA，约 ¥100-300/年 |

**为什么用 DNS-01 而不是 HTTP-01**：80 端口被别的项目占用，HTTP-01 验证需占用 `/.well-known/acme-challenge/`，容易冲突。DNS-01 只需在 DNSPod 加一条 TXT，更干净。

**部署 acme.sh（推荐）：**

```bash
# 1. 安装（指定 Let's Encrypt，避免默认走 ZeroSSL）
curl https://get.acme.sh | sh -s email=you@example.com
~/.acme.sh/acme.sh --set-default-ca --server letsencrypt

# 2. 配置 DNSPod API 凭证（在 DNSPod 控制台「API 密钥」申请）
export DP_Id="<your-dnspod-id>"
export DP_Key="<your-dnspod-token>"

# 3. 签发（DNS-01）
~/.acme.sh/acme.sh --issue --dns dns_dp -d lnkpi.<yourdomain>.com

# 4. 安装到 nginx 路径并配置自动重载
mkdir -p /etc/nginx/ssl
~/.acme.sh/acme.sh --install-cert -d lnkpi.<yourdomain>.com \
  --key-file       /etc/nginx/ssl/lnkpi.key \
  --fullchain-file /etc/nginx/ssl/lnkpi.crt \
  --reloadcmd      "nginx -s reload"
```

acme.sh 会注册 cron，**每 60 天自动续期一次**，零人工介入。

**nginx 443 配置**（在现有 `deploy/nginx.conf` 基础上扩展，复用静态 + `/api/` 反代逻辑）：

```nginx
# HTTP 强制跳转 HTTPS（若 80 端口可用）
server {
    listen 80;
    server_name lnkpi.<yourdomain>.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name lnkpi.<yourdomain>.com;

    ssl_certificate     /etc/nginx/ssl/lnkpi.crt;
    ssl_certificate_key /etc/nginx/ssl/lnkpi.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;

    root /opt/lnkpi/web/dist;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;

    location /api/ {
        client_max_body_size 50m;
        proxy_pass http://127.0.0.1:5100/api/;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

> ⚠️ `try_files $uri $uri/ /index.html` 是**之前 500 事故的元凶链**——`root` 目录不存在时会自指成死循环。上线前务必确认 `/opt/lnkpi/web/dist` 存在且非空。建议加一道自检：
> ```bash
> [ -s /opt/lnkpi/web/dist/index.html ] || { echo "dist 缺失，终止"; exit 1; }
> ```

**DNS 切换**：备案通过后，把 `lnkpi.<yourdomain>.com` 的 `A` 记录指向 `119.29.173.89`，删除指向 Vercel 的 CNAME。

---

### 5.5 阶段四：验收

```bash
# 1. HTTP 跳转
curl -sSI http://lnkpi.<yourdomain>.com/ | head -1        # 期望 301

# 2. HTTPS 首页
curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" https://lnkpi.<yourdomain>.com/

# 3. API 健康检查
curl -sS https://lnkpi.<yourdomain>.com/api/health

# 4. 证书链与有效期
echo | openssl s_client -connect lnkpi.<yourdomain>.com:443 -servername lnkpi.<yourdomain>.com 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates

# 5. 自动续期 dry-run（确认 cron 生效）
~/.acme.sh/acme.sh --renew -d lnkpi.<yourdomain>.com --dry-run

# 6. 页脚备案号（合规硬要求）
curl -sS https://lnkpi.<yourdomain>.com/ | grep -o 'ICP备[0-9]*号'
```

**多地域可达性**：用 `itdog.cn`（HTTP 测速，国内多省节点）或 `boce.aliyun.com` 做全国拨测，确认各省电信/联通/移动均可达——这是 Vercel 路线**永远无法通过**的一项。

---

## 6. 关键风险与坑

| # | 风险 | 影响 | 规避 |
|---|---|---|---|
| 1 | **80 端口被别的项目占用** | 无法用 HTTP-01 验签、无法做 80→443 跳转 | 用 DNS-01；跳转靠 nginx vhost 协调 |
| 2 | **443 现状不明**（有监听但 TLS 失败） | 可能与现有服务冲突 | 上机 `ss -tlnp` 查清后再动 |
| 3 | 域名实名与备案主体不一致 | 备案直接驳回，白等一轮 | 注册后立刻实名，主体信息对齐 |
| 4 | 备案期间域名仍解析到 Vercel | 部分管局校验境外解析 → 驳回 | 提交备案前把解析改成 CVM IP 或暂停记录 |
| 5 | 腾讯云免费证书 90 天不自动续 | 过期后全站 HTTPS 报错 | **用 acme.sh 自动续期**，别用免费证书人工轮换 |
| 6 | `try_files ... /index.html` 自指死循环 | 500（已发生过一次） | 上线前校验 dist 存在 |
| 7 | 忘记公安备案 | ICP 通过 30 日后可能被关停 | 记入待办，设提醒 |
| 8 | 备案号未展示 | 不合规 | 页脚加备案号 + 工信部链接 |
| 9 | Vercel Hobby 禁商用 | ToS 违规 | 商用前升级 Pro 或直接切 CVM |
| 10 | `navigator.clipboard` 在明文 HTTP 下不可用 | 复制功能静默失效 | 已收敛到 `utils/copyToClipboard.ts`，建议补 fallback（`document.execCommand`） |

---

## 7. 成本估算

| 项目 | 费用 |
|---|---|
| 域名 `.com`（3 年） | 约 ¥250 |
| SSL 证书（Let's Encrypt） | ¥0 |
| ICP 备案（腾讯云） | ¥0 |
| CVM | 已有 |
| EdgeOne（可选，后续） | 免费版可用 |
| Vercel Pro（若保留商用前端） | ~$20/席/月 |

---

## 8. 待决策点

1. **域名主体**：走**企业备案**（可商用、可备 10 个域名）还是**个人备案**（禁止商业用途）？
2. **域名后缀与名字**：`.com` / `.cn`？主域名是否就用 `lnkpi.xxx` 还是 `app.xxx`（保留 `www` 做落地页）？
3. **是否先上过渡方案**：今天就用 §5.2 拿到可用 HTTPS 入口（需先合并 PR #374），还是直接等备案？
4. **80 端口归属**：另一个项目归谁管？能否在其 nginx 加 vhost，还是需要腾出端口？
5. **Vercel 的最终定位**：只做 CI/CD + 预览，还是保留为部分用户的入口（海外）？

---

## 附：立刻可做的两件事

```bash
# 1. 合并 PR #374（否则自定义域名"首页能开、接口全挂"）
gh pr merge 374 --squash

# 2. 合并 PR #380（仓库卫生收尾）
gh pr merge 380 --squash
```
