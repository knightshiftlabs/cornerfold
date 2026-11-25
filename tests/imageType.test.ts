// How Cornerfold decides that a file is a picture: the type the browser reports, else the file's ending.
import { describe, expect, it } from 'vitest'
import { imageType } from '../src/lib/imageType'

const f = (name: string, type: string) => ({ name, type })

describe('imageType', () => {
  it('uses the type the browser reports, whatever the ending says', () => {
    expect(imageType(f('a.webp', 'image/webp'))).toBe('image/webp')
    expect(imageType(f('a.png', 'image/jpeg'))).toBe('image/jpeg')
    expect(imageType(f('noending', 'image/png'))).toBe('image/png')
  })

  it('falls back to the ending when there is no type, or only the catch-all', () => {
    for (const [name, type] of [['a.webp', 'image/webp'], ['a.jpg', 'image/jpeg'], ['a.JPEG', 'image/jpeg'], ['a.png', 'image/png'], ['a.gif', 'image/gif'], ['a.bmp', 'image/bmp'], ['a.avif', 'image/avif'], ['a.HEIC', 'image/heic'], ['a.heif', 'image/heif']] as const) {
      expect(imageType(f(name, ''))).toBe(type)
      expect(imageType(f(name, 'application/octet-stream'))).toBe(type)
    }
  })

  it('is not fooled by files that are not pictures', () => {
    expect(imageType(f('notes.txt', ''))).toBe('')
    expect(imageType(f('a.docx', 'application/octet-stream'))).toBe('')
    expect(imageType(f('noending', ''))).toBe('')
    expect(imageType(f('archive.png.zip', ''))).toBe('')
  })

  it('does not override a type the browser gave that says it is something else', () => {
    expect(imageType(f('photo.png', 'text/plain'))).toBe('')
    expect(imageType(f('photo.jpg', 'application/pdf'))).toBe('')
  })
})
