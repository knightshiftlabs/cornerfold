// Where a photo goes when it becomes a page.
import { describe, expect, it } from 'vitest'
import { DEFAULT_PAPER, describePaper, placeImage, type Paper } from '../src/lib/paper'

const A4 = [595.28, 841.89]
const paper = (p: Partial<Paper>): Paper => ({ ...DEFAULT_PAPER, ...p })
const round = (n: number) => Math.round(n * 100) / 100

describe('placing a photo on a page', () => {
  it('by default, the page is the photo’s own size, as it always was', () => {
    expect(DEFAULT_PAPER.size).toBe('original')
    expect(placeImage(300, 200, DEFAULT_PAPER)).toEqual({ page: [300, 200], box: { x: 0, y: 0, width: 300, height: 200 } })
  })

  it('on A4 with no margin, a portrait photo of the same shape fills the page', () => {
    const { page, box } = placeImage(595.28, 841.89, paper({ size: 'a4', margin: 'none' }))
    expect(page).toEqual(A4)
    expect([box.x, box.y, round(box.width), round(box.height)]).toEqual([0, 0, 595.28, 841.89])
  })

  it('keeps the photo’s shape: never stretched, and centred', () => {
    const { page, box } = placeImage(1000, 500, paper({ size: 'a4', margin: 'none', orientation: 'portrait' }))
    expect(page).toEqual(A4)
    expect(round(box.width / box.height)).toBe(2)
    expect(round(box.width)).toBe(595.28) // as wide as the page
    expect(round(box.y)).toBe(round((841.89 - box.height) / 2)) // centred top to bottom
  })

  it('keeps a tall photo’s shape too, where the page height is the limit (regression: a stretched photo passed)', () => {
    const { box } = placeImage(400, 1000, paper({ size: 'a4', margin: 'none', orientation: 'portrait' }))
    expect(round(box.height)).toBe(841.89)
    expect(round(box.width / box.height)).toBe(0.4)
    expect(round(box.x)).toBe(round((595.28 - box.width) / 2))
  })

  it('leaves the margin on every side', () => {
    const { page, box } = placeImage(400, 400, paper({ size: 'a4', margin: 'small', orientation: 'portrait' }))
    expect(box.x).toBeGreaterThanOrEqual(28.35 - 1e-9)
    expect(box.y).toBeGreaterThanOrEqual(28.35 - 1e-9)
    expect(box.x + box.width).toBeLessThanOrEqual(page[0] - 28.35 + 1e-9)
    expect(box.y + box.height).toBeLessThanOrEqual(page[1] - 28.35 + 1e-9)
  })

  it('a wide margin is wider than a small one', () => {
    const small = placeImage(400, 300, paper({ size: 'a4', margin: 'small' })).box.width
    const wide = placeImage(400, 300, paper({ size: 'a4', margin: 'wide' })).box.width
    expect(wide).toBeLessThan(small)
  })

  it('"match each photo" turns the paper for landscape photos and not for portrait ones', () => {
    expect(placeImage(1600, 1200, paper({ size: 'a4' })).page).toEqual([841.89, 595.28])
    expect(placeImage(1200, 1600, paper({ size: 'a4' })).page).toEqual(A4)
  })

  it('a fixed orientation is used whatever the photo', () => {
    expect(placeImage(1600, 1200, paper({ size: 'a4', orientation: 'portrait' })).page).toEqual(A4)
    expect(placeImage(1200, 1600, paper({ size: 'letter', orientation: 'landscape' })).page).toEqual([792, 612])
  })

  it('enlarges a small photo to fill the space', () => {
    const { box } = placeImage(100, 100, paper({ size: 'a4', margin: 'none', orientation: 'portrait' }))
    expect(round(box.width)).toBe(595.28)
  })
})

describe('describing the setting', () => {
  it('says what will happen in plain words', () => {
    expect(describePaper(DEFAULT_PAPER)).toBe('each photo at its own size')
    expect(describePaper(paper({ size: 'a4' }))).toBe('A4, turned to suit each photo, 1 cm margin')
    expect(describePaper(paper({ size: 'letter', orientation: 'portrait', margin: 'none' }))).toBe('Letter, portrait, no margin')
  })
})
