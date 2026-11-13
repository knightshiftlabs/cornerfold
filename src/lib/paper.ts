// Where a photo goes when it becomes a page. Sizes are in PDF points (72 to the inch).

export interface Paper {
  /** "original" makes each page the photo's own size, as Cornerfold always has. */
  size: 'original' | 'a4' | 'letter'
  margin: 'none' | 'small' | 'wide'
  orientation: 'auto' | 'portrait' | 'landscape'
}

export const DEFAULT_PAPER: Paper = { size: 'original', margin: 'small', orientation: 'auto' }

const SIZES: Record<"a4" | "letter", [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] }
/** 1 cm and 2 cm. */
const MARGINS = { none: 0, small: 28.35, wide: 56.69 } as const

/**
 * The page for a photo of `width` x `height` points, and the box the photo is drawn in: as large as fits
 * inside the margins, never stretched, and centred. "auto" turns the paper to match the photo.
 */
export function placeImage(width: number, height: number, paper: Paper) {
  if (paper.size === 'original') return { page: [width, height] as [number, number], box: { x: 0, y: 0, width, height } }
  let [pw, ph]: [number, number] = SIZES[paper.size]
  const landscape = paper.orientation === 'landscape' || (paper.orientation === 'auto' && width > height)
  if (landscape) [pw, ph] = [ph, pw]
  const m = MARGINS[paper.margin]
  const scale = Math.min((pw - 2 * m) / width, (ph - 2 * m) / height)
  const w = width * scale
  const h = height * scale
  return { page: [pw, ph] as [number, number], box: { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h } }
}

export function describePaper(paper: Paper) {
  if (paper.size === 'original') return 'each photo at its own size'
  const name = paper.size === 'a4' ? 'A4' : 'Letter'
  const turn = paper.orientation === 'auto' ? 'turned to suit each photo' : paper.orientation
  return `${name}, ${turn}, ${paper.margin === 'none' ? 'no margin' : paper.margin === 'small' ? '1 cm margin' : '2 cm margin'}`
}
