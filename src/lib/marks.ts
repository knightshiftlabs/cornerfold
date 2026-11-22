// What Fill and sign adds on top of a page: text, a signature (or any picture), a tick or a cross. No PDF
// library here, so the interface can use it too; the engine draws marks with markDraw.ts.

/**
 * Positions and sizes are fractions of the page as it looks before any turn added in Cornerfold, measured from
 * its top left. A page's own built-in turn counts, so a mark sits where it was put on the page as it appears;
 * a turn added later turns the mark with the page's content, like ink on paper.
 */
export type Mark =
  | { id: string; kind: 'text'; x: number; y: number; text: string; /** In points. */ size: number }
  | { id: string; kind: 'image'; x: number; y: number; w: number; h: number; imageId: string }
  | { id: string; kind: 'tick' | 'cross'; x: number; y: number; /** In points. */ size: number }
  /** An area to black out for good. It is never drawn as a mark: exporting burns it into the page picture (lib/redact.ts). */
  | { id: string; kind: 'redact'; x: number; y: number; w: number; h: number }

/** A picture used by image marks, such as a drawn signature: a PNG with see-through background. */
export interface MarkImage {
  id: string
  png: Uint8Array
  width: number
  height: number
}

/** A form field's answer: text, or whether a box is ticked. Radio buttons and lists hold the chosen option. */
export type FieldValue = string | boolean

/** The line height used for several lines of text, as a multiple of the size. */
export const LINE_HEIGHT = 1.25
/** How far a line of Helvetica rises above where it sits, as a multiple of the size. */
export const ASCENT = 0.8

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** The areas a page's redactions cover, as fractions of the page like every mark. */
export const redactionsOf = (marks: readonly Mark[] | undefined) =>
  (marks ?? []).flatMap((m) => (m.kind === 'redact' ? [{ x: m.x, y: m.y, w: m.w, h: m.h }] : []))
export const hasRedactions = (marks: readonly Mark[] | undefined) => (marks ?? []).some((m) => m.kind === 'redact')
