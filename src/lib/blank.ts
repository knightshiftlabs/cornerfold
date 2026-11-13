// Telling an empty page from one with something on it, from a small picture of the page.

/**
 * A page counts as blank when almost nothing on it is darker than its paper. The paper is whatever shade
 * most of the page is, so cream or grey scans work as well as white ones. Specks of scanner dust, and
 * the shadow a scanner leaves along the edges, don't count as content.
 */
export function isBlank(rgba: Uint8ClampedArray, width: number, height: number): boolean {
  if (width < 8 || height < 8) return false
  const edge = Math.round(Math.min(width, height) * 0.04) // ignore the border
  const shades = new Uint32Array(256)
  let counted = 0
  for (let y = edge; y < height - edge; y++) {
    for (let x = edge; x < width - edge; x++) {
      const i = (y * width + x) * 4
      shades[Math.round(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114)]++
      counted++
    }
  }
  if (!counted) return false
  // The paper: the brightest shade that a good share of the page has, looking a little either side of each.
  let paper = 0
  let best = 0
  for (let s = 0; s < 256; s++) {
    let near = 0
    for (let d = -6; d <= 6; d++) near += shades[s + d] ?? 0
    if (near > best) [best, paper] = [near, s]
  }
  if (paper < 150) return false // a dark page is a picture, not an empty sheet
  let marks = 0
  for (let s = 0; s < paper - 40; s++) marks += shades[s]
  return marks / counted < 0.0006 // less than about six pixels in ten thousand
}
