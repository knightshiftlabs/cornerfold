import { describe, expect, it } from 'vitest'
import { reportHref } from '../src/lib/report'

const parse = (href: string) => {
  const url = new URL(href)
  return { to: url.pathname, subject: url.searchParams.get('subject'), body: url.searchParams.get('body') ?? '' }
}

describe('Report a problem link', () => {
  it('opens an email to the contact address', () => {
    const href = reportHref('1.2.3', 'TestBrowser/9.0')
    expect(href.startsWith('mailto:hello@cornerfold.org?')).toBe(true)
    expect(parse(href).subject).toBe('Cornerfold problem')
  })

  it('fills in the version and the browser, and nothing else', () => {
    const { body } = parse(reportHref('1.2.3', 'TestBrowser/9.0'))
    expect(body).toContain('Cornerfold 1.2.3')
    expect(body).toContain('Browser: TestBrowser/9.0')
    // Exactly these lines, so no document names, page counts or other details can slip in later.
    expect(body.split('\r\n').filter((l) => /^(Cornerfold|Browser)/.test(l))).toHaveLength(2)
  })

  it('invites the person to say what happened and to delete the details', () => {
    const { body } = parse(reportHref('1.0.0', 'X'))
    expect(body.startsWith('What happened?')).toBe(true)
    expect(body).toContain('You can delete the lines below before sending.')
  })

  it('is safely encoded, even for a strange browser name', () => {
    const href = reportHref('1.0.0', 'Odd & Browser "v1" <x>\nsecond line')
    expect(href).not.toMatch(/[\s"<>]/) // nothing that could break the link
    expect(parse(href).body).toContain('Odd & Browser "v1" <x>')
  })
})
