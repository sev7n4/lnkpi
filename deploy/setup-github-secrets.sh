#!/usr/bin/env bash
# 将 aimarket 的 production Secrets 复制到 lnkpi（需 gh 已登录且有权限）
# 用法: bash deploy/setup-github-secrets.sh
set -euo pipefail

if ! gh auth status >/dev/null 2>&1; then
  echo "请先登录 GitHub CLI："
  echo "  gh auth login -h github.com"
  exit 1
fi

SOURCE_REPO="${SOURCE_REPO:-sev7n4/aimarket}"
TARGET_REPO="${TARGET_REPO:-sev7n4/lnkpi}"
ENV_NAME="${ENV_NAME:-production}"

echo "从 ${SOURCE_REPO} 复制 Secrets 到 ${TARGET_REPO}（Environment: ${ENV_NAME}）"

copy_secret() {
  local name="$1"
  local val
  if ! val=$(gh secret list --repo "$SOURCE_REPO" --env "$ENV_NAME" --json name 2>/dev/null | jq -r ".[] | select(.name==\"$name\") | .name"); then
    echo "WARN: 无法读取 $SOURCE_REPO environment secrets（可能无权限）"
    return 1
  fi
  if [ -z "$val" ]; then
    echo "SKIP: $name 在源仓库不存在"
    return 0
  fi
  echo "NOTE: GitHub CLI 无法直接读取 secret 明文。"
  echo "      请手动在 GitHub UI 复制，或使用 Organization secret 共用。"
}

echo ""
echo "=== 手动步骤（GitHub 网页，约 3 分钟）==="
echo "1. 打开 https://github.com/${SOURCE_REPO}/settings/environments"
echo "2. 点 production → Environment secrets，记下已有项"
echo "3. 打开 https://github.com/${TARGET_REPO}/settings/environments"
echo "4. 若无 production 环境，点 New environment → 名称填 production"
echo "5. 添加以下 Secrets（值与 aimarket 相同）："
echo "   - TENCENT_CLOUD_IP"
echo "   - TENCENT_CLOUD_USER        （值为 root）"
echo "   - TENCENT_CLOUD_SSH_KEY     （粘贴 ~/.ssh/tencent_cloud_deploy 私钥全文）"
echo "   - TCR_USERNAME              （腾讯云账号 ID，纯数字）"
echo "   - TCR_PASSWORD              （TCR 个人版固定密码）"
echo ""
echo "6. Settings → Secrets and variables → Actions → Variables → New repository variable"
echo "   - TCR_NAMESPACE = lnkpi"
echo "   - TCR_REGISTRY  = ccr.ccs.tencentyun.com （可选，workflow 有默认值）"
echo ""
echo "SSH 私钥路径: ~/.ssh/tencent_cloud_deploy"
echo "服务器 IP: 119.29.173.89"
