import { describe, expect, it } from 'vitest'
import { badRequest } from './e2e/guard'

const origin = 'http://127.0.0.1:4173'
const bad = (url: string, method = 'GET', hasBody = false) => badRequest(origin, { url, method, hasBody })

describe('the privacy guard in the browser tests', () => {
  it('lets the site fetch its own files, and blob and data addresses', () => {
    expect(bad(`${origin}/`)).toBeNull()
    expect(bad(`${origin}/assets/index-abc.js`)).toBeNull()
    expect(bad(`${origin}/assets/pdf.worker.min.mjs?url`, 'HEAD')).toBeNull()
    expect(bad('blob:http://127.0.0.1:4173/1234')).toBeNull()
    expect(bad('data:image/png;base64,AAAA')).toBeNull()
  })

  it('fails a request to another site', () => {
    expect(bad('https://evil.example/collect')).toMatch(/left the site/)
  })

  it('fails a look-alike address that only starts like the site (the old check let it through)', () => {
    expect(bad('http://127.0.0.1:4173.evil.example/x')).toMatch(/left the site/)
    expect(bad('http://127.0.0.1:41730/x')).toMatch(/left the site/)
  })

  it('fails anything the site sends to itself: a POST, a PUT, or a request carrying a body', () => {
    expect(bad(`${origin}/log`, 'POST')).toMatch(/POST/)
    expect(bad(`${origin}/log`, 'PUT')).toMatch(/PUT/)
    expect(bad(`${origin}/log`, 'GET', true)).toMatch(/body/)
  })

  it('fails a long query string, the other way to smuggle data out in an address', () => {
    expect(bad(`${origin}/x?d=${'a'.repeat(300)}`)).toMatch(/long query/)
  })

  it('fails data carried in the path of a request to the site, which the query check never saw', () => {
    const data = 'JVBERi0xLjQK'.repeat(20)
    expect(bad(`${origin}/collect/${data}`)).toMatch(/long path/)
    expect(bad(`${origin}/${encodeURIComponent('a b'.repeat(60))}`)).toMatch(/long path/)
  })

  it('with a list of the site’s real paths, fails a short path that is not one of them', () => {
    const known = (p: string) => ['/', '/assets/index-abc.js', '/privacy'].includes(p)
    const check = (url: string) => badRequest(origin, { url, method: 'GET', hasBody: false }, known)
    expect(check(`${origin}/privacy`)).toBeNull()
    expect(check(`${origin}/assets/index-abc.js?v=1`)).toBeNull()
    expect(check(`${origin}/c/Zm9v`)).toMatch(/does not have/)
    expect(check(`${origin}/privacy/Zm9v`)).toMatch(/does not have/)
  })
})
