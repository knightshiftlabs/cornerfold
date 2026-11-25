// Document details (title, author, subject, keywords) that a person chooses to put in exported files. By default
// Cornerfold writes none, and carries none over from the files that went in; these are added only when asked for.
// No PDF library here, so the panel can use it without downloading one: the worker writes them (worker.ts).

export interface DocDetails {
  title: string
  author: string
  subject: string
  /** As typed: words or phrases separated by commas. */
  keywords: string
}

export const EMPTY_DETAILS: DocDetails = { title: '', author: '', subject: '', keywords: '' }

/** The longest any one detail may be. PDF readers show these in a single line. */
export const MAX_DETAIL = 500

/** Trimmed details, or null when every one is empty (which means: write none). */
export function cleanDetails(d: DocDetails): DocDetails | null {
  const out = { title: d.title.trim(), author: d.author.trim(), subject: d.subject.trim(), keywords: d.keywords.trim() }
  return Object.values(out).some(Boolean) ? out : null
}

/** The keywords as a list: split at commas, trimmed, empty ones and repeats dropped. */
export function keywordList(keywords: string) {
  return [...new Set(keywords.split(',').map((k) => k.trim()).filter(Boolean))]
}

/** What is wrong with these details, if anything. */
export function detailsProblem(d: DocDetails) {
  const long = (['title', 'author', 'subject', 'keywords'] as const).find((k) => d[k].length > MAX_DETAIL)
  return long ? `Keep each detail to ${MAX_DETAIL} characters or fewer.` : null
}
