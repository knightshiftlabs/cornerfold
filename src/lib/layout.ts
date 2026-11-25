// Trimming pages and fitting them to a paper size, worked out as the pages are seen: on a turned page, "top" is the
// top of the page on screen. Plain geometry with no PDF library, so the panel can use it; stamp.ts applies it.
import { seenSize, toPageSpace, turnOf, type Box } from './stampText'

export type PaperName = 'a4' | 'letter' | 'a3' | 'a5' | 'legal'
/** Portrait width and height, in points (72 to the inch). */
export const PAPERS: Record<PaperName, { label: string; size: [number, number] }> = {
  a4: { label: 'A4', size: [595.28, 841.89] },
  letter: { label: 'Letter', size: [612, 792] },
  a3: { label: 'A3', size: [841.89, 1190.55] },
  a5: { label: 'A5', size: [419.53, 595.28] },
  legal: { label: 'Legal', size: [612, 1008] },
}

/** Margins to cut off each side as seen, in points. */
export interface Margins {
  top: number
  right: number
  bottom: number
  left: number
}

export type Layout = { kind: 'trim'; margins: Margins } | { kind: 'fit'; paper: PaperName }

export const MM = 72 / 25.4
/** The least that may be left of a page after trimming, in points (half an inch). */
export const MIN_LEFT = 36

/** The visible box after cutting `m` off each side as seen, in the page's own coordinates. */
export function trimmedBox(box: Box, rotation: number, m: Margins): Box {
  const turn = turnOf(rotation)
  const [w, h] = seenSize(box, turn)
  const a = toPageSpace(box, turn, m.left, m.bottom)
  const b = toPageSpace(box, turn, w - m.right, h - m.top)
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

/** Whether trimming leaves enough of a page of this size as seen. */
export const trimLeavesEnough = (seenW: number, seenH: number, m: Margins) => seenW - m.left - m.right >= MIN_LEFT && seenH - m.top - m.bottom >= MIN_LEFT

/**
 * How to fit a page onto `paper`: the scale for its content, and the new page box. The paper is turned to match the
 * page as seen (landscape pages stay landscape), the content keeps its proportions and sits in the middle, so a page
 * of a different shape gets white space on two sides.
 */
export function fitToPaper(box: Box, rotation: number, paper: PaperName) {
  const turn = turnOf(rotation)
  const [sw, sh] = seenSize(box, turn)
  let [tw, th] = PAPERS[paper].size
  if (sw > sh) [tw, th] = [th, tw]
  const scale = Math.min(tw / sw, th / sh)
  // In the page's own coordinates, a quarter-turned page's width is its seen height.
  const [pw, ph] = turn % 180 ? [th, tw] : [tw, th]
  return {
    scale,
    box: { x: box.x * scale + (box.width * scale - pw) / 2, y: box.y * scale + (box.height * scale - ph) / 2, width: pw, height: ph },
  }
}
