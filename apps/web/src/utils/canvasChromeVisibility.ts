/**
 * 画布级 chrome（画布名区、左 dock、右上工具条）在「单图工作台」打开时应全部让位。
 * 抽成纯函数是为了让三处挂载点共用同一个判据，避免以后新增 chrome 又漏一个。
 */
export function shouldHideCanvasChrome(input: {
  refineOpen: boolean
  gridSliceOpen: boolean
}): boolean {
  return input.refineOpen || input.gridSliceOpen
}
