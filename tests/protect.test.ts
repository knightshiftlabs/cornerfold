import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { PDFDocument, PDFName } from '@cantoo/pdf-lib'
import { encryptWith, protectArgs, randomOwnerPassword, type Qpdf } from '../src/lib/protect'

// The real qpdf, as it ships, run under Node.
const create = createRequire(import.meta.url)('@neslinesli93/qpdf-wasm') as (o: object) => Promise<Qpdf>
const wasm = createRequire(import.meta.url).resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm')
const qpdf = () => create({ locateFile: () => wasm, noInitialRun: true, print: () => {}, printErr: () => {} })

async function sample() {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200]).drawText('secret words')
  return doc.save()
}
const pdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs')
const open = async (bytes: Uint8Array, password?: string) => {
  const { getDocument } = await pdfjs()
  const doc = await getDocument({ data: bytes.slice(), password, isEvalSupported: false, verbosity: 0 }).promise
  const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('')
  await doc.destroy()
  return text
}

describe('locking a file with a password', () => {
  it('needs the password to open, and keeps the words', async () => {
    const out = encryptWith(await qpdf(), await sample(), { password: 'correct horse' })
    await expect(open(out)).rejects.toMatchObject({ name: 'PasswordException' })
    await expect(open(out, 'wrong')).rejects.toMatchObject({ name: 'PasswordException' })
    expect(await open(out, 'correct horse')).toBe('secret words')
  })

  it('uses AES-256, and the words are not readable in the file', async () => {
    const out = encryptWith(await qpdf(), await sample(), { password: 'pw' })
    const enc = (await PDFDocument.load(out, { ignoreEncryption: true })).context.trailerInfo.Encrypt
    const dict = (await PDFDocument.load(out, { ignoreEncryption: true })).context.lookup(enc, (await import('@cantoo/pdf-lib')).PDFDict)
    expect(dict.get(PDFName.of('V'))?.toString()).toBe('5')
    expect(dict.get(PDFName.of('R'))?.toString()).toBe('6')
    expect(Buffer.from(out).includes(Buffer.from('secret words'))).toBe(false)
  })

  it.each(['-x', '--print=none', 'pässwörd 日本', `a b"c'd`, '@file.txt', '=weird='])('takes the password %j exactly as typed', async (password) => {
    const out = encryptWith(await qpdf(), await sample(), { password })
    expect(await open(out, password)).toBe('secret words')
  })

  it('records the restrictions that were asked for, and only those', async () => {
    const q = await qpdf()
    // Ask qpdf itself what the file allows.
    const asker = await qpdf()
    const allowed = (bytes: Uint8Array) => {
      asker.FS.writeFile('/c.pdf', bytes)
      asker.callMain(['--json', '--password=pw', '/c.pdf', '/c.json'])
      const { encrypt } = JSON.parse(new TextDecoder().decode(asker.FS.readFile('/c.json')))
      return encrypt.capabilities as Record<string, boolean>
    }
    expect(allowed(encryptWith(await qpdf(), await sample(), { password: 'pw' }))).toMatchObject({ printhigh: true, extract: true, modifyother: true })
    expect(allowed(encryptWith(await qpdf(), await sample(), { password: 'pw', blockPrinting: true, blockCopying: true, blockEditing: true }))).toMatchObject({ printhigh: false, extract: false, modifyother: false })
    expect(allowed(encryptWith(await qpdf(), await sample(), { password: 'pw', blockPrinting: true }))).toMatchObject({ printhigh: false, extract: true, modifyother: true })
    expect(allowed(encryptWith(await qpdf(), await sample(), { password: 'pw', blockCopying: true }))).toMatchObject({ printhigh: true, extract: false })
  })

  it('refuses an empty password, and gives each file its own owner password', () => {
    expect(() => protectArgs({ password: '' }, 'o', '/a', '/b')).toThrow('Choose a password')
    expect(randomOwnerPassword()).toHaveLength(48)
    expect(randomOwnerPassword()).not.toBe(randomOwnerPassword())
  })

  it('says so when qpdf cannot read the file, and leaves nothing behind', async () => {
    const q = await qpdf()
    expect(() => encryptWith(q, new TextEncoder().encode('not a pdf'), { password: 'pw' })).toThrow('could not be locked')
    expect(() => q.FS.readFile('/input.pdf')).toThrow()
  })
})
