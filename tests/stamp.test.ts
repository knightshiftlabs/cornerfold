// The geometry and wording of page numbers and watermarks.
import { describe, expect, it } from 'vitest'
import { labelsFor, numberLabel, seenSize, toPageSpace, unsupportedCharacters, type NumberOptions } from '../src/lib/stampText'

const opts = (o: Partial<NumberOptions>): NumberOptions => ({ position: 'bottom-center', format: 'n', start: 1, size: 11, skipFirst: false, ...o })

describe('page number wording', () => {
  it('has four formats', () => {
    expect(numberLabel('n', 3, 12)).toBe('3')
    expect(numberLabel('page-n', 3, 12)).toBe('Page 3')
    expect(numberLabel('page-n-of-total', 3, 12)).toBe('Page 3 of 12')
    expect(numberLabel('n-of-total', 3, 12)).toBe('3 / 12')
  })

  it('writes Bates numbers: a prefix and the number padded with zeros, with no total', () => {
    expect(numberLabel('bates', 42, 900, { prefix: 'ACME', digits: 6 })).toBe('ACME000042')
    expect(numberLabel('bates', 7, 9, { digits: 4 })).toBe('0007')
    expect(numberLabel('bates', 3, 9)).toBe('000003') // six digits unless asked otherwise
    expect(numberLabel('bates', 123456, 9, { prefix: 'X-', digits: 4 })).toBe('X-123456') // never cut a number short
    expect(labelsFor(3, { position: 'bottom-right', format: 'bates', start: 100, size: 9, skipFirst: true, prefix: 'DOC', digits: 4 })).toEqual([null, 'DOC0100', 'DOC0101'])
  })

  it('numbers every page from the start number', () => {
    expect(labelsFor(3, opts({ format: 'page-n-of-total' }))).toEqual(['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3'])
    expect(labelsFor(3, opts({ start: 5 }))).toEqual(['5', '6', '7'])
  })

  it('can leave the first page, such as a cover, unnumbered: the next page gets the start number', () => {
    expect(labelsFor(4, opts({ skipFirst: true, format: 'n-of-total' }))).toEqual([null, '1 / 3', '2 / 3', '3 / 3'])
    expect(labelsFor(3, opts({ skipFirst: true, start: 10, format: 'n-of-total' }))).toEqual([null, '10 / 11', '11 / 11'])
  })

  it('a one-page document with the first page skipped gets no number at all', () => {
    expect(labelsFor(1, opts({ skipFirst: true }))).toEqual([null])
  })
})

describe('what the built-in font can show', () => {
  it('English, accented letters, curly quotes and the euro sign', () => {
    expect(unsupportedCharacters('CONFIDENTIAL')).toEqual([])
    expect(unsupportedCharacters('Brouillon – Café “final” €5')).toEqual([])
  })

  it('names the characters it can’t show, once each', () => {
    expect(unsupportedCharacters('गोपनीय')).toEqual(['ग', 'ो', 'प', 'न', 'ी', 'य'])
    expect(unsupportedCharacters('Draft 😀😀')).toEqual(['😀'])
    expect(unsupportedCharacters('机密 Secret')).toEqual(['机', '密'])
  })
})

describe('turning a point as seen into the page’s own coordinates', () => {
  const box = { x: 0, y: 0, width: 600, height: 800 }

  it('swaps width and height for a page turned a quarter', () => {
    expect(seenSize(box, 0)).toEqual([600, 800])
    expect(seenSize(box, 90)).toEqual([800, 600])
    expect(seenSize(box, 180)).toEqual([600, 800])
    expect(seenSize(box, 270)).toEqual([800, 600])
    expect(seenSize(box, -90)).toEqual([800, 600]) // the same as 270
    expect(seenSize(box, 450)).toEqual([800, 600]) // the same as 90
  })

  it('maps the corner seen at the bottom left to the right corner of the page for each turn', () => {
    // A page with /Rotate 90 is shown a quarter turn clockwise: its own bottom-right corner ends up at the bottom left.
    expect(toPageSpace(box, 0, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(toPageSpace(box, 90, 0, 0)).toEqual({ x: 600, y: 0 })
    expect(toPageSpace(box, 180, 0, 0)).toEqual({ x: 600, y: 800 })
    expect(toPageSpace(box, 270, 0, 0)).toEqual({ x: 0, y: 800 })
  })

  it('maps the corner seen at the top right too', () => {
    expect(toPageSpace(box, 0, 600, 800)).toEqual({ x: 600, y: 800 })
    expect(toPageSpace(box, 90, 800, 600)).toEqual({ x: 0, y: 800 })
    expect(toPageSpace(box, 180, 600, 800)).toEqual({ x: 0, y: 0 })
    expect(toPageSpace(box, 270, 800, 600)).toEqual({ x: 600, y: 0 })
  })

  it('respects a page whose visible area does not start at zero', () => {
    expect(toPageSpace({ x: 20, y: 30, width: 600, height: 800 }, 0, 10, 10)).toEqual({ x: 30, y: 40 })
    expect(toPageSpace({ x: 20, y: 30, width: 600, height: 800 }, 90, 0, 0)).toEqual({ x: 620, y: 30 })
  })
})
