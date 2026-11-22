import { describe, expect, it } from 'vitest'
import { boxesOnPhoto, pixelBoxes } from '../src/lib/redactGeometry'

describe('redaction boxes on a picture', () => {
  it('turns fractions into whole pixels, a pixel larger on every side so no edge is left', () => {
    expect(pixelBoxes([{ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }], 1000, 800)).toEqual([[99, 159, 502, 202]])
  })
  it('never goes outside the picture', () => {
    expect(pixelBoxes([{ x: 0, y: 0, w: 1, h: 1 }], 100, 50)).toEqual([[0, 0, 100, 50]])
    expect(pixelBoxes([{ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }], 100, 100)).toEqual([[89, 89, 11, 11]])
  })
  it('drops a box with nothing inside the picture', () => {
    expect(pixelBoxes([{ x: 1.2, y: 0.1, w: 0.1, h: 0.1 }], 100, 100)).toEqual([])
  })
})

describe('boxes placed on a page, mapped onto a photo on it', () => {
  // A4-ish page, photo drawn 400 x 300 points with its bottom left at (100, 200): so its top is 842 - 500 = 342 from the page top.
  const page: [number, number] = [595, 842]
  const photo = { x: 100, y: 200, width: 400, height: 300 }
  it('maps a box inside the photo to the same place on the photo', () => {
    // the photo's own top-left quarter: x 100..300, y 342..492 as points from the page's top
    const [b] = boxesOnPhoto([{ x: 100 / 595, y: 342 / 842, w: 200 / 595, h: 150 / 842 }], page, photo)
    expect(b.x).toBeCloseTo(0, 5)
    expect(b.y).toBeCloseTo(0, 5)
    expect(b.w).toBeCloseTo(0.5, 5)
    expect(b.h).toBeCloseTo(0.5, 5)
  })
  it('clips a box that hangs over the photo’s edge, and drops one in the margin', () => {
    const [b] = boxesOnPhoto([{ x: 0, y: 0, w: 1, h: 1 }], page, photo)
    expect(b).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(boxesOnPhoto([{ x: 0.01, y: 0.01, w: 0.05, h: 0.05 }], page, photo)).toEqual([])
  })
})
