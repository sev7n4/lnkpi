export type CaptchaShapeId = 'rect' | 'circle' | 'puzzle'

export type SliderPuzzleMeta = {
  width: number
  height: number
  pieceSize: number
  y: number
  shape?: CaptchaShapeId
  piecePad?: number
}

export type SliderCaptchaChallengePublic = {
  challengeId: string
  bgImage: string
  pieceImage: string
  puzzle: SliderPuzzleMeta
}
