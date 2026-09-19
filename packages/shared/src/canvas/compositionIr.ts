import { z } from 'zod'

const otherRefSchema = z.object({
  ref: z.string(),
  role: z.enum(['product', 'scene', 'other']),
})

const compositionPrimitivesSchema = z.object({
  identityRef: z.string().optional(),
  skipI0: z.boolean().optional(),
  garmentRefs: z.array(z.string()),
  otherRefs: z.array(otherRefSchema),
  wantVideo: z.boolean(),
  sequence: z.array(z.enum(['white_bg', 'scene'])),
})

const compositionCopySchema = z.object({
  titles: z.record(z.string()).optional(),
  promptSlots: z.record(z.string()).optional(),
  pSlots: z.record(z.string()).optional(),
})

export const compositionIrSchema = z.object({
  version: z.literal('1'),
  primitives: compositionPrimitivesSchema,
  copy: compositionCopySchema.optional(),
})

export type CompositionIR = z.infer<typeof compositionIrSchema>
