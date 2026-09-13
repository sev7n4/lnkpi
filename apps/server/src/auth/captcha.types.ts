export type CaptchaBlockShape = 'rect' | 'l'

export type CaptchaPoint = { x: number; y: number }

export type CaptchaBlock = {
  id: string
  shape: CaptchaBlockShape
  home: CaptchaPoint
}

export type CaptchaSlot = {
  id: string
  shape: CaptchaBlockShape
  x: number
  y: number
}

export type CaptchaChallenge = {
  challengeId: string
  canvas: { w: number; h: number }
  blocks: CaptchaBlock[]
  slots: CaptchaSlot[]
}

export type CaptchaPlacement = {
  blockId: string
  slotId: string
}
