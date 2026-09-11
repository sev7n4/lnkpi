import type { EditIntent } from '../types'

/** P0 E5 — Transparent product cutout */
export const e5TransparentCutout: EditIntent = {
  id: 'e5_transparent_cutout',
  kind: 'edit_intent',
  label: '透明抠图',
  description: 'Isolate the product on a fully transparent background; no checkerboard or scenery.',
  groupId: 'identity_product',
  groupLabel: '身份/产品',
  changePreserveTemplate: `Extract the product from the input image and isolate it on a fully transparent background.
Output: centered product, crisp silhouette, no halos/fringing.
Preserve product geometry and label legibility exactly.
Add only light polishing. Do not add a solid backdrop, checkerboard, scenery, or shadow.
Do not restyle the product; remove the background and preserve clean alpha transparency.`,
  refRoles: [{ role: 'product', required: true, hint: '产品图' }],
  preferredParams: {
    size: '1024x1536',
    quality: 'medium',
    background: 'transparent',
    outputFormat: 'png',
  },
  capability: { requiresTransparentBackground: true, minRefImages: 1 },
}
