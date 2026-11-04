// FORGE in the same pixel face as the OpenCode wordmark: 24×30 letters on a 30 unit pitch,
// 6 unit strokes, sitting between y=6 and y=36 in a 42 unit tall box.
// `outline` is one outline per letter (outer clockwise, counters counter-clockwise), so the
// first-launch splash can draw each letter as a single stroke.
// `shadow` is the dimmed part of the counter that the wordmark draws behind each letter.
export const FORGE_LETTERS = [
  { id: "f", outline: "M0 6H24V12H6V18H18V24H6V36H0V6Z", shadow: undefined },
  { id: "o", outline: "M18 12H6V30H18V12ZM24 36H0V6H24V36Z", shadow: "M18 30H6V18H18V30Z" },
  // The leg kicks out to the right under the bowl so the R cannot read as an A.
  { id: "r", outline: "M0 6H24V18H18V24H24V36H18V30H12V24H6V36H0V6ZM6 12V18H18V12H6Z", shadow: "M18 18H6V12H18V18Z" },
  { id: "g", outline: "M0 6H24V12H6V30H18V24H12V18H24V36H0V6Z", shadow: "M6 18H12V24H18V30H6V18Z" },
  { id: "e", outline: "M0 6H24V12H6V18H18V24H6V30H24V36H0V6Z", shadow: undefined },
] as const

export const FORGE_PITCH = 30

export const FORGE_WIDTH = 144

export const FORGE_HEIGHT = 42
