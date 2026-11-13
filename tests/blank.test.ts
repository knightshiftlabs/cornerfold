// Telling an empty page from one with something on it.
import { describe, expect, it } from 'vitest'
import { isBlank } from '../src/lib/blank'

const W = 240
const H = 340
/** A page of one shade, then painted on. */
function page(paper: [number, number, number], paint?: (set: (x: number, y: number, shade: number) => void) => void) {
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) rgba.set([...paper, 255], i * 4)
  paint?.((x, y, shade) => rgba.set([shade, shade, shade, 255], (y * W + x) * 4))
  return rgba
}
let seed = 3
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const WHITE: [number, number, number] = [255, 255, 255]

describe('pages that are blank', () => {
  it('a clean white page', () => {
    expect(isBlank(page(WHITE), W, H)).toBe(true)
  })

  it('cream or grey paper, as scanners often produce', () => {
    expect(isBlank(page([244, 239, 226]), W, H)).toBe(true)
    expect(isBlank(page([205, 205, 205]), W, H)).toBe(true)
  })

  it('a few specks of scanner dust', () => {
    const dusty = page(WHITE, (set) => { for (let n = 0; n < 20; n++) set(20 + Math.floor(rnd() * 200), 20 + Math.floor(rnd() * 300), 40) })
    expect(isBlank(dusty, W, H)).toBe(true)
  })

  it('the dark shadow a scanner leaves along the edges', () => {
    const shadowed = page(WHITE, (set) => { for (let y = 0; y < H; y++) for (let x = 0; x < 6; x++) { set(x, y, 90); set(W - 1 - x, y, 90) } })
    expect(isBlank(shadowed, W, H)).toBe(true)
  })

  it('slightly uneven paper, like a faint scan gradient', () => {
    const uneven = page(WHITE, (set) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 250 - Math.round((y / H) * 12)) })
    expect(isBlank(uneven, W, H)).toBe(true)
  })
})

describe('pages that are not blank', () => {
  it('lines of text', () => {
    const text = page(WHITE, (set) => { for (let line = 0; line < 20; line++) for (let x = 30; x < 200; x++) if (rnd() > 0.4) set(x, 40 + line * 12, 30) })
    expect(isBlank(text, W, H)).toBe(false)
  })

  it('a single short line, such as a title or a signature', () => {
    const title = page(WHITE, (set) => { for (let x = 80; x < 160; x++) for (let y = 160; y < 163; y++) set(x, y, 35) })
    expect(isBlank(title, W, H)).toBe(false)
  })

  it('text on cream paper', () => {
    const text = page([244, 239, 226], (set) => { for (let line = 0; line < 8; line++) for (let x = 30; x < 200; x++) set(x, 60 + line * 20, 50) })
    expect(isBlank(text, W, H)).toBe(false)
  })

  it('a dark page, which is a picture and not an empty sheet', () => {
    expect(isBlank(page([40, 40, 40]), W, H)).toBe(false)
  })

  it('a photo', () => {
    const photo = page(WHITE, (set) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, Math.floor(rnd() * 255)) })
    expect(isBlank(photo, W, H)).toBe(false)
  })

  it('a picture too small to judge', () => {
    expect(isBlank(new Uint8ClampedArray(4 * 4 * 4).fill(255), 4, 4)).toBe(false)
  })
})
