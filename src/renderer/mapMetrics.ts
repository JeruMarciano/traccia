/**
 * Sizes of the text on the map, in sheet units: the sheet is 1000 units wide (core/layout.ts) and
 * scales with the window. Nothing on the map is set smaller than `sub`.
 */
export const MAP_TEXT = { row: 13, sub: 12 } as const

/** No label is drawn smaller than this on screen. */
export const SCREEN_FLOOR_PX = 9

/** The sheet is never drawn narrower than this: below it the smallest text would pass under the
 *  floor, so the sheet stops shrinking and scrolls instead. */
export const MAP_MIN_WIDTH = Math.ceil((SCREEN_FLOOR_PX / MAP_TEXT.sub) * 1000)

/** Nor wider than this: on a large window the text would grow past what a sheet of paper carries. */
export const MAP_MAX_WIDTH = 1100
