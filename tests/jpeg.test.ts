import { describe, expect, it } from 'vitest'
import jpeg from 'jpeg-js'
import { stripJpegMetadata } from '../src/lib/jpeg'
import { HIDDEN_STRINGS, sampleJpeg } from './helpers/jpegSamples'

const has = (b: Uint8Array, text: string) => Buffer.from(b).includes(Buffer.from(text, 'latin1'))
const pixels = (b: Uint8Array) => Buffer.from(jpeg.decode(Buffer.from(b)).data)

/** The marker of every segment before the picture data, e.g. ['e0', 'e1', 'db', 'c0'...]. */
function markers(b: Uint8Array) {
  const found: string[] = []
  let i = 2
  while (i + 3 < b.length && b[i] === 0xff && b[i + 1] !== 0xda) {
    found.push(b[i + 1].toString(16))
    i += 2 + ((b[i + 2] << 8) | b[i + 3])
  }
  return found
}

const NAMES = ['everything', 'progressive', 'cmyk'] as const

describe('removing a photo’s hidden details', () => {
  it('removes every kind of hidden data: camera, date, GPS, XMP, IPTC, comments, previews and trailing data', () => {
    const original = sampleJpeg('everything')
    for (const text of HIDDEN_STRINGS) expect(has(original, text), `the sample should contain ${text}`).toBe(true) // the test is meaningful
    const cleaned = stripJpegMetadata(original)!
    expect(cleaned).not.toBeNull()
    for (const text of HIDDEN_STRINGS) expect(has(cleaned, text), `${text} must be gone`).toBe(false)
    // no EXIF/XMP (e1), IPTC (ed), comment (fe) or MPF-style extra application data survives
    expect(markers(cleaned).filter((m) => ['e1', 'ed', 'fe'].includes(m))).toEqual([])
    expect(has(cleaned, 'MPF')).toBe(false)
  })

  it('leaves the picture itself bit-for-bit identical (nothing is re-encoded)', () => {
    for (const name of NAMES) {
      const original = sampleJpeg(name)
      const cleaned = stripJpegMetadata(original)!
      expect(pixels(cleaned), name).toEqual(pixels(original))
    }
  })

  it('keeps what the picture needs to look right: the JFIF header and the colour profile', () => {
    const cleaned = stripJpegMetadata(sampleJpeg('everything'))!
    expect(has(cleaned, 'JFIF')).toBe(true)
    expect(has(cleaned, 'ICC_PROFILE')).toBe(true)
  })

  it('keeps Adobe’s marker, which decides the colours of a CMYK photo', () => {
    const original = sampleJpeg('cmyk')
    const cleaned = stripJpegMetadata(original)!
    expect(has(cleaned, 'Adobe')).toBe(true)
    expect(has(cleaned, 'SecretComment')).toBe(false)
    expect(pixels(cleaned)).toEqual(pixels(original)) // colours identical
  })

  it('handles progressive JPEGs, which have several scans', () => {
    const original = sampleJpeg('progressive')
    expect(has(original, 'ExampleMake')).toBe(true)
    const cleaned = stripJpegMetadata(original)!
    expect(has(cleaned, 'Exif')).toBe(false)
    expect(has(cleaned, 'ExampleMake')).toBe(false)
    expect(pixels(cleaned)).toEqual(pixels(original))
  })

  it('drops anything after the end of the image, and ends properly', () => {
    const cleaned = stripJpegMetadata(sampleJpeg('everything'))!
    expect([cleaned[cleaned.length - 2], cleaned[cleaned.length - 1]]).toEqual([0xff, 0xd9])
    expect(has(cleaned, 'TRAILING-SECRET')).toBe(false)
    expect(cleaned.length).toBeLessThan(sampleJpeg('everything').length)
  })

  it('gives the same result when run twice', () => {
    const once = stripJpegMetadata(sampleJpeg('everything'))!
    expect(Buffer.compare(Buffer.from(stripJpegMetadata(once)!), Buffer.from(once))).toBe(0)
  })

  it('keeps a file that was cut off inside its picture data, closing it properly', () => {
    const whole = stripJpegMetadata(sampleJpeg('everything'))!
    const cutOff = whole.slice(0, whole.length - 6) // the end marker and a few bytes of picture data are missing
    const result = stripJpegMetadata(cutOff)!
    expect(result).not.toBeNull()
    expect([result[result.length - 2], result[result.length - 1]]).toEqual([0xff, 0xd9])
    expect(has(result, 'SecretXmpAuthor')).toBe(false)
  })

  it('gives up (so the caller redraws the picture) on anything it can’t read with certainty', () => {
    expect(stripJpegMetadata(new Uint8Array(0))).toBeNull()
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull() // header only
    expect(stripJpegMetadata(new TextEncoder().encode('%PDF-1.7 not a photo'))).toBeNull()
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x04, 0x61, 0x62, 0xff, 0xd9]))).toBeNull() // no picture in it
    const broken = sampleJpeg('everything').slice()
    broken[4] = 0xff // the first segment now claims to be longer than the file
    broken[5] = 0xff
    expect(stripJpegMetadata(broken)).toBeNull()
  })
})
