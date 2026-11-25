import { describe, expect, it } from 'vitest'
import { findInPieces, MAX_HITS, type Piece } from '../src/lib/findText'

// A page 600 x 800 points whose top left is the viewer's top left; every letter is 10 points wide.
const measure = (s: string) => [...s].length * 10
const toFraction = (x: number, y: number): [number, number] => [x / 600, (800 - y) / 800]
const piece = (str: string, x: number, y: number, extra: Partial<Piece> = {}): Piece => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width: [...str].length * 10,
  height: 10,
  ...extra,
})
const find = (pieces: Piece[], q: string, o = {}) => findInPieces(pieces, q, o, measure, toFraction)

describe('finding words', () => {
  it('finds a word and boxes just its letters', () => {
    const [hit] = find([piece('Hello John Smith', 100, 700)], 'john')
    expect(hit.text).toBe('John')
    expect(hit.before).toBe('Hello ')
    expect(hit.after).toBe(' Smith')
    expect(hit.boxes).toHaveLength(1)
    const b = hit.boxes[0]
    // letters 6..10 of the run start 60 points in and end 100 in, with a little room (0.2 of the height) either side
    expect(b.x * 600).toBeCloseTo(100 + 60 - 2, 5)
    expect(b.x * 600 + b.w * 600).toBeCloseTo(100 + 100 + 2, 5)
    expect(b.y).toBeGreaterThan(0)
    expect(b.y + b.h).toBeLessThan(1)
    expect(hit.upright && hit.startsWord && hit.endsWord).toBe(true)
  })

  it('matches across runs, and across a line break as a space', () => {
    const pieces = [piece('account', 50, 700), piece('number', 130, 700), piece('12345', 50, 680)]
    expect(find(pieces, 'account number')).toHaveLength(1)
    const lines = [piece('account', 50, 700, { hasEOL: true }), piece('12345', 50, 680)]
    const [hit] = find(lines, 'account 12345')
    expect(hit.boxes).toHaveLength(2) // one box per line
    expect(hit.boxes[0].y).toBeLessThan(hit.boxes[1].y)
  })

  it('treats any run of whitespace as one space', () => {
    expect(find([piece('a   b', 0, 700)], 'a b')).toHaveLength(1)
    expect(find([piece('a b', 0, 700)], '  a \n\t b ')).toHaveLength(1)
  })

  it('ignores capitals unless asked, and can insist on whole words', () => {
    const p = [piece('Cat concat CAT', 0, 700)]
    expect(find(p, 'cat')).toHaveLength(3)
    expect(find(p, 'cat', { matchCase: true })).toHaveLength(1)
    const whole = find(p, 'cat', { wholeWord: true })
    expect(whole.map((h) => h.text)).toEqual(['Cat', 'CAT'])
    const part = find(p, 'cat').find((h) => h.text === 'cat')!
    expect(part.startsWord).toBe(false)
    expect(part.endsWord).toBe(true)
  })

  it('finds nothing for an empty search or an absent word', () => {
    expect(find([piece('abc', 0, 700)], '   ')).toEqual([])
    expect(find([piece('abc', 0, 700)], 'xyz')).toEqual([])
    expect(find([], 'abc')).toEqual([])
  })

  it('stops at the limit so one letter cannot flood the list', () => {
    const many = Array.from({ length: MAX_HITS + 50 }, (_, i) => piece('e', (i % 50) * 10, 700 - Math.floor(i / 50)))
    expect(find(many, 'e')).toHaveLength(MAX_HITS)
  })

  it('keeps positions right after letters that change length when lower-cased', () => {
    const [hit] = find([piece('İİ target', 0, 700)], 'target')
    expect(hit.text).toBe('target')
    expect(hit.boxes[0].x * 600).toBeCloseTo(30 - 2, 5)
  })

  it('does not widen the boxes of sideways text', () => {
    const up: Piece = { str: 'secret', transform: [0, 10, -10, 0, 300, 100], width: 60, height: 10 }
    const [hit] = find([up], 'secret')
    expect(hit.upright).toBe(false)
    expect(hit.boxes).toHaveLength(1)
  })

  it('upside-down text is not upright either', () => {
    const flipped: Piece = { str: 'secret', transform: [-10, 0, 0, -10, 300, 400], width: 60, height: 10 }
    expect(find([flipped], 'secret')[0].upright).toBe(false)
  })

  it('skips runs with no size rather than failing', () => {
    expect(find([{ ...piece('abc', 0, 700), width: 0, height: 0, transform: [0, 0, 0, 0, 0, 0] }], 'abc')).toEqual([])
  })
})
