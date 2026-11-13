# Cornerfold tests

Run everything: `npm test` (about 20 seconds). While working: `npm run test:watch`. Fuzzing is separate: `npm run test:fuzz`.

| File | What it protects |
|---|---|
| `format.test.ts` | The custom size box and file-size labels |
| `ingest.test.ts` | Adding files through the app’s real import code: valid PDFs and images, signed, password-protected, restricted, damaged, fake, empty, HEIC and unsupported files, phone-photo rotation |
| `actions.test.ts` | The buttons: what gets exported, empty inputs, double-clicks, readable error messages |
| `detection.test.ts` | What happens when a file is added: passwords, restrictions, signatures, damaged or fake files |
| `compress.test.ts` | Compression quality, size targets, and the files it must leave alone |
| `worker.test.ts` | The export engine exactly as the app runs it: merge, split (into pages, ranges, or parts under a size), compress, blank pages, photos on paper, page numbers and watermarks read back as they appear on screen (including turned pages), forms (including merging copies of the same form), retrying a failed compression |
| `memory.test.ts` | How much compression keeps in memory: the budget for decoded pictures, freeing, jobs taking turns, identical output whatever the budget, smaller budgets for small devices |
| `engine.test.ts` | The messages between the page and the PDF engine, including when the browser can't send one |
| `ingestLimits.test.ts` | Adding many files at once: only a few are read together, and pages keep the order the files were given |
| `store.test.ts` | Editing, undo and redo, selection, freeing memory |
| `bombs.test.ts` | Deliberately malicious files: images that claim to be enormous, data that unpacks far beyond what it declares, fake page counts, absurd nesting, loops in form fields |
| `jpeg.test.ts` | Removing a photo's hidden details (camera, date, GPS, previews, comments, trailing data) without touching the picture: baseline, progressive and CMYK files |
| `photoPrivacy.test.ts` | The same promise end to end: a photo or PNG added through the real import code and exported by the real engine carries none of it |
| `report.test.ts` | The "Report a problem" email draft: only the version and the browser, safely encoded |
| `stampDate.test.ts` | Release dates: India's date, the changelog entry, which policy pages get dated, and the safety stops, including a real run in a scratch repository |
| `unlock.test.ts` | Opening protected PDFs: every kind of encryption, wrong passwords, restricted files, and that the unprotected copy is a real ordinary PDF |
| `passwords.test.ts` | The questions about locked files: one at a time, and nothing kept afterwards |
| `unlockFlow.test.ts` | A locked file end to end: added, answered for, then exported, split and compressed, with unprotected results |
| `ranges.test.ts` | Page numbers as people type them (“1-3, 7, 10-”), and the messages for mistakes |
| `blank.test.ts` | Telling an empty page from one with something on it: cream paper, scanner dust and edge shadows, a single line |
| `pageOps.test.ts` | Selecting, duplicating, reversing and inserting pages, each one undoable |
| `pageTools.test.ts` | The page tools: what they ask the engine for, what they tell the person, and failures |
| `paper.test.ts` | Where a photo goes on A4 or Letter: margins, orientation, never stretched |
| `stamp.test.ts` | Page number wording, which characters a watermark can use, and placing text on turned pages |
| `text.test.ts` | Turning what is read off a page into plain text with sensible line breaks |
| `exporters.test.ts` | Saving as images or text, and exporting with page numbers or a watermark |
| `ui.test.tsx` | The interface in a simulated browser: clicks, shortcuts, the compress panel, the privacy badge, the password dialog, the Tools menu and its panels, the large preview, the toolbar on phones |

Test documents are generated on the fly in `helpers/fixtures.ts`. The few that need special
tools to make (encrypted, signed, damaged, CMYK) are small files in `fixtures/`.

## The rules

1. **No release unless every test passes and the production build succeeds.** `npm version patch`,
   `minor` or `major` runs both first (the `preversion` script) and stops, with no version bump and no
   tag, if either fails.
