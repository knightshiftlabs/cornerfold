import type { UnlockResult } from './unlock'
import { useStore, type Page, type Source } from './store'
import { EngineError, openPdf } from './pdf'
import { contains } from './bytes'
import { stage } from './motion'
import { getWorker, unlockInWorker } from './engine'
import { askRestricted, questionsFor } from './passwords'
import { stripJpegMetadata } from './jpeg'
import { imageType } from './imageType'
import { ImageTooLargeError, UNKNOWN_PICTURE_PIXELS, admit, decodeBudget } from './imageLimits'

const uid = () => crypto.randomUUID()
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

const isImage = (f: File) => imageType(f) !== ''
const stem = (name: string) => name.replace(/\.[^.]+$/, '') || 'file'

class UnlockDeclined extends Error {} // the person chose to skip a locked file
class UnsupportedProtectionError extends Error {}
class EmptyError extends Error {}
class UnsupportedImageError extends Error {
  constructor(readonly heic: boolean) {
    super()
  }
}
const isHeic = (f: File) => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name)

/** How many files are read at once. Reading all of them together would hold every one in memory at the same time. */
const READ_AT_ONCE = 3

/** Like Promise.all over a list, but with at most `limit` running at a time. Results keep the list's order. */
async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await work(items[i])
      }
    }),
  )
  return results
}

/** Names the files that can't be used, so someone who dropped a whole folder knows which ones. */
export function notUsable(names: string[]) {
  if (names.length === 1) return `${names[0]} isn’t a PDF or an image.`
  if (names.length === 2) return `${names[0]} and ${names[1]} aren’t PDFs or images.`
  return `${names[0]} and ${names.length - 1} more files aren’t PDFs or images.`
}

export async function ingestFiles(files: File[]) {
  const st = useStore.getState()
  const usable = files.filter((f) => isPdf(f) || isImage(f))
  const skipped = files.filter((f) => !usable.includes(f)).map((f) => f.name)

  if (!usable.length) {
    if (skipped.length) st.notify(notUsable(skipped), { tone: 'error' })
    return
  }

  st.setBusy(usable.length === 1 ? 'Reading file' : `Reading ${usable.length} files`)
  const problems: string[] = []
  const signed: string[] = []
  const declined: string[] = []
  const results = await mapLimit(usable, READ_AT_ONCE, (f) =>
    readFile(f).catch((e: unknown) => {
      if (e instanceof UnlockDeclined) declined.push(f.name)
      else problems.push(describe(f, e))
      return null
    }),
  )
  st.setBusy(null)

  const sources: Source[] = []
  const pages: Page[] = []
  for (const r of results) {
    if (!r) continue
    sources.push(r.source)
    pages.push(...r.pages)
    if (r.signed) signed.push(r.fileName)
  }
  if (pages.length) {
    stage(pages.map((p) => p.id))
    st.addPages(sources, pages)
    getWorker() // normally already running; started at load
  }

  if (problems.length) {
    st.notify(problems.length === 1 ? problems[0] : `${problems[0]} ${problems.length - 1} more couldn’t be added.`, { tone: 'error' })
  } else if (signed.length) {
    st.notify(
      `${signed.length === 1 ? `${signed[0]} is` : `${signed.length} of these files are`} digitally signed. Any change, even compressing, will make the signature invalid, though the pages will look the same.`,
      { tone: 'error' },
    )
  } else if (declined.length) {
    st.notify(`${declined.length === 1 ? declined[0] : `${declined.length} files`} ${declined.length === 1 ? 'was' : 'were'} skipped because ${declined.length === 1 ? 'it’s' : 'they’re'} still locked.`)
  } else if (skipped.length) {
    st.notify(notUsable(skipped), { tone: 'error' })
  }
}

async function readFile(f: File): Promise<{ source: Source; pages: Page[]; signed: boolean; fileName: string }> {
  const id = uid()
  if (!f.size) throw new EmptyError()
  if (isPdf(f)) {
    const original = new Uint8Array(await f.arrayBuffer())
    // Protected PDFs are opened with the password the person types, into a copy with no password and no restrictions.
    const bytes = contains(original, '/Encrypt') ? await unlockFile(f.name, original) : original
    const doc = await openPdf(id, bytes)
    return {
      source: { id, name: stem(f.name), kind: 'pdf', bytes, pageCount: doc.numPages },
      pages: Array.from({ length: doc.numPages }, (_, index) => ({ id: uid(), sourceId: id, index, rotation: 0 })),
      signed: contains(bytes, '/ByteRange'), // every digital signature records the byte range it covers
      fileName: f.name,
    }
  }
  let img
  try {
    img = await normalizeImage(f)
  } catch (e) {
    if (e instanceof ImageTooLargeError) throw e
    throw new UnsupportedImageError(isHeic(f))
  }
  return {
    source: { id, name: stem(f.name), kind: 'image', pageCount: 1, ...img },
    pages: [{ id: uid(), sourceId: id, index: 0, rotation: 0 }],
    signed: false,
    fileName: f.name,
  }
}

/**
 * Returns the bytes of an unprotected copy. Files that open without a password and restrict nothing are
 * used as they are. A file that opens without one but withholds permissions (common for bank statements)
 * needs the person's agreement first. A file that needs a password asks for it, as often as it takes.
 */
