export type SliderPuzzleMeta = {
  width: number
  height: number
  pieceSize: number
  y: number
}

export type SliderCaptchaChallengePublic = {
  challengeId: string
  bgImage: string
  pieceImage: string
  puzzle: SliderPuzzleMeta
}
