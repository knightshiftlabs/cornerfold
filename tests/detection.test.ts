// What Cornerfold notices about a file when it's added: encryption, signatures, damage.
import { describe, expect, it } from 'vitest'
import { contains } from '../src/lib/bytes'
import { fixture, formPdf, scanPdf, textPdf } from './helpers/fixtures'

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const open = (bytes: Uint8Array) => pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise

describe('byte markers', () => {
  it('finds markers anywhere, and only real ones', () => {
    const b = new TextEncoder().encode('xx /Encrypt yy')
    expect(contains(b, '/Encrypt')).toBe(true)
    expect(contains(b, '/ByteRange')).toBe(false)
    expect(contains(new Uint8Array(), '/Encrypt')).toBe(false)
    expect(contains(new TextEncoder().encode('/Encryp'), '/Encrypt')).toBe(false)
  })
})

describe('encrypted PDFs', () => {
  it('tells "needs a password" apart from "opens but is restricted"', async () => {
    const password = fixture('password.pdf')
    const restricted = fixture('restricted.pdf')
    expect(contains(password, '/Encrypt')).toBe(true)
    expect(contains(restricted, '/Encrypt')).toBe(true)
    await expect(open(password)).rejects.toMatchObject({ name: 'PasswordException' })
    await expect(open(restricted)).resolves.toBeTruthy() // so the app shows the "editing restrictions" message
  })
})

describe('digital signatures', () => {
  it('flags the signed file and nothing else', async () => {
    expect(contains(fixture('signed.pdf'), '/ByteRange')).toBe(true)
    for (const bytes of [await formPdf(), await textPdf(), await scanPdf(1), fixture('restricted.pdf')]) {
      expect(contains(bytes, '/ByteRange')).toBe(false)
    }
  })
})

describe('damaged and fake files', () => {
  it('rejects a truncated PDF and a PNG renamed to .pdf', async () => {
    await expect(open(fixture('corrupted.pdf'))).rejects.toMatchObject({ name: 'InvalidPDFException' })
    await expect(open(fixture('not-a-pdf.pdf'))).rejects.toMatchObject({ name: 'InvalidPDFException' })
  })
})
