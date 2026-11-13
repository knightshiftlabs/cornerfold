// Turning what pdf.js reads off a page into plain text with sensible line breaks.

export interface TextItem {
  str: string
  /** The text's position matrix; [4] and [5] are where it starts. */
  transform: number[]
  hasEOL?: boolean
}

/** Joins a page's pieces of text, starting a new line where the PDF does, or where the text moves to a new line. */
export function textFromItems(items: TextItem[]) {
  let out = ''
  let lastY: number | null = null
  for (const item of items) {
    const y = item.transform[5]
    if (lastY !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n') && item.str.trim()) out += '\n'
    out += item.str
    if (item.hasEOL) out += '\n'
    lastY = y
  }
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface PageText {
  page: number
  text: string
}

/** One text file for many pages, each under its own heading. */
export function combineText(pages: PageText[]) {
  const withText = pages.filter((p) => p.text.trim()).length
  const text = pages.map((p) => `--- Page ${p.page} ---\n\n${p.text.trim() || '(No text on this page.)'}`).join('\n\n') + '\n'
  return { text, withText, without: pages.length - withText }
}
