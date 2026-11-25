// The wording and geometry of page numbers and watermarks. No PDF library here, so the tool panels can use
// it without downloading one: the drawing itself happens in the export engine (stamp.ts).

export type NumberPosition = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left'
export type NumberFormat = 'n' | 'page-n' | 'page-n-of-total' | 'n-of-total' | 'bates'
export interface NumberOptions {
  position: NumberPosition
  format: NumberFormat
  /** The number on the first numbered page. */
  start: number
  /** In points. */
  size: number
  /** Leave the first page, such as a cover, without a number. */
  skipFirst: boolean
  /** Bates numbers only: text before the number, such as a case reference. */
  prefix?: string
  /** Bates numbers only: the number is padded with zeros to this many digits. */
  digits?: number
}

/** The longest prefix a Bates number can have, so the label still fits on a page. */
export const MAX_PREFIX = 24
/** The digit counts offered for Bates numbers. */
export const BATES_DIGITS = [4, 6, 8] as const
export interface WatermarkOptions {
  text: string
  /** Degrees, counter-clockwise as seen. */
  angle: 0 | 45
  opacity: number
}
export interface Stamps {
  numbers?: NumberOptions
  watermark?: WatermarkOptions
  /** Trim margins, or fit each page to a paper size (see layout.ts). Done before anything is drawn. */
  layout?: import('./layout').Layout
}

export function numberLabel(format: NumberFormat, n: number, total: number, bates: { prefix?: string; digits?: number } = {}) {
  // Bates numbering, as used for legal and evidence files: a prefix and a zero-padded number, such as ACME000042.
  if (format === 'bates') return `${bates.prefix ?? ''}${String(n).padStart(bates.digits ?? 6, '0')}`
  if (format === 'page-n') return `Page ${n}`
  if (format === 'page-n-of-total') return `Page ${n} of ${total}`
  if (format === 'n-of-total') return `${n} / ${total}`
  return `${n}`
}

/** The label for each of `count` pages, or null for a page left unnumbered. */
export function labelsFor(count: number, o: NumberOptions): (string | null)[] {
  const numbered = count - (o.skipFirst ? 1 : 0)
  const last = o.start + numbered - 1
  return Array.from({ length: count }, (_, i) => {
    if (o.skipFirst && i === 0) return null
    return numberLabel(o.format, o.start + i - (o.skipFirst ? 1 : 0), last, o)
  })
}

// The characters the PDF's built-in Helvetica can show (Windows code page 1252).
const EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
const showable = (c: string) => {
  const code = c.codePointAt(0)!
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || EXTRAS.includes(c)
}

/** Characters the built-in font can't show, such as Hindi, Chinese or emoji, each listed once. */
export const unsupportedCharacters = (text: string) => [...new Set([...text].filter((c) => !showable(c)))]

export interface Box {
  x: number
  y: number
  width: number
  height: number
}
export const turnOf = (rotation: number) => ((Math.round(rotation / 90) * 90) % 360 + 360) % 360

/** Width and height as seen. */
export const seenSize = (box: Box, rotation: number): [number, number] => (turnOf(rotation) % 180 ? [box.height, box.width] : [box.width, box.height])

/**
 * Turns a point on the page as seen (origin at its bottom left) into the page's own coordinates. A page
 * with /Rotate 90 is shown turned a quarter clockwise, so what is seen at the bottom left is the page's
 * own top left, and so on.
 */
export function toPageSpace(box: Box, rotation: number, sx: number, sy: number) {
  const { x, y, width: w, height: h } = box
  const turn = turnOf(rotation)
  if (turn === 90) return { x: x + w - sy, y: y + sx }
  if (turn === 180) return { x: x + w - sx, y: y + h - sy }
  if (turn === 270) return { x: x + sy, y: y + h - sx }
  return { x: x + sx, y: y + sy }
}
