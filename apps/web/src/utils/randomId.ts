/**
 * UUID when secure context allows; fallback for HTTP production hosts.
 *
 * 实现统一收敛到 `@lnkpi/shared`，避免 web 与 shared 各自维护一份降级逻辑
 * （shared 内部也需要同能力，见 `seedImageVersions`）。
 */
export { randomId } from '@lnkpi/shared'
