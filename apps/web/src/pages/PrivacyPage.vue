<script setup lang="ts">
import {
  BRAND_LOGO_URL,
  BRAND_NAME,
  ICP_TEXT,
  LEGAL_ENTITY,
  PRIVACY_TITLE,
  SUPPORT_EMAIL,
} from '@/constants/brand'
</script>

<template>
  <div class="legal-page mx-auto max-w-3xl px-6 pb-16 pt-10">
    <RouterLink to="/" class="legal-page__brand inline-flex items-center gap-2 text-white/80 transition hover:text-white">
      <img :src="BRAND_LOGO_URL" :alt="BRAND_NAME" class="h-8 w-8 object-contain">
      <span class="font-display text-base font-semibold">{{ BRAND_NAME }}</span>
    </RouterLink>

    <header class="mt-10 border-b border-white/10 pb-8">
      <h1 class="font-display text-3xl font-semibold text-white">{{ PRIVACY_TITLE }}</h1>
      <p class="mt-4 text-sm text-white/50">
        更新日期：2026-09-14 · 生效日期：2026-09-14
      </p>
    </header>

    <article class="legal-page__body mt-10 space-y-8 text-sm leading-7 text-white/75">
      <section>
        <h2 class="mb-3 text-base font-semibold text-white">1. 引言</h2>
        <p>
          {{ LEGAL_ENTITY }}（以下简称「我们」）运营 {{ BRAND_NAME }}。本政策说明我们如何收集、使用、存储与保护您的个人信息，以及您享有的相关权利。使用本平台即表示您同意本政策；若您不同意，请停止使用。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">2. 信息收集范围</h2>
        <p>我们可能收集以下信息：</p>
        <ul class="mt-3 list-disc space-y-2 pl-5">
          <li>账号信息：手机号码、昵称、头像等注册与资料信息；</li>
          <li>使用信息：登录记录、功能使用、积分与邀请关系等；</li>
          <li>内容与交互：您上传的素材、提示词、生成结果及社区互动数据；</li>
          <li>设备与日志：浏览器类型、IP 地址、访问时间、错误日志等用于安全与运维的技术信息。</li>
        </ul>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">3. 信息使用目的</h2>
        <p>我们收集的信息用于：</p>
        <ul class="mt-3 list-disc space-y-2 pl-5">
          <li>提供注册、登录、验证码及账号安全验证；</li>
          <li>交付 AI 生成、工作流、作品存储与社区展示等核心功能；</li>
          <li>处理积分、邀请奖励及客户服务请求；</li>
          <li>改进产品体验、排查故障、防范欺诈与滥用；</li>
          <li>履行法律法规规定的义务。</li>
        </ul>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">4. 信息存储与保护</h2>
        <p>
          您的信息存储于中华人民共和国境内具备安全措施的服务器。我们采取访问控制、传输加密、权限隔离等合理措施保护数据安全。除非法律另有规定或为提供服务所必需，我们仅在实现目的所需期限内保留您的信息。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">5. 第三方共享</h2>
        <p>
          我们不会出售您的个人信息。仅在以下情形可能共享：经您明确同意；为接入短信、云存储、AI 模型等必要第三方服务而提供最小必要信息；法律法规、司法机关或监管要求；合并、收购或重组时依法转移。我们将要求第三方遵守保密与安全义务。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">6. 用户权利</h2>
        <p>
          您有权查询、更正、补充您的个人信息，并可申请注销账号。您可通过平台设置或联系客服行使上述权利。注销后，我们将依法删除或匿名化处理相关信息，法律法规另有规定的除外。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">7. 未成年人保护</h2>
        <p>
          本平台不面向 18 岁以下未成年人。我们不会主动收集未成年人的个人信息。若您是未成年人的监护人并发现相关信息被收集，请联系我们，我们将尽快删除。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">8. 政策更新</h2>
        <p>
          我们可能适时更新本政策，并在本平台公布。重大变更将通过页面提示等方式告知。若您继续使用本平台，即视为接受更新后的政策。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">9. 联系我们</h2>
        <p>
          如对本政策有任何疑问、意见或投诉，请发送邮件至
          <a :href="`mailto:${SUPPORT_EMAIL}`" class="text-[var(--neo-hi-text)] underline underline-offset-2 hover:opacity-80">{{ SUPPORT_EMAIL }}</a>。
          运营主体：{{ LEGAL_ENTITY }}。
        </p>
      </section>
    </article>

    <footer class="legal-page__footer mt-16 border-t border-white/10 pt-8 text-center text-xs text-white/40">
      <p>{{ LEGAL_ENTITY }}</p>
      <p class="mt-2">
        <a :href="`mailto:${SUPPORT_EMAIL}`" class="hover:text-white/60">{{ SUPPORT_EMAIL }}</a>
      </p>
      <p class="mt-2">{{ ICP_TEXT }}</p>
    </footer>
  </div>
</template>
