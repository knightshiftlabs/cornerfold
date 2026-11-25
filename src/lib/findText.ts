// Finding words on a page and saying where they are, so they can be covered with redaction boxes. No browser or PDF
// library in here: the pieces of text come in as pdf.js reads them, and the page-specific parts (measuring text,
// turning a point into a place on the page) are handed in, so all of it can be tested on its own.

import type { Box } from './redactGeometry'

/** One run of text as pdf.js reads it from a page. */
export interface Piece {
  str: string
  /** The text's position matrix in the page's own units: [a, b, c, d, x, y] (x, y is where its baseline starts). */
  transform: number[]
  /** How far the run reaches along its baseline, and how tall it is, in the same units. */
  width: number
  height: number
  hasEOL?: boolean
  /** The font family pdf.js reports for the run, used only to measure the letters inside it. */
  family?: string
}

export interface FindOptions {
  matchCase?: boolean
  wholeWord?: boolean
}

export interface Hit {
  /** The words as they stand on the page. */
  text: string
  /** A few words either side, to recognise the place. */
  before: string
  after: string
  /** One box for each line the words sit on, as fractions of the page as it is seen. */
  boxes: Box[]
  /** Whether the words run left to right across the page as it is seen (so `snapToInk` may widen their boxes). */
  upright: boolean
  /** Whether the match starts / ends at the edge of a word, rather than part-way through one. */
  startsWord: boolean
  endsWord: boolean
}

/** How wide `str` is in some font, in any one unit: only the proportions matter. */
export type Measure = (str: string, piece: Piece) => number
/** Turns a point in the page's own units into a place on the page as it is seen, as fractions from its top left. */
export type ToFraction = (x: number, y: number) => [number, number]

/** More matches than this are not listed, so a search for "e" cannot swamp the screen. */
export const MAX_HITS = 500

const isLetter = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c)
const fold = (c: string) => {
  const l = c.toLowerCase()
  return l.length === 1 ? l : c // a few letters lower-case to two (İ), which would put every later position out
}

/**
 * The words matching `query` on one page. Whitespace of any kind and any amount matches any whitespace, a line
 * break counts as a space, and matching ignores capitals unless asked not to.
 */
export function findInPieces(pieces: readonly Piece[], query: string, options: FindOptions, measure: Measure, toFraction: ToFraction): Hit[] {
  const wanted = query.trim().replace(/\s+/gu, ' ')
  if (!wanted) return []

  // The page's text as one string, with where each letter came from.
  let text = ''
  const owner: number[] = [] // the piece each letter belongs to, or -1 for a space added between lines
  const offset: number[] = [] // the letter's place inside its piece
  let lastY: number | null = null
  let last: Piece | null = null
  const push = (c: string, piece: number, at: number) => {
    const space = /\s/u.test(c)
    if (space && (text === '' || text.endsWith(' '))) return
    text += space ? ' ' : c
    owner.push(space ? -1 : piece)
    offset.push(at)
  }
  pieces.forEach((p, i) => {
    const y = p.transform[5]
    if (lastY !== null && Math.abs(y - lastY) > 2 && p.str.trim()) push(' ', -1, 0)
    // Words on one line are often handed over as separate runs with no space between them, only a gap.
    else if (last && p.str.trim() && p.transform[0] > 0 && last.transform[0] > 0 && p.transform[4] - (last.transform[4] + last.width) > 0.15 * (p.height || 0)) push(' ', -1, 0)
    ;[...p.str].forEach((c, at) => push(c, i, at))
    if (p.hasEOL) push(' ', -1, 0)
    lastY = y
    last = p
  })

  // Positions are counted in letters (code points), as the loops above counted them.
  const letters = [...text]
  const hay = options.matchCase ? letters : letters.map(fold)
  const needle = [...wanted].map((c) => (options.matchCase ? c : fold(c)))
  const hits: Hit[] = []
  for (let from = 0; from <= hay.length - needle.length && hits.length < MAX_HITS; ) {
    let at = -1
    for (let i = from; i <= hay.length - needle.length; i++) {
      let ok = true
      for (let k = 0; k < needle.length; k++)
        if (hay[i + k] !== needle[k]) {
          ok = false
          break
        }
      if (ok) {
        at = i
        break
      }
    }
    if (at < 0) break
    const end = at + needle.length
    from = end
    if (options.wholeWord && (isLetter(letters[at - 1]) || isLetter(letters[end]))) {
      from = at + 1
      continue
    }
    const boxes = boxesFor(pieces, owner, offset, at, end, measure, toFraction)
    if (!boxes.length) continue
    hits.push({
      upright: uprightAt(pieces, owner, at, toFraction),
      startsWord: !isLetter(letters[at - 1]),
      endsWord: !isLetter(letters[end]),
      text: letters.slice(at, end).join(''),
      before: letters.slice(Math.max(0, at - 24), at).join('').trimStart(),
      after: letters.slice(end, end + 24).join('').trimEnd(),
      boxes: boxes.map((b) => b.box),
    })
  }
  return hits
}

