export type CaptchaBlockShape = 'rect' | 'l'
export type CaptchaChallenge = {
  challengeId: string
  canvas: { w: number; h: number }
  blocks: { id: string; shape: CaptchaBlockShape; home: { x: number; y: number } }[]
  slots: { id: string; shape: CaptchaBlockShape; x: number; y: number }[]
}
export type CaptchaPlacement = { blockId: string; slotId: string }
