// Writes the document details someone chose (see details.ts) into a PDF. Kept apart from details.ts because it needs
// the PDF library, which only the export engine loads.
import type { PDFDocument } from '@cantoo/pdf-lib'
import { keywordList, type DocDetails } from './details'

/** Puts the non-empty details into the document's information dictionary. Empty ones are left out, not written as blanks. */
export function writeDetails(doc: PDFDocument, d: DocDetails | null | undefined) {
  if (!d) return
  if (d.title) doc.setTitle(d.title, { showInWindowTitleBar: true })
  if (d.author) doc.setAuthor(d.author)
  if (d.subject) doc.setSubject(d.subject)
  const keywords = keywordList(d.keywords)
  if (keywords.length) doc.setKeywords(keywords)
}
