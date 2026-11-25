// Taking pictures out of a PDF: turning pdf.js's pixel layouts into RGBA, and what is worth keeping.
import { describe, expect, it } from 'vitest'
import { Kind, MIN_SIDE, pictureName, toRgba, worthKeeping } from '../src/lib/pictures'

describe('pictures in the pages', () => {
  it('passes RGBA through, and gives RGB an opaque alpha', () => {
    expect([...toRgba(Kind.Rgba, new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]), 2, 1)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...toRgba(Kind.Rgb, new Uint8Array([10, 20, 30, 40, 50, 60]), 2, 1)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255])
  })

  it('unpacks one-bit pictures, whose rows end on a whole byte, with a set bit as white', () => {
    // 3 pixels wide, 2 rows: row 1 is white, black, white (101xxxxx); row 2 is black, black, white (001xxxxx).
    const px = toRgba(Kind.Gray1, new Uint8Array([0b10100000, 0b00100000]), 3, 2)
    expect([...px].filter((_, i) => i % 4 === 0)).toEqual([255, 0, 255, 0, 0, 255])
    expect([...px].filter((_, i) => i % 4 === 3)).toEqual([255, 255, 255, 255, 255, 255])
  })

  it('refuses a layout it does not know, rather than saving noise', () => {
    expect(() => toRgba(9, new Uint8Array(4), 1, 1)).toThrow('Unknown picture layout')
  })

  it('leaves out spacers, dots and rules', () => {
    expect(worthKeeping(MIN_SIDE, MIN_SIDE)).toBe(true)
    expect(worthKeeping(1, 400)).toBe(false)
    expect(worthKeeping(400, MIN_SIDE - 1)).toBe(false)
  })

  it('names each picture after the document and the page it was found on', () => {
    expect(pictureName('scan', 3, 2, 12, 'png')).toBe('scan-page-03-picture-2.png')
    expect(pictureName('scan', 3, 1, 120, 'jpg')).toBe('scan-page-003-picture-1.jpg')
  })
})
