# Cornerfold tests

Run everything: `npm test` (about 20 seconds). While working: `npm run test:watch`. Fuzzing is separate: `npm run test:fuzz`.

| File | What it protects |
|---|---|
| `format.test.ts` | The custom size box and file-size labels |
| `ingest.test.ts` | Adding files through the app’s real import code: valid PDFs and images, signed, password-protected, restricted, damaged, fake, empty, HEIC and unsupported files, phone-photo rotation |
| `actions.test.ts` | The buttons: what gets exported, empty inputs, double-clicks, readable error messages |
| `detection.test.ts` | What happens when a file is added: passwords, restrictions, signatures, damaged or fake files |
| `compress.test.ts` | Compression quality, size targets, and the files it must leave alone |
| `worker.test.ts` | The export engine exactly as the app runs it: merge, split, compress, forms (including merging copies of the same form), retrying a failed compression |
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
| `ui.test.tsx` | The interface in a simulated browser: clicks, shortcuts, the compress panel, the privacy badge, the password dialog |

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

## Fuzzing

`npm run test:fuzz` feeds randomly corrupted PDFs, 400 per run by default (flipped bytes, inserted tokens,
deleted or duplicated chunks, truncation, extreme numbers) through the same engines the app uses:
the one that reads files and draws thumbnails, and the one that exports and compresses. Rejecting a
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

Be honest about these; they need a real browser or a person:

- Real browsers and devices: Chrome, Safari, Firefox, Android, iPhone, low-memory phones
- Drawing page thumbnails (pdf.js is replaced by a stand-in in the interface tests)
- Dragging pages to reorder, the file picker, drag-and-drop from the desktop, pasting
- Downloads actually being saved, especially from the installed app on iPhone
- Offline mode, installing as an app, and the service worker
- The security headers and policy (they come from Cloudflare, not the code)
- Recovering when a new version is deployed while the app is open
- Redrawing sideways phone photos upright (needs a browser canvas; only reading the rotation is tested)
- Decoding HEIC, WebP or GIF images (the test stand-in decodes only PNG and JPEG)
- Visual design, dark mode, accessibility with screen readers
- Very large files close to a device’s memory limit

The manual checklist in the torture-test pack covers these. Run it before any release that touches
file handling.
