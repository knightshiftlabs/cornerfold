import { describe, expect, it } from 'vitest'
import { ExportTooBigError, MAX_ZIP_BYTES, checkZipBudget } from '../src/lib/exportBudget'

const MB = 1024 * 1024

describe('how big a ZIP may get', () => {
  it('lets a small export through', () => {
    expect(() => checkZipBudget(5, 20, 20 * MB, 'x')).not.toThrow()
  })

  it('stops early, after two parts, when the average says the whole will not fit', () => {
    expect(() => checkZipBudget(1, 100, 200 * MB, 'x')).not.toThrow() // one large page does not decide
    expect(() => checkZipBudget(2, 100, 20 * MB, 'x')).toThrow(ExportTooBigError) // 10 MB each, 1000 MB in all
  })

  it('stops at once when what is already made is over the limit', () => {
    expect(() => checkZipBudget(1, 2, MAX_ZIP_BYTES + 1, 'x')).toThrow(/more than this browser can safely build/)
  })

  it('says how much it would come to, and what to do about it', () => {
    expect(() => checkZipBudget(2, 100, 20 * MB, 'Save fewer pages at a time.')).toThrow(/about 1000 MB.*Save fewer pages at a time\./)
  })
})
