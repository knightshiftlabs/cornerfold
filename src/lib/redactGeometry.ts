// Where redaction boxes land on a picture of the page. No browser or PDF code here, so it can be tested on its own.

/** A box as fractions of the page as it is seen, from its top left (like every mark). */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The boxes in whole pixels of a picture `width` x `height`, each grown by `pad` pixels so no sliver of an anti-aliased
 * edge is left, clipped to the picture, and dropped if nothing of them is inside.
 */
export function pixelBoxes(boxes: readonly Box[], width: number, height: number, pad = 1): [number, number, number, number][] {
  const out: [number, number, number, number][] = []
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x * width) - pad)
    const y0 = Math.max(0, Math.floor(b.y * height) - pad)
    const x1 = Math.min(width, Math.ceil((b.x + b.w) * width) + pad)
    const y1 = Math.min(height, Math.ceil((b.y + b.h) * height) + pad)
    if (x1 > x0 && y1 > y0) out.push([x0, y0, x1 - x0, y1 - y0])
  }
  return out
}

/**
 * Boxes placed on a page, re-expressed as fractions of a photo that sits on that page. `page` is the page's size in
 * points and `photo` where the photo is drawn on it, in points from the page's bottom left (as the export draws it).
 * Boxes that miss the photo are dropped; ones that overlap it are clipped to it.
 */
export function boxesOnPhoto(boxes: readonly Box[], page: [number, number], photo: { x: number; y: number; width: number; height: number }): Box[] {
  const [pw, ph] = page
  const left = photo.x
  const top = ph - (photo.y + photo.height)
  const out: Box[] = []
  for (const b of boxes) {
    const x0 = Math.max(0, (b.x * pw - left) / photo.width)
    const y0 = Math.max(0, (b.y * ph - top) / photo.height)
    const x1 = Math.min(1, ((b.x + b.w) * pw - left) / photo.width)
    const y1 = Math.min(1, ((b.y + b.h) * ph - top) / photo.height)
    if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  }
  return out
}
