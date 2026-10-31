import { describe, expect, it } from 'vitest'
import { formatBytes, parseSize } from '../src/lib/format'

describe('parseSize: the custom size box', () => {
  it.each([
    ['300', 300],
    ['300kb', 300],
    ['300 KB', 300],
    ['1.5 MB', 1536],
    ['1,000 KB', 1000], // regression: commas used to be silently ignored
    ['2m', 2048],
    ['.5mb', 512],
    ['  250 k  ', 250],
    ['1,000,000', 1000000],
  ])('accepts %j as %i KB', (input, kb) => {
    expect(parseSize(input)).toEqual({ kb })
  })

  it.each(['abc', '-5', '1e9', '', '12 GB', '5 5', '1,5 MB', '300 k b'])('explains why %j is not a size', (input) => {
    const r = parseSize(input)
    expect(r).toHaveProperty('error')
    expect((r as { error: string }).error).toMatch(/size/i)
  })

  it('rejects sizes no PDF can reach, and absurdly large ones', () => {
    expect(parseSize('0')).toHaveProperty('error')
    expect(parseSize('5')).toHaveProperty('error')
    expect(parseSize('2000 mb')).toHaveProperty('error')
  })
})

describe('formatBytes', () => {
  it('shows whole numbers without a trailing .0', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB') // regression: used to show "1.0 MB"
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB')
  })
  it('uses KB below a megabyte and one decimal below 10 MB', () => {
    expect(formatBytes(200 * 1024)).toBe('200 KB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB')
    expect(formatBytes(10)).toBe('1 KB')
  })
})
