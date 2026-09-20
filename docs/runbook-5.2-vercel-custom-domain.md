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

### 免费选项（过渡期首选）：DigitalPlat FreeDomain（¥0）

非营利项目 DigitalPlat 提供**真·DNS 委托**的免费二级域名（不是 URL 跳转、不是动态 DNS），后缀有 `.dpdns.org`、`.us.kg`、`.qzz.io`、`.xx.kg`、`.qd.je`。2026 年仍在稳定运营，已注册 50 万+ 域名，可正常绑 Vercel / Cloudflare。

**策略结论**：**过渡用免费的 `lnkpi.us.kg`（最短后缀），将来切路线 B 时再买可备案的 `lnkpi.net`** —— 两步不冲突，免费域名届时直接弃用即可。

### 免费后缀怎么选（按总长度排序，均为 DigitalPlat 可注册）

| 完整域名 | 长度 | 挂靠 | 评价 |
|---|---|---|---|
| **`lnkpi.us.kg`** | **11 字符** | `.kg`（吉尔吉斯斯坦） | ✅ **推荐**：DigitalPlat 里最短，无 DNS 记录（实测未被占） |
| `lnkpi.qd.je` | 12 字符 | — | 无记录（实测未被占），但后缀冷门 |
| `lnkpi.qzz.io` | 12 字符 | `.io` | 无记录（实测未被占），极客味 |
| `lnkpi.dpdns.org` | 15 字符 | `.org`（Verisign 运营） | 最长，但母域最稳、观感最正经 |
| `lnkpi.xx.kg` | 11 字符 | `.kg` | 无记录（实测未被占），`.xx.` 观感差 |

### 其他免费项目核查结论（都不如上面）

| 项目 | 域名示例 | 结论 |
|---|---|---|
| **js.org** | `lnkpi.js.org` | 人类 PR 审核；仅限 **JS 生态相关内容**（明确排除产品/无关站），通过与否看审核者心情，**不推荐赌** |
| **is-a.dev** | `lnkpi.is-a.dev` | 定位「开发者个人网站」；后缀 14 字符反而**更长**，还需 PR 审核 |
| **pp.ua** | `lnkpi.pp.ua` | 乌克兰 NIC.UA 注册，流程绑定该国注册商，长期稳定性存疑 |
| **eu.org** | `lnkpi.eu.org` | 免费但人工审核**动辄数周甚至数月**，等不起 |

> 结论：想「更短更干净」，在 DigitalPlat 体系内把 `.dpdns.org` 换成 `.us.kg` 即可——**同一个账号、同一条流程、同一批限制**，只是后缀更短。真正的「干净」（`lnkpi.com` 这类）没有免费渠道。

**免费方案的固有代价**（接受即可用）：

- ⚠️ 这些后缀**永远不可备案** → 纯过渡没问题，路线 B 必须换正式域名
- 免费**无 SLA**、需**手动续期**（过期即回收）、滥用监控严格（违规即删）
- 观感上是"免费域名"，不适合对外品牌露出
- 每账号限 3 个免费名额

---

## 1. 【人工二选一】拿到域名（唯一需要你操作的步骤）

### 路径 A · 免费：注册 `lnkpi.us.kg`（推荐，5 分钟）

1. 打开 `https://dash.domain.digitalplat.org` → 注册
   - 密码需 **≥12 位且同时含大小写字母+特殊字符**
   - **姓名字段必须包含空格**（否则报错）
2. **GitHub KYC**：Sign in with GitHub 授权，账号才算激活
3. Register → 搜索 `lnkpi` → **选 `.us.kg`**（最短好记；若被占则退选 `.qzz.io` / `.dpdns.org`）→ 确认可注册 → Register
4. **Nameservers 填 Vercel 的**：
   ```
   ns1.vercel-dns.com
   ns2.vercel-dns.com
   ```
   DigitalPlat **不托管 DNS**，必须填外部 NS。用 Vercel DNS 可省掉再注册 Cloudflare 账号这一步（若 Vercel 拒绝该 NS，退而用 Cloudflare：加站点拿两个 NS 填回 DigitalPlat，再在 Cloudflare 加解析记录）
5. 完成后告诉我一声 → 剩下（Vercel 绑定 + 证书 + 验收）我来

### 路径 B · 付费：注册 `lnkpi.net`（¥90/年，为路线 B 铺路）

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
- [x] 增加免费过渡路径（DigitalPlat FreeDomain，¥0）
- [x] 本清单落库
- [ ] **⏳ 等待：用户选路径 A（免费 `lnkpi.us.kg`）或路径 B（付费 `lnkpi.net`）并完成注册**
- [ ] Vercel 绑定 + DNS 记录
- [ ] 验收