async function unlockFile(name: string, bytes: Uint8Array): Promise<Uint8Array> {
  let result = await unlockInWorker(bytes, '')
  if (result.status === 'not-encrypted') return bytes
  if (result.status === 'ok') {
    if (result.restricted && !(await askRestricted(name))) throw new UnlockDeclined()
    return result.bytes
  }
  // All tries for this file are one turn, so the dialog stays up while each password is checked.
  const first = result
  return questionsFor(name, async (ask) => {
    let tried: UnlockResult = first
    let wrong = false
    while (tried.status === 'password-needed' || tried.status === 'wrong-password') {
      const password = await ask.password(wrong)
      if (password === null) throw new UnlockDeclined()
      tried = await unlockInWorker(bytes, password)
      if (tried.status === 'ok') return tried.bytes
      wrong = true
    }
    throw new UnsupportedProtectionError()
  })
}

function describe(f: File, e: unknown) {
  if (e instanceof EmptyError) return `${f.name} is empty.`
  if (e instanceof ImageTooLargeError) return `${f.name} is ${Math.round(e.pixels / 1e6)} megapixels, more than Cornerfold can open safely here (the limit is ${Math.round(e.limit / 1e6)}). Make it smaller first and add it again.`
  if (e instanceof UnsupportedProtectionError) return `${f.name} uses a kind of protection Cornerfold can’t open, such as one that needs a certificate.`
  if (e instanceof UnsupportedImageError)
    return e.heic
      ? `${f.name} is an iPhone photo (HEIC), which this browser can’t open. Share it as a JPEG instead, or set your iPhone camera to “Most Compatible”.`
      : `${f.name} is in an image format this browser can’t open. Try a JPEG or PNG.`
  if (e instanceof EngineError) return 'Cornerfold was updated while this tab was open. Reload the page, then add your files again.'
  return `Couldn’t read ${f.name}. It may be damaged, or it may not really be a PDF.`
}


/**
 * PNGs go in as they are (the PDF writer keeps only their pixels). An upright JPEG goes in without being
 * re-encoded, but first loses the hidden details a photo carries: camera, date, GPS location, previews and
 * comments. Rotated phone photos (EXIF orientation), JPEGs that can't be cleaned that way, and other formats
 * are redrawn upright, which drops those details too.
 */
/** Whether a picture has see-through parts, judged from a small copy of it. */
function hasTransparency(bmp: ImageBitmap) {
  const scale = Math.min(1, 256 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * scale))
  c.height = Math.max(1, Math.round(bmp.height * scale))
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  const alpha = ctx.getImageData(0, 0, c.width, c.height).data
  c.width = c.height = 0
  for (let i = 3; i < alpha.length; i += 4) if (alpha[i] < 250) return true
  return false
}

async function normalizeImage(f: File) {
  const buf = await f.arrayBuffer()
  // The size is in the file's header, so a picture that claims to be enormous is refused before anything is decoded,
  // and the ones that are let through take turns, so only a few million pixels are being decoded at any moment.
  const pixels = admit(new Uint8Array(buf)) ?? UNKNOWN_PICTURE_PIXELS
  return decodeBudget.use(pixels, () => decodeImage(f, buf))
}

async function decodeImage(f: File, buf: ArrayBuffer) {
  const type = imageType(f)
  const jpeg = type === 'image/jpeg'
  const png = type === 'image/png'
  const cleaned = jpeg ? stripJpegMetadata(new Uint8Array(buf)) : null

  if (png || (cleaned && jpegOrientation(buf) <= 1)) {
    const bmp = await createImageBitmap(new Blob([buf], { type }))
    const { width, height } = bmp
    bmp.close()
    return { bytes: cleaned ?? new Uint8Array(buf), mime: type as 'image/png' | 'image/jpeg', width, height }
  }

  const bmp = await createImageBitmap(new Blob([buf], { type }), { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  let keepAlpha = false
  try {
    // Other formats (WebP, AVIF, GIF, BMP) become JPEG, as a photo saved as PNG would be many times larger,
    // unless they have see-through parts, which only PNG keeps. An animated GIF gives its first frame.
    keepAlpha = !jpeg && hasTransparency(bmp)
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')!
    if (!keepAlpha) {
      ctx.fillStyle = '#fff' // anything faintly see-through sits on white paper, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(bmp, 0, 0)
  } finally {
    bmp.close() // whether or not drawing worked
  }
  const mime = keepAlpha ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Encode failed'))), mime, 0.92))
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: mime as 'image/png' | 'image/jpeg', width: canvas.width, height: canvas.height }
}

export function jpegOrientation(buf: ArrayBuffer): number {
  try {
    const v = new DataView(buf)
    if (v.getUint16(0) !== 0xffd8) return 1
    let off = 2
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off)
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
        const tiff = off + 10
        const little = v.getUint16(tiff) === 0x4949
        const ifd = tiff + v.getUint32(tiff + 4, little)
        const count = v.getUint16(ifd, little)
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12
          if (v.getUint16(entry, little) === 0x0112) return v.getUint16(entry + 8, little)
        }
        return 1
      }
      if ((marker & 0xff00) !== 0xff00) return 1
      off += 2 + v.getUint16(off + 2)
    }
  } catch {
    /* malformed header: treat as upright */
  }
  return 1
}