2. **Every bug fix comes with a test** that fails without the fix. Name it after the bug and mark
   it `(regression)`, so nobody deletes it as redundant.
3. **A test must be able to fail.** When adding one, briefly break the code it covers and check
   the test notices.

## Running from a clean install

```
npm ci
npm test
```

No browser, Python or other tools are needed: PDF and image work runs on a Node canvas library
that installs with the other packages.

## Browser tests

`npm run test:e2e` builds the site and runs it in a real Chrome, on a desktop and as a touch phone
(about 5 minutes; each test has a trace for replaying it if it fails). The files are in `tests/e2e/`:

| File | What it checks |
| --- | --- |
| `smoke.spec.ts` | The security headers really arrive, and every page of the site loads under them |
| `files.spec.ts` | Adding files: the picker, every image type, drag and drop, paste, files that can't be used |
| `edit.spec.ts` | Moving pages with a mouse and with the keyboard alone, rotating, deleting, selecting, undo and redo |
| `export.spec.ts` | Exports, splitting, compression (the size shown is the size delivered), fitting under a limit, metadata removed |
| `unlock.spec.ts` | Locked and restricted PDFs, wrong passwords, and that the password is left nowhere in the browser |
| `tools.spec.ts` | Each tool in the Tools menu through its real panel, with every file it makes checked |
| `phone.spec.ts` | Screens from 320 pixels wide: nothing wider than the screen, labels on one line, every tool reachable |

Two things make these tests worth more than clicking around:

- **The real security policy.** `tests/e2e/server.mjs` serves the build with the headers from
  `public/_headers`, as Cloudflare does. Vite's own preview server sends none, which is how 1.3.0
  shipped a tool that the live site's policy blocked.
- **A guard on every test** (`tests/e2e/fixtures.ts`): a test fails if any request leaves the site,
  anything breaks the security policy, or the page logs an error. The privacy promise is checked on
  every action of every test, not in one test of its own.

Rules: no automatic retries, because a test that passes the second time is a bug to fix. Tests that are slow
by nature say so and wait as long as it takes. Before trusting a new test, break the code it guards and
watch it fail.

If Playwright can't download its own Chrome on your machine, point it at another Chromium:
`CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## Fuzzing

`npm run test:fuzz` feeds randomly corrupted PDFs, 400 per run by default (flipped bytes, inserted tokens,
deleted or duplicated chunks, truncation, extreme numbers) through the same engines the app uses:
the one that reads files and draws thumbnails, and the one that exports: merging, compressing, adding
page numbers and a watermark (on turned pages), splitting by size, and making a blank page. Rejecting a
broken file is fine. A hang, a crash, or a broken PDF produced from an accepted file is not, and the
offending input is saved to `tests/fuzz/failures/` so it can be replayed.

- `FUZZ_ITERATIONS` (default 400) and `FUZZ_SEED` (default random) control a run; a printed seed
  reproduces a run exactly.
- `FUZZ_TRACE=1` saves every input before it is tried, so if a run dies the last one is on disk.
- **Known limitation:** in Node, pdf.js cannot run in a separate thread, so a file that sends it into
  an endless loop makes the whole run stall instead of failing cleanly. If a run stops printing,
  look at `tests/fuzz/failures/last-case.pdf` (with `FUZZ_TRACE=1`). The browser tests do not have
  this limitation, because there pdf.js does run in its own worker.

## What is not tested automatically

Be honest about these. The browser tests run in Chrome only; these still need other browsers, real
devices or a person:

- Safari, Firefox, real Android phones and iPhones, low-memory phones
- Downloads from the app installed on an iPhone home screen
- Offline mode, installing as an app, and the service worker
- Recovering when a new version is deployed while the app is open
- The live site's headers (the tests check `public/_headers` as served by the test server, not what Cloudflare actually sends)
- Redrawing sideways phone photos upright, and HEIC and AVIF photos
- Accessibility with screen readers, visual design, dark mode
- Very large files close to a device’s memory limit

The manual checklist in the torture-test pack covers these. Run it before any release that touches
file handling.
