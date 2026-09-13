export type CaptchaShapeId = 'rect' | 'circle' | 'puzzle'

export type SliderPuzzleMeta = {
  width: number
  height: number
  pieceSize: number
  y: number
  shape?: CaptchaShapeId
  /** Extra pixels around piece image for puzzle tabs; piece renders at (offsetX-pad, y-pad). */
  piecePad?: number
}

export type SliderCaptchaChallengePublic = {
  challengeId: string
  bgImage: string
  pieceImage: string
  puzzle: SliderPuzzleMeta
}
