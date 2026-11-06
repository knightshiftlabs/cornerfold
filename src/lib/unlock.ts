// Opening PDFs that are protected. Runs inside the PDF engine's worker, never on the page.
// A password is used once, to decrypt a copy of the file in memory. Nothing is stored or sent.
import { PDFDict, PDFDocument, PDFInvalidObject, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream } from '@cantoo/pdf-lib'

export type UnlockResult =
  | { status: 'not-encrypted' }
  | { status: 'password-needed' }
  | { status: 'wrong-password' }
  | { status: 'unsupported' }
  | { status: 'ok'; bytes: Uint8Array; restricted: boolean }

/** The permissions a PDF can withhold: print (3), modify (4), copy (5), annotate (6), fill forms (9), accessibility (10), assemble (11), print at full quality (12). */
const PERMISSIONS = 0xf3c

/**
 * Tries to open `bytes` with `password` (use '' to find out whether none is needed). On success it returns an
 * unprotected copy: no password and none of the original's restrictions. `restricted` says whether the
 * original withheld any permission. A file that is damaged throws, as any damaged file does.
 */
export async function unlockPdf(bytes: Uint8Array, password: string): Promise<UnlockResult> {
  // Look at the file without decrypting it, to learn whether it is protected and what it restricts.
  const probe = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  if (!probe.isEncrypted) return { status: 'not-encrypted' }
  const flags = probe.context.lookup(probe.context.trailerInfo.Encrypt, PDFDict)?.get(PDFName.of('P'))
  const restricted = flags instanceof PDFNumber ? (flags.asNumber() & PERMISSIONS) !== PERMISSIONS : false
  try {
    const doc = await PDFDocument.load(bytes, { password, updateMetadata: false })
    dropProtectionLeftovers(doc, probe.context.trailerInfo.Encrypt)
    return { status: 'ok', bytes: await doc.save(), restricted }
  } catch (e) {
    const text = e instanceof Error ? e.message : ''
    if (/needs password/i.test(text)) return { status: 'password-needed' }
    if (/password incorrect/i.test(text)) return { status: 'wrong-password' }
    return { status: 'unsupported' } // some other kind of protection, such as one that needs a certificate
  }
}

const latin1 = new TextDecoder('latin1')
const objectType = (obj: unknown) =>
  obj instanceof PDFStream || obj instanceof PDFRawStream ? (obj as PDFStream).dict.get(PDFName.of('Type')) : undefined

/**
 * Decrypting leaves traces of the old protection inside the document: its settings, and, for files that keep
 * their index in a compressed stream, the original index itself (kept as raw bytes, and still naming the
 * settings) and the packed object streams (whose contents are already unpacked). Left in, they would make
 * the copy look protected to anything that reads it, so the PDF writer would refuse to open it again.
 */
function dropProtectionLeftovers(doc: PDFDocument, settings: unknown) {
  if (settings instanceof PDFRef) doc.context.delete(settings)
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    // PDFInvalidObject keeps the raw bytes it couldn't parse in a field its types mark private.
    const oldIndex = obj instanceof PDFInvalidObject && latin1.decode((obj as unknown as { data: Uint8Array }).data).includes('/XRef')
    if (oldIndex || objectType(obj) === PDFName.of('ObjStm')) doc.context.delete(ref)
  }
}
