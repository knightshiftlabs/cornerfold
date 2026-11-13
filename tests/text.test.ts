// Turning what pdf.js reads off a page into plain text.
import { describe, expect, it } from 'vitest'
import { combineText, textFromItems } from '../src/lib/text'

const at = (str: string, y: number, hasEOL = false) => ({ str, transform: [1, 0, 0, 1, 50, y], hasEOL })

describe('joining the text on a page', () => {
  it('keeps the PDF’s own line ends', () => {
    expect(textFromItems([at('Hello', 700, true), at('World', 686)])).toBe('Hello\nWorld')
  })

  it('starts a new line when the text moves down, even without a line-end mark', () => {
    expect(textFromItems([at('First line', 700), at('Second line', 680)])).toBe('First line\nSecond line')
  })

  it('keeps pieces of the same line together', () => {
    expect(textFromItems([at('Total: ', 500), at('₹4,250', 500.4)])).toBe('Total: ₹4,250')
  })

  it('tidies trailing spaces and runs of blank lines', () => {
    expect(textFromItems([at('A   ', 700, true), at('', 690, true), at('', 680, true), at('', 670, true), at('B', 660)])).toBe('A\n\nB')
  })

  it('an empty page is an empty string', () => {
    expect(textFromItems([])).toBe('')
  })
})

describe('one file for many pages', () => {
  it('puts each page under a heading, says which pages had none, and counts them', () => {
    const r = combineText([{ page: 1, text: 'Hello' }, { page: 2, text: '  ' }, { page: 3, text: 'Bye' }])
    expect(r.text).toBe('--- Page 1 ---\n\nHello\n\n--- Page 2 ---\n\n(No text on this page.)\n\n--- Page 3 ---\n\nBye\n')
    expect([r.withText, r.without]).toEqual([2, 1])
  })
})
