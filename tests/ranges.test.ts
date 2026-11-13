// Page ranges as people type them.
import { describe, expect, it } from 'vitest'
import { RangeProblem, everyNth, formatRanges, parseGroups, parseRanges } from '../src/lib/ranges'

describe('reading page ranges', () => {
  it('reads single pages, ranges and a mixture', () => {
    expect(parseRanges('3', 10)).toEqual([2])
    expect(parseRanges('1-3', 10)).toEqual([0, 1, 2])
    expect(parseRanges('1-3, 7', 10)).toEqual([0, 1, 2, 6])
  })

  it('reads open-ended ranges: "8-" runs to the last page and "-3" starts at the first', () => {
    expect(parseRanges('8-', 10)).toEqual([7, 8, 9])
    expect(parseRanges('-3', 10)).toEqual([0, 1, 2])
  })

  it('is relaxed about spacing and separators', () => {
    for (const typed of ['1-3,7', ' 1 - 3 , 7 ', '1-3;7', '1-3 7', '1-3,\n7']) expect(parseRanges(typed, 10), typed).toEqual([0, 1, 2, 6])
  })

  it('accepts the dashes that phones and word processors type, and the word "to"', () => {
    for (const typed of ['1\u20133', '1\u20143', '1\u22123', '1 to 3', '1 TO 3']) expect(parseRanges(typed, 10), typed).toEqual([0, 1, 2])
  })

  it('treats a backwards range as the same pages', () => {
    expect(parseRanges('5-2', 10)).toEqual([1, 2, 3, 4])
  })

  it('lists each page once, in page order, however it was typed', () => {
    expect(parseRanges('7, 1-3, 2-4, 7', 10)).toEqual([0, 1, 2, 3, 6])
  })

  it('keeps groups separate and in the order typed, for splitting', () => {
    expect(parseGroups('4-5, 1-2, 9', 10)).toEqual([[3, 4], [0, 1], [8]])
  })
})

describe('explaining what is wrong with a range', () => {
  const problem = (typed: string, total = 9) => {
    try {
      parseRanges(typed, total)
    } catch (e) {
      expect(e).toBeInstanceOf(RangeProblem)
      return (e as Error).message
    }
    throw new Error(`"${typed}" was accepted`)
  }

  it('nothing typed', () => {
    expect(problem('')).toBe('Type some page numbers, like 1-3, 7.')
    expect(problem('  , ')).toBe('Type some page numbers, like 1-3, 7.')
  })

  it('a page that doesn’t exist, naming the page and the real count', () => {
    expect(problem('12')).toBe('There is no page 12. This document has 9 pages.')
    expect(problem('2-40')).toBe('There is no page 40. This document has 9 pages.')
    expect(problem('2', 1)).toBe('There is no page 2. This document has 1 page.')
  })

  it('page zero', () => {
    expect(problem('0')).toBe('Pages are numbered from 1.')
    expect(problem('0-3')).toBe('Pages are numbered from 1.')
  })

  it('something that isn’t a page at all, quoting it back', () => {
    expect(problem('1-3, abc')).toBe('“abc” isn’t a page or a range. Try something like 1-3, 7.')
    expect(problem('1.5')).toBe('“1.5” isn’t a page or a range. Try something like 1-3, 7.')
    expect(problem('-')).toBe('“-” isn’t a page or a range. Try something like 1-3, 7.')
    expect(problem('1-2-3')).toBe('“1-2-3” isn’t a page or a range. Try something like 1-3, 7.')
  })
})

describe('writing page ranges', () => {
  it('writes the shortest form', () => {
    expect(formatRanges([0, 1, 2, 6])).toBe('1-3, 7')
    expect(formatRanges([4])).toBe('5')
    expect(formatRanges([])).toBe('')
    expect(formatRanges([6, 2, 1, 0, 2])).toBe('1-3, 7')
  })

  it('round-trips with reading', () => {
    for (const pages of [[0], [0, 1, 2, 3], [1, 3, 5, 7], [0, 1, 4, 5, 9]]) expect(parseRanges(formatRanges(pages), 10)).toEqual(pages)
  })
})

describe('every Nth page', () => {
  it('odd, even, and every third from the third', () => {
    expect(everyNth(7, 2, 1)).toEqual([0, 2, 4, 6])
    expect(everyNth(7, 2, 2)).toEqual([1, 3, 5])
    expect(everyNth(10, 3, 3)).toEqual([2, 5, 8])
  })

  it('never loops forever on a silly step', () => {
    expect(everyNth(3, 0)).toEqual([0, 1, 2])
    expect(everyNth(3, -5)).toEqual([0, 1, 2])
  })
})
