// The rule behind the privacy guard in fixtures.ts, kept apart from the browser so it can be tested on its own
// (tests/guard.test.ts). A request is fine if it stays on the site and only asks for something: the app is a
// static site and has no reason to send anything, even to itself. Anything else is reported.
export function badRequest(origin: string, r: { url: string; method: string; hasBody: boolean }): string | null {
  const { url, method, hasBody } = r
  if (url.startsWith('blob:') || url.startsWith('data:')) return null
  if (!url.startsWith(origin + '/') && url !== origin) return `request left the site: ${url}`
  if (method !== 'GET' && method !== 'HEAD') return `the site sent a ${method} to itself: ${url}`
  if (hasBody) return `a request to the site carried a body: ${url}`
  if (new URL(url).search.length > 200) return `a request to the site carried a long query: ${url.slice(0, 80)}…`
  return null
}
