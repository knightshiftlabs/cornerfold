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
})
