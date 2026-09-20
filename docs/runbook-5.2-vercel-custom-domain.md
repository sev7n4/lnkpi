# 过渡方案 5.2 执行清单：自有域名 → Vercel（免备案）

> 日期：2026-09-20
> 前置阅读：`docs/domain-https-plan-2026-09-20.md`（完整方案）
> 状态：**等域名注册完成**（§1 是唯一需要人工付费的步骤）

---

## 0. 域名选型结论（2026-09-20 实测）

`lnkpi.xxx` 中的 `.xxx` 已确认不可行（成人内容专用 TLD，国内注册商不售、不可备案）。实测各后缀可注册性：

| 域名 | 状态 | 权威来源 | 可备案 |
|---|---|---|---|
| `lnkpi.com` | ❌ **已被注册**（2024-11-26 → 2027-11-26，隐私保护，线上 308 跳转） | Verisign RDAP | — |
| `lnkpi.cn` | ❌ **已被注册**（2023-12-12 → **2026-12-12**，阿里云，持有人杨振宇） | CNNIC WHOIS | — |
| **`lnkpi.net`** | ✅ **可注册** | Verisign RDAP + whois 双重确认 | ✅ |
| `lnkpi.org` | ✅ 可注册 | PIR RDAP | ✅ |
| `lnkpi.dev` | ✅ 可注册 | rdap.org | ❌ |
| `lnkpi.io` | ✅ 可注册 | rdap.org | ❌ |
| `lnkpi.app` | ✅ 可注册 | rdap.org | ❌ |
| `lnkpi.ai` | ✅ 可注册 | rdap.org | ❌ |

**推荐 `lnkpi.net`**（¥90 左右/年）：可注册 + MIIT 批准后缀**可备案**，以后切路线 B（CVM 自托管）不用换域名。
`.dev`/`.io` 品牌感更好且强制 HTTPS，但**永远无法备案**——选了它们，路线 B 就得再买一个域名。

> 教训：`.cn` 的 RDAP 误报了 404，**RDAP 结果必须用注册局 WHOIS 交叉验证**，尤其是 ccTLD。

---

## 1. 【人工】注册域名（唯一需要你操作的步骤）

腾讯云控制台 → **域名注册** → 搜索 `lnkpi.net` → 加入购物车

结账时**务必勾选**：

- [ ] **自动续费**（国内 18% 用户因忘续费掉域名）
- [ ] **域名隐私保护**（免费/低价，防止 WHOIS 爆露个人信息）

支付约 ¥90，订单完成后域名状态为「待实名」。

### 1.1 立即提交实名认证（不要拖）

控制台 → 域名管理 → 实名认证 → 上传身份证（企业则营业执照 + 法人身份证）

- 审核通常 **1-3 个工作日**
- ⚠️ 实名主体必须与将来备案主体**完全一致**
- ⚠️ 虽然本期搁置备案，但**实名是备案的前置条件且要求满 3 个自然日**，现在做了以后切路线 B 能省一周

> 域名注册成功后告诉我，剩下的步骤（§2-§4）我直接通过 Vercel API 帮你完成。

---

## 2. 【我来】Vercel 绑定域名

1. Vercel 项目 `lnkpi-web`（projectId `prj_Jt7Hg6F95qToeVE7JiOTlSDz8TJU`）→ Domains 添加：
   - `lnkpi.net`（apex）
   - `www.lnkpi.net`
2. Vercel 会给出需要配置的 DNS 记录，**以控制台实际显示为准**，标准值：

| 主机记录 | 类型 | 记录值 |
|---|---|---|
| `@`（apex） | `A` | `76.76.21.21` |
| `www` | `CNAME` | `cname.vercel-dns.com` |

> ⚠️ 不要开 Cloudflare 橙云代理——会干扰 Vercel 的域名验证，先用灰云（仅 DNS）。

3. Vercel Domains 页面出现**两个绿色勾**（域名校验 + 证书签发）即成功。证书由 Let's Encrypt 自动签发、自动续期，**零运维**。

---

## 3. 【你或我来】DNSPod 加解析记录

腾讯云控制台 → **DNS 解析 DNSPod** → `lnkpi.net` → 添加记录 → 按上表加 2 条

- DNSPod 上添加即时生效，国内传播通常 <10 分钟
- 若在别的注册商注册，需先把 DNS 服务器改为 `f1g1ns1.dnspod.net` / `f1g1ns2.dnspod.net`

---

## 4. 验收

```bash
# 1. HTTPS 首页
curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" https://lnkpi.net/

# 2. www 跳转
curl -sSI https://www.lnkpi.net/ | head -1

# 3. API 健康（走 PR #374 已合并的 8888 内网反代，应为 200 且非 8s 超时）
curl -sS https://lnkpi.net/api/health

# 4. 证书链与有效期
echo | openssl s_client -connect lnkpi.net:443 -servername lnkpi.net 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates

# 5. 多地拨测（确认至少比 vercel.app 强）
#    浏览器打开 https://www.itdog.cn/http/ 输入 https://lnkpi.net/
```

---

## 5. 边界与提醒

| 项 | 说明 |
|---|---|
| **合规** | Vercel Hobby（免费）计划 ToS 禁止商业用途；商用需 Pro（$20/席/月）或切路线 B |
| **稳定性** | 此方案国内延迟 50-100ms 且抖动，Vercel 明确"不保证大陆可用性"。**是过渡入口，不是长期方案** |
| **备案** | 本期搁置；域名实名现在做，备案随时可启动（管局 7-15 天） |
| **品牌保护** | `.com`/`.cn` 均已被占。若在意，可顺手多注册 `.net`+`.org` 两个后缀（多 ~¥90/年），不强推 |
| **`lnkpi.cn` 到期** | 2026-12-12 到期，若有人放弃注册可抢注，但不可依赖 |

---

## 6. 当前进度

- [x] PR #374 合并（Vercel 代理上游 5100→8888），`/api/health` 从 8s 超时降到 ~1.6s
- [x] 域名可注册性实测（发现 `.com`/`.cn` 均被占，避免白跑）
- [x] 本清单落库
- [ ] **⏳ 等待：用户注册 `lnkpi.net` 并完成实名**
- [ ] Vercel 绑定 + DNS 记录
- [ ] 验收
