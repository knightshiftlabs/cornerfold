// Page ranges as people type them: "1-3, 7, 10-". Pages are numbered from 1 here and from 0 in the results.

/** A problem with what was typed, worded for the person who typed it. */
export class RangeProblem extends Error {}

const plural = (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`

/** Each item typed becomes one group of page indices, in the order typed: "1-3, 7" gives [[0, 1, 2], [6]]. */
export function parseGroups(text: string, total: number): number[][] {
  const tidy = text
    .replace(/[\u2010-\u2015\u2212]/g, '-') // the dashes phones and word processors type
    .replace(/\bto\b/gi, '-')
    .replace(/\s*-\s*/g, '-')
    .trim()
  const items = tidy.split(/[\s,;]+/).filter(Boolean)
  if (!items.length) throw new RangeProblem('Type some page numbers, like 1-3, 7.')

  return items.map((item) => {
    const single = /^\d+$/.test(item)
    const span = /^(\d*)-(\d*)$/.exec(item)
    if (!single && (!span || (!span[1] && !span[2]))) throw new RangeProblem(`“${item}” isn’t a page or a range. Try something like 1-3, 7.`)
    let from = single ? Number(item) : span![1] ? Number(span![1]) : 1
    let to = single ? from : span![2] ? Number(span![2]) : total
    if (from > to) [from, to] = [to, from] // "5-2" means the same pages as "2-5"
    if (from < 1) throw new RangeProblem('Pages are numbered from 1.')
    if (to > total) throw new RangeProblem(`There is no page ${to}. This document has ${plural(total)}.`)
    return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i)
  })
}

/** Every page mentioned, once each, in page order. */
export function parseRanges(text: string, total: number): number[] {
  return [...new Set(parseGroups(text, total).flat())].sort((a, b) => a - b)
}

/** The shortest way to write a set of pages: [0, 1, 2, 6] becomes "1-3, 7". */
export function formatRanges(indices: number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++
    parts.push(start === sorted[i] ? `${start + 1}` : `${start + 1}-${sorted[i] + 1}`)
  }
  return parts.join(', ')
}

/** Every `step`th page, starting at page `first` (numbered from 1): everyNth(10, 2, 1) is the odd pages. */
export function everyNth(total: number, step: number, first = 1): number[] {
  const out: number[] = []
  for (let page = first; page <= total; page += Math.max(1, Math.floor(step))) if (page >= 1) out.push(page - 1)
  return out
}
