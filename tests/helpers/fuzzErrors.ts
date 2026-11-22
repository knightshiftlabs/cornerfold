// The fuzz run tolerates the PDF libraries' own stray internal rejections on corrupt files (in a browser that is a
// console message with no effect). It must not tolerate anything that comes from Cornerfold's own code.
const PARSER_NAMES = /^(InvalidPDFException|FormatError|MissingPDFException|XRefParseException|ParserEOFException|AbortException|UnknownErrorException|PasswordException|UnexpectedResponseException)$/

export function classifyUnhandled(reason: unknown): 'parser' | 'app' {
  const e = reason as { name?: string; stack?: string; message?: string } | null
  const stack = String(e?.stack ?? '')
  // Anything that passed through Cornerfold's own source is ours to fix, whoever threw it first.
  if (/[\\/]src[\\/]/.test(stack)) return 'app'
  if (PARSER_NAMES.test(String(e?.name ?? ''))) return 'parser'
  if (/pdfjs-dist|@cantoo[\\/]pdf-lib|pdf\.mjs|pdf\.worker/.test(stack)) return 'parser'
  return 'app'
}