/** Whether the first run of a match reads along the page's width rather than up or down it. */
function uprightAt(pieces: readonly Piece[], owner: number[], from: number, toFraction: ToFraction) {
  const p = owner.slice(from).find((o) => o >= 0)
  if (p === undefined) return true
  const [a, b, , , e, f] = pieces[p].transform
  const [x0, y0] = toFraction(e, f)
  const [x1, y1] = toFraction(e + a, f + b)
  return x1 > x0 && x1 - x0 > 3 * Math.abs(y1 - y0)
}

function boxesFor(pieces: readonly Piece[], owner: number[], offset: number[], from: number, to: number, measure: Measure, toFraction: ToFraction): { box: Box }[] {
  // For each piece the match touches, the first and last letter of it inside the match.
  const spans = new Map<number, [number, number]>()
  for (let i = from; i < to; i++) {
    const p = owner[i]
    if (p < 0) continue
    const span = spans.get(p)
    if (span) span[1] = offset[i] + 1
    else spans.set(p, [offset[i], offset[i] + 1])
  }
  const out: { box: Box }[] = []
  for (const [p, [i, j]] of spans) {
    const box = pieceBox(pieces[p], i, j, measure, toFraction)
    if (box) out.push({ box })
  }
  return out
}

/**
 * The box round letters `i` to `j` of a run. The letters' positions are worked out from their proportions in a
 * stand-in font, stretched to the run's real width, then the box is made a little roomy on every side so a
 * slightly different real font still ends up covered.
 */
function pieceBox(piece: Piece, i: number, j: number, measure: Measure, toFraction: ToFraction): Box | null {
  const [a, b, c, d, e, f] = piece.transform
  const letters = [...piece.str]
  if (!letters.length) return null
  const H = piece.height > 0 ? piece.height : Math.hypot(c, d)
  const W = piece.width > 0 ? piece.width : Math.hypot(a, b) * letters.length * 0.5
  if (!(H > 0) || !(W > 0)) return null
  const lenU = Math.hypot(a, b)
  const lenV = Math.hypot(c, d)
  const u = lenU > 0 ? [a / lenU, b / lenU] : [1, 0]
  const v = lenV > 0 ? [c / lenV, d / lenV] : [-u[1], u[0]]

  const total = measure(piece.str, piece)
  const share = (k: number) => (total > 0 ? measure(letters.slice(0, k).join(''), piece) / total : k / letters.length)
  // The ends of a run are known exactly. Inside it the letters' places are an estimate, so those edges get more room.
  const x0 = share(i) * W - (i === 0 ? 0.1 : 0.2) * H
  const x1 = share(j) * W + (j === letters.length ? 0.1 : 0.2) * H
  const below = -0.25 * H
  const above = 1.0 * H
  const at = (sx: number, sy: number) => toFraction(e + u[0] * sx + v[0] * sy, f + u[1] * sx + v[1] * sy)
  const corners = [at(x0, below), at(x1, below), at(x0, above), at(x1, above)]
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const left = Math.max(0, Math.min(...xs))
  const top = Math.max(0, Math.min(...ys))
  const right = Math.min(1, Math.max(...xs))
  const bottom = Math.min(1, Math.max(...ys))
  return right > left && bottom > top ? { x: left, y: top, w: right - left, h: bottom - top } : null
}

