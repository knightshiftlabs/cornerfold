# Cornerfold

PDF tools that never see your files. Merge, split, compress, reorder and rotate PDFs and images entirely in the browser: nothing uploaded, no tracking, no account.

Live at https://cornerfold.org

**Pillars:** private (files never leave the device), a UI people enjoy, no ads.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

## Deploy (Cloudflare Pages)

Connect the repo, set build command `npm test && npm run build` (so failing code is never deployed) and output directory `dist`. `public/_headers` ships the security headers, including the CSP. After deploying, open DevTools, go to Network, add files and export: you should see zero requests carrying file data. Leave Cloudflare Web Analytics switched off.

Firebase Hosting works too; move the headers from `_headers` into `firebase.json`.

## How it works

The whole v1 is one idea: every tool is "arrange a list of pages, then write it out". Merge, split, reorder, rotate, delete, extract and images-to-PDF are all the same workspace, so there is no tool picker and no page reloads.

`src/lib/store.ts` holds the page list. Every edit goes through `commit()`, so everything is undoable (100 steps).

`src/lib/ingest.ts` reads dropped, picked or pasted files. An upright JPEG is embedded without being re-encoded, after `src/lib/jpeg.ts` strips the hidden details a photo carries (camera, date, GPS location, previews, comments); PNGs go in as they are, and the PDF writer keeps only their pixels. Rotated phone photos are redrawn upright using their EXIF orientation, which drops those details too. Protected PDFs are opened with the password the person types: `src/lib/passwords.ts` asks for it, one file at a time, and `src/lib/unlock.ts` decrypts a copy inside the worker into a file with no password and no restrictions. The password is never stored.

`src/lib/compress.ts` keeps its memory in check: decoded pictures are cached only up to a budget (48 million pixels by default, less on devices that report little memory), anything over the budget is freed the moment it has been used, compressed pictures are cached up to a byte budget, and jobs take turns. Output is byte-for-byte the same whatever the budget; only speed changes. `src/lib/ingest.ts` reads at most three files at a time. When fields of merged forms share a name, `src/lib/worker.ts` numbers the later ones (`name`, `name_2`) so copies of a form stay independent.

`src/lib/pdf.ts` renders thumbnails with pdf.js only when a card scrolls near view, three at a time, cached per session. pdf.js is lazy-loaded and prefetched on idle, so first paint is about 72 KB of gzipped JS.

`src/lib/worker.ts` builds output PDFs with `@cantoo/pdf-lib` (a maintained fork of pdf-lib) in a Web Worker, so the UI never freezes on big files. Each source's pages are copied in a single call so shared fonts and images are embedded once. Source bytes cross into the worker once per file. Outputs contain no author, creator or producer metadata.

## Privacy guarantees, and what enforces each one

Files never leave the device: the app contains no code that uploads documents or sends their contents anywhere. As a second safeguard, the CSP restricts connections to the site's own origin and blocks the common ways a page talks to third-party servers; it narrows what misbehaving code could do, but it isn't a guarantee against every possible technique. No third parties: fonts and the pdf.js worker are bundled and self-hosted, and the CSP allows only `'self'`. No cookies or analytics, so no consent banner is needed. It works offline: the service worker precaches the app after the first visit. Metadata is stripped: `updateMetadata: false` on output documents.

The remaining personal data is the host's IP logs. Disclose them in the privacy policy and keep the host's DPA on file.

## Testing

`npm test` runs the full automated suite (about 20 seconds); `npm run test:fuzz` fuzzes the PDF engines with randomly corrupted files (400 per run by default, more with `FUZZ_ITERATIONS`): the export engine, compression, file
detection, size parsing, editing and undo, and the interface in a simulated browser. See
`tests/README.md` for what each file covers and the rules for adding tests.

**On GitHub:** every push runs the tests and the build on a clean Linux machine (`.github/workflows/ci.yml`). A red cross next to a commit means something broke. Cloudflare also runs the tests before every build (`npm test && npm run build`), so a commit with failing tests is not deployed. Security reports: see `SECURITY.md`.

**Release criteria:** no release unless `npm test` passes and the production build succeeds. This is
enforced: `npm version patch`, `minor` or `major` runs both first and stops, with no version bump and
no tag, if either fails. Every bug fix gets a regression test. Releases that touch
file handling also get a run through the torture-test pack's manual checklist.

## Versioning and releases

Cornerfold follows [Semantic Versioning](https://semver.org). For an app people use rather than code people import, that means: a **major** version (2.0.0) for changes that alter how people work with it or remove something they relied on; a **minor** version (1.1.0) for new tools or features; a **patch** version (1.0.1) for fixes.

`CHANGELOG.md` is the single source of truth. Every build turns it into the public page at `/changes.html`, so never edit that page directly.

While working, add each user-facing change under `## [Unreleased]`, in plain language a user would understand. To release:

1. In `CHANGELOG.md`, rename `## [Unreleased]` to the new version with **TBD** as its date, e.g. `## [1.1.0] - TBD`, and add a fresh empty `## [Unreleased]` above it. **Don't type a date.** The release command writes it (step 3), because a hand-typed date in the public release history is easy to get wrong.
2. Commit that: `git add .` then `git commit -m "Changelog for 1.1.0"`.
3. Bump the version: `npm version 1.1.0 -m "Release %s"`. This runs the tests and the production build first (if anything fails, nothing is released), bumps the version, then **stamps today's date in India time** (`scripts/stamp-date.mjs`) into the changelog entry, and into the "Last updated" line of the privacy policy and terms **only if that page's text changed since the last release**, and finally commits and tags. It stops if the clock is earlier than the previous release's date. To release under a different date, set it for that one command: in PowerShell, `$env:RELEASE_DATE="2026-11-15"; npm version 1.1.0 -m "Release %s"`.
4. Publish with the tag: `git push --follow-tags`.

`public/changes.html` and `public/licenses.txt` are generated on every build (and when the dev server starts), so they are not committed to Git. Every build regenerates `public/licenses.txt` (the open-source notices) from the installed packages, so adding a dependency updates it automatically.

`public/.well-known/security.txt` has an `Expires` date (currently 31 October 2027). Renew it before then, or security researchers will treat it as stale.

Any change to the privacy policy or terms gets its own changelog line. The "Last updated" date on that page is set automatically at release, so don't edit it by hand.

## Shortcuts

`R` / `Shift R` rotate, `Delete` remove, `⌘/Ctrl A` select all, `Shift`-click select a range, `Esc` clear, `⌘/Ctrl Z` undo, `⌘/Ctrl Shift Z` redo, `⌘/Ctrl O` add files, `⌘/Ctrl S` export. Paste images straight in.

## Roadmap

See `CHANGELOG.md` for everything that has shipped (merge, split, reorder, rotate, images to PDF, compression with size targets, installable offline app).

Next: browser-level testing in a real browser, fuzzing and malicious-file tests (see "Testing").

Then (1.2): fill and sign, and PDF to images.

Later: page numbers and watermarks; protect and unlock (needs a PDF encryption library compiled to WebAssembly, which means adding `'wasm-unsafe-eval'` to `script-src` and saying so in the privacy policy).

Not planned: anything that needs a server to process files, such as converting Word documents. It would break the core promise that files never leave the device.

## Known limits

Requires a modern browser (Chrome/Edge 119+, Safari 17.4+, Firefox 121+). Protected PDFs open with their password into an unprotected copy; those protected in a way that needs a certificate can't be opened. Compression leaves CMYK (print) and some rarer image types untouched. iPhone HEIC photos only open in browsers that can decode them, mainly Safari. Images become pages at 96 dpi; there are no paper-size options yet.
