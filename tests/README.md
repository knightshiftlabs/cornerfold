# Cornerfold tests

Run everything: `npm test` (about 20 seconds). While working: `npm run test:watch`.

| File | What it protects |
|---|---|
| `format.test.ts` | The custom size box and file-size labels |
| `ingest.test.ts` | Adding files through the app’s real import code: valid PDFs and images, signed, password-protected, restricted, damaged, fake, empty, HEIC and unsupported files, phone-photo rotation |
| `actions.test.ts` | The buttons: what gets exported, empty inputs, double-clicks, readable error messages |
| `detection.test.ts` | What happens when a file is added: passwords, restrictions, signatures, damaged or fake files |
| `compress.test.ts` | Compression quality, size targets, and the files it must leave alone |
| `worker.test.ts` | The export engine exactly as the app runs it: merge, split, compress, forms, memory |
| `store.test.ts` | Editing, undo and redo, selection, freeing memory |
| `ui.test.tsx` | The interface in a simulated browser: clicks, shortcuts, the compress panel, the privacy badge |

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