/** A picture of the page: RGBA bytes, as a canvas gives them. */
export interface Raster {
  data: ArrayLike<number>
  width: number
  height: number
}

/** How the two ends of a box are settled by `snapToInk`: out to the edge of the word, or just clear of the letter cut. */
export interface Snap {
  left: 'word' | 'letter'
  right: 'word' | 'letter'
}

/**
 * Widens a box sideways by looking at the page itself, so no part of a word is left showing beside it. Where words
 * are placed from their text the estimate is never exact (the page's real font is not the one used to measure it).
 * An end that is a word's edge is moved outward until clear space of a word gap's width lies beyond it, so a
 * letter or two missed by the estimate is picked up; an end part-way through a word only moves clear of the letter
 * it cuts. It grows by at most about one letter either way, and leaves an end alone when it already sits in clear space.
 */
export function snapToInk(box: Box, raster: Raster, snap: Snap = { left: 'letter', right: 'letter' }): Box {
  const { data, width, height } = raster
  const top = Math.max(0, Math.floor(box.y * height))
  const bottom = Math.min(height, Math.ceil((box.y + box.h) * height))
  const rows = bottom - top
  if (rows < 3) return box
  // The middle of the line only: underlines and ruled lines run through the top and bottom, and would look like letters.
  const y0 = top + Math.floor(rows * 0.3)
  const y1 = bottom - Math.floor(rows * 0.3)
  const lum = (x: number, y: number) => {
    const i = (y * width + x) * 4
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  let left = Math.max(0, Math.floor(box.x * width))
  let right = Math.min(width, Math.ceil((box.x + box.w) * width))
  if (right - left < 2) return box
  // What the paper looks like here, so light-on-dark text counts as ink too.
  const seen: number[] = []
  for (let y = y0; y < y1; y += 2) for (let x = Math.max(0, left - 8); x < Math.min(width, right + 8); x += 2) seen.push(lum(x, y))
  seen.sort((a, b) => a - b)
  const paper = seen[Math.floor(seen.length / 2)] ?? 255
  const inked = (x: number) => {
    if (x < 0 || x >= width) return false
    for (let y = y0; y < y1; y++) if (Math.abs(lum(x, y) - paper) > 60) return true
    return false
  }
  const room = Math.ceil(rows * 0.8)
  const gap = Math.max(2, Math.round(rows * 0.14)) // a word gap is wider than this, the space between letters is not
  /** Whether there is ink in the `n` columns from `x` going outward (direction `dir`). */
  const inkBeyond = (x: number, dir: 1 | -1, n: number) => {
    for (let k = 0; k < n; k++) if (inked(x + dir * k)) return true
    return false
  }
  /**
   * Moves a word-edge to the nearest place with clear space of a word gap's width just outside it. Outward moves are
   * preferred (a letter missed by the estimate is picked up), but when the estimate has run into the neighbouring
   * word the nearest gap is a little way inward, and the edge backs off to it instead of swallowing that word.
   */
  const toGap = (x: number, dir: 1 | -1) => {
    const outside = (at: number) => (dir < 0 ? at - 1 : at)
    for (let d = 0; d <= room; d++) {
      if (!inkBeyond(outside(x + dir * d), dir, gap)) return x + dir * d
      const back = Math.floor(d / 2) // moving in costs twice as much as moving out
      const at = x - dir * back
      if (back > 0 && at > 0 && at < width && !inkBeyond(outside(at), dir, gap)) return at
    }
    return x
  }
  if (snap.left === 'word') left = toGap(left, -1)
  else for (let grown = 0; grown < room && inked(left) && inked(left - 1); grown++) left--
  if (snap.right === 'word') right = toGap(right, 1)
  else for (let grown = 0; grown < room && inked(right - 1) && inked(right); grown++) right++
  if (right - left < 2) return box
  // One more pixel each side: the faint fringe of a letter's edge is lighter than what counts as ink.
  left = Math.max(0, left - 1)
  right = Math.min(width, right + 1)
  return { ...box, x: left / width, w: (right - left) / width }
}
