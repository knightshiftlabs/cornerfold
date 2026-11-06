// Opening protected PDFs: every kind of encryption, wrong passwords, and what the unprotected copy is like.
import { describe, expect, it } from 'vitest'
import { PDFDocument } from '@cantoo/pdf-lib'
import { contains } from '../src/lib/bytes'
import { unlockPdf } from '../src/lib/unlock'
import { fixture, textPdf, unsupportedProtectionPdf } from './helpers/fixtures'
import { PASSWORD, STATEMENT_TEXT, lockedPdf } from './helpers/lockedSamples'

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
async function inspect(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise
  const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
  const permissions = await doc.getPermissions()
  const pages = doc.numPages
  await doc.destroy()
  return { pages, text, permissions }
}

describe.each(['aes256', 'aes128', 'rc4_128', 'rc4_40', 'objstm'] as const)('a password-protected PDF (%s)', (kind) => {
  it('says a password is needed when none is given, and rejects a wrong one', async () => {
    expect(await unlockPdf(lockedPdf(kind), '')).toEqual({ status: 'password-needed' })
    expect(await unlockPdf(lockedPdf(kind), 'not the password')).toEqual({ status: 'wrong-password' })
    expect(await unlockPdf(lockedPdf(kind), PASSWORD.toUpperCase())).toEqual({ status: 'wrong-password' }) // passwords are case-sensitive
  })

  it('opens with the right password, into a copy with no password and no restrictions', async () => {
    const original = lockedPdf(kind)
    const result = await unlockPdf(original, PASSWORD)
    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`)
    expect(result.restricted).toBe(true) // the original withheld editing and printing
    expect(contains(result.bytes, '/Encrypt')).toBe(false)
    const copy = await inspect(result.bytes) // opens in pdf.js with no password at all
    expect(copy).toMatchObject({ pages: 2, text: STATEMENT_TEXT, permissions: null })
    expect(contains(original, '/Encrypt')).toBe(true) // the original bytes were not touched
  })

  it('makes a copy that the PDF writer treats as an ordinary file, so it can be exported and compressed (regression: object-stream files)', async () => {
    const result = await unlockPdf(lockedPdf(kind), PASSWORD)
    if (result.status !== 'ok') throw new Error(result.status)
    const reloaded = await PDFDocument.load(result.bytes) // no password, no special options
    expect(reloaded.isEncrypted).toBe(false)
    expect(reloaded.getPageCount()).toBe(2)
    expect(await unlockPdf(result.bytes, '')).toEqual({ status: 'not-encrypted' }) // and unlocking it again finds nothing to unlock
  })
})

describe('a PDF that opens without a password', () => {
  it('that withholds permissions (common for bank statements): opens, and says it was restricted', async () => {
    const before = await inspect(lockedPdf('restricted'))
    expect(before.permissions).not.toBeNull()
    const result = await unlockPdf(lockedPdf('restricted'), '')
    if (result.status !== 'ok') throw new Error(result.status)
    expect(result.restricted).toBe(true)
    expect(await inspect(result.bytes)).toMatchObject({ pages: 2, text: STATEMENT_TEXT, permissions: null })
  })

  it('that is encrypted but withholds nothing: opens, and does not call it restricted', async () => {
    const result = await unlockPdf(lockedPdf('unrestricted'), '')
    if (result.status !== 'ok') throw new Error(result.status)
    expect(result.restricted).toBe(false)
    expect(contains(result.bytes, '/Encrypt')).toBe(false)
    expect((await PDFDocument.load(result.bytes)).isEncrypted).toBe(false)
  })

  it('the existing fixture files behave the same way', async () => {
    expect(await unlockPdf(fixture('password.pdf'), '')).toEqual({ status: 'password-needed' })
    expect(await unlockPdf(fixture('restricted.pdf'), '')).toMatchObject({ status: 'ok', restricted: true })
  })
})

describe('files that are not protected, or cannot be opened', () => {
  it('a normal PDF is reported as not encrypted', async () => {
    expect(await unlockPdf(await textPdf(2), '')).toEqual({ status: 'not-encrypted' })
  })

  it('a protection nobody here can open is called unsupported, not a wrong password', async () => {
    expect(await unlockPdf(await unsupportedProtectionPdf(), '')).toEqual({ status: 'unsupported' })
  })

  it('a damaged file still fails as a damaged file does', async () => {
    await expect(unlockPdf(fixture('not-a-pdf.pdf'), '')).rejects.toBeTruthy()
  })
})
