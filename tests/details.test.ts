// Document details: what is written, and that nothing is written unless asked for.
import { describe, expect, it } from 'vitest'
import { PDFDocument } from '@cantoo/pdf-lib'
import { EMPTY_DETAILS, MAX_DETAIL, cleanDetails, detailsProblem, keywordList } from '../src/lib/details'
import { writeDetails } from '../src/lib/detailsWrite'

const roundTrip = async (d: Parameters<typeof writeDetails>[1]) => {
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.addPage([100, 100])
  writeDetails(doc, d)
  const back = await PDFDocument.load(await doc.save(), { updateMetadata: false })
  return { title: back.getTitle(), author: back.getAuthor(), subject: back.getSubject(), keywords: back.getKeywords(), producer: back.getProducer(), creator: back.getCreator() }
}

describe('document details', () => {
  it('trims what was typed, and counts all-empty as none', () => {
    expect(cleanDetails(EMPTY_DETAILS)).toBeNull()
    expect(cleanDetails({ title: '  ', author: '\t', subject: '', keywords: ' ' })).toBeNull()
    expect(cleanDetails({ title: ' Lease ', author: '', subject: '', keywords: '' })).toEqual({ title: 'Lease', author: '', subject: '', keywords: '' })
  })

  it('splits keywords at commas, dropping blanks and repeats', () => {
    expect(keywordList('lease, 2026 ,, flat 3, lease')).toEqual(['lease', '2026', 'flat 3'])
    expect(keywordList('')).toEqual([])
  })

  it('refuses a detail that is too long to show', () => {
    expect(detailsProblem({ ...EMPTY_DETAILS, title: 'x'.repeat(MAX_DETAIL) })).toBeNull()
    expect(detailsProblem({ ...EMPTY_DETAILS, author: 'x'.repeat(MAX_DETAIL + 1) })).toMatch(/or fewer/)
  })

  it('writes the chosen details, in any script, and nothing else: no producer or creator', async () => {
    expect(await roundTrip({ title: 'Lease — flat 3', author: 'अनु', subject: '契約', keywords: 'lease, 2026' })).toEqual({
      title: 'Lease — flat 3',
      author: 'अनु',
      subject: '契約',
      keywords: 'lease 2026',
      producer: undefined,
      creator: undefined,
    })
  })

  it('leaves empty details out instead of writing blanks, and writes nothing at all when there are none', async () => {
    expect(await roundTrip({ title: 'Only a title', author: '', subject: '', keywords: '' })).toMatchObject({ title: 'Only a title', author: undefined, subject: undefined, keywords: undefined })
    expect(await roundTrip(null)).toMatchObject({ title: undefined, author: undefined, subject: undefined, keywords: undefined })
  })
})
