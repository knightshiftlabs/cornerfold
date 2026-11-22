import { describe, expect, it } from 'vitest'
import { classifyUnhandled } from './helpers/fuzzErrors'

const err = (name: string, stack: string) => Object.assign(new Error('x'), { name, stack })

describe('which stray errors the fuzz run may ignore', () => {
  it('ignores the PDF libraries’ own rejections', () => {
    expect(classifyUnhandled(err('InvalidPDFException', 'at x (node_modules/pdfjs-dist/legacy/build/pdf.mjs:1:1)'))).toBe('parser')
    expect(classifyUnhandled(err('Error', 'at y (node_modules/@cantoo/pdf-lib/cjs/core/parser.js:9:9)'))).toBe('parser')
    expect(classifyUnhandled(err('FormatError', ''))).toBe('parser')
  })
  it('never ignores an error that passed through Cornerfold’s own code', () => {
    expect(classifyUnhandled(err('TypeError', 'at f (/work/cornerfold/src/lib/worker.ts:10:3)\n at node_modules/pdfjs-dist/legacy/build/pdf.mjs:1:1'))).toBe('app')
    expect(classifyUnhandled(err('TypeError', 'at f (C:\\w\\cornerfold\\src\\lib\\ingest.ts:3:1)'))).toBe('app')
  })
  it('does not ignore an unknown error', () => {
    expect(classifyUnhandled(new Error('boom'))).toBe('app')
    expect(classifyUnhandled('a string')).toBe('app')
    expect(classifyUnhandled(undefined)).toBe('app')
  })
})
