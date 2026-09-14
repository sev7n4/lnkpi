<script setup lang="ts">
import {
  BRAND_LOGO_URL,
  BRAND_NAME,
  ICP_TEXT,
  LEGAL_ENTITY,
  SUPPORT_EMAIL,
  TERMS_TITLE,
} from '@/constants/brand'
</script>

<template>
  <div class="legal-page mx-auto max-w-3xl px-6 pb-16 pt-10">
    <RouterLink to="/" class="legal-page__brand inline-flex items-center gap-2 text-white/80 transition hover:text-white">
      <img :src="BRAND_LOGO_URL" :alt="BRAND_NAME" class="h-8 w-8 object-contain">
      <span class="font-display text-base font-semibold">{{ BRAND_NAME }}</span>
    </RouterLink>

    <header class="mt-10 border-b border-white/10 pb-8">
      <h1 class="font-display text-3xl font-semibold text-white">{{ TERMS_TITLE }}</h1>
      <p class="mt-4 text-sm text-white/50">
        更新日期：2026-09-14 · 生效日期：2026-09-14
      </p>
    </header>

    <article class="legal-page__body mt-10 space-y-8 text-sm leading-7 text-white/75">
      <section>
        <h2 class="mb-3 text-base font-semibold text-white">1. 总则</h2>
        <p>
          欢迎使用 {{ BRAND_NAME }}（以下简称「本平台」）。本协议由 {{ LEGAL_ENTITY }}（以下简称「我们」）与您订立，规范您访问和使用本平台 AI 创作、工作流、社区及相关服务的行为。注册、登录或使用本平台，即表示您已阅读并同意本协议。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">2. 账号注册与使用</h2>
        <p>
          您应使用真实、合法的手机号完成注册，并妥善保管账号与验证码。您对账号下的全部操作负责，不得出租、出借、转让或共享账号。若发现账号异常，请立即联系我们。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">3. 服务内容与规范</h2>
        <p>
          本平台提供 AI 图像、视频、文本等生成能力，以及画布工作流、作品分享与社区浏览等功能。具体功能以页面实际展示为准，我们可能根据运营需要调整、升级或暂停部分服务，并尽可能提前告知。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">4. 用户行为规范</h2>
        <p>
          您不得利用本平台制作、上传、传播违法违规、侵权、虚假、骚扰、暴力、色情或其他有害内容，不得干扰平台正常运行或侵害他人合法权益。我们有权对违规内容与账号采取警告、限制功能、删除内容或封禁等措施。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">5. 知识产权</h2>
        <p>
          本平台界面、标识、软件及相关内容的知识产权归我们或权利人所有。您在遵守法律法规及本协议的前提下，对依法享有权利的上传内容与生成成果享有相应权利；您授予我们为提供服务所必需的存储、展示与处理许可。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">6. 隐私与数据</h2>
        <p>
          我们重视您的个人信息保护，具体规则见
          <RouterLink to="/privacy" class="text-[var(--neo-hi-text)] underline underline-offset-2 hover:opacity-80">《{{ BRAND_NAME }}隐私政策》</RouterLink>。
          除法律法规另有规定外，未经您同意，我们不会向第三方出售您的个人信息。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">7. 免责声明</h2>
        <p>
          AI 生成内容可能存在不准确、不完整或与预期不符的情况，仅供创作参考，不构成专业建议。因网络、设备、第三方服务或不可抗力导致的服务中断、数据丢失，我们在法律允许范围内不承担超出法定责任以外的赔偿责任。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">8. 协议变更</h2>
        <p>
          我们可能适时修订本协议，并在本平台公布更新版本。若您继续使用本平台，即视为接受修订后的协议；若您不同意，请停止使用并联系我们注销账号。
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-base font-semibold text-white">9. 联系我们</h2>
        <p>
          如对本协议有任何疑问，请通过
          <a :href="`mailto:${SUPPORT_EMAIL}`" class="text-[var(--neo-hi-text)] underline underline-offset-2 hover:opacity-80">{{ SUPPORT_EMAIL }}</a>
          与我们联系。运营主体：{{ LEGAL_ENTITY }}。
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
