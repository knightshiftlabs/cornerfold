# fold

Merge, split, reorder and rotate PDFs and images, entirely in the browser. Working name; rename freely.

**Pillars:** private (files never leave the device), a UI people enjoy, no ads.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

## Deploy (Cloudflare Pages)

Connect the repo, set build command `npm run build` and output directory `dist`. `public/_headers` ships the security headers, including the CSP. After deploying, open DevTools, go to Network, add files and export: you should see zero requests carrying file data. Leave Cloudflare Web Analytics switched off, and fill in the placeholders in `public/privacy.html`.

Firebase Hosting works too; move the headers from `_headers` into `firebase.json`.

## How it works

The whole v1 is one idea: every tool is "arrange a list of pages, then write it out". Merge, split, reorder, rotate, delete, extract and images-to-PDF are all the same workspace, so there is no tool picker and no page reloads.

`src/lib/store.ts` holds the page list. Every edit goes through `commit()`, so everything is undoable (100 steps).

`src/lib/ingest.ts` reads dropped, picked or pasted files. PNGs and upright JPEGs are embedded byte-for-byte (lossless); rotated phone photos are redrawn upright using their EXIF orientation. Password-protected PDFs are detected up front.

`src/lib/pdf.ts` renders thumbnails with pdf.js only when a card scrolls near view, three at a time, cached per session. pdf.js is lazy-loaded and prefetched on idle, so first paint is about 72 KB of gzipped JS.

`src/lib/worker.ts` builds output PDFs with pdf-lib in a Web Worker, so the UI never freezes on big files. Each source's pages are copied in a single call so shared fonts and images are embedded once. Source bytes cross into the worker once per file. Outputs contain no author, creator or producer metadata.

## Privacy guarantees, and what enforces each one

Files never leave the device: there is no upload code, and the CSP `connect-src 'self'` with no backend means the browser blocks exfiltration even if a dependency misbehaved. No third parties: fonts and the pdf.js worker are bundled and self-hosted, and the CSP allows only `'self'`. No cookies or analytics, so no consent banner is needed. It works offline: the service worker precaches the app after the first visit. Metadata is stripped: `updateMetadata: false` on output documents.

The remaining personal data is the host's IP logs. Disclose them in the privacy policy and keep the host's DPA on file.

## Shortcuts

`R` / `Shift R` rotate, `Delete` remove, `⌘/Ctrl A` select all, `Shift`-click select a range, `Esc` clear, `⌘/Ctrl Z` undo, `⌘/Ctrl Shift Z` redo, `⌘/Ctrl O` add files, `⌘/Ctrl S` export. Paste images straight in.

## Roadmap

v2: compression (qpdf or Ghostscript compiled to WASM; add `'wasm-unsafe-eval'` to `script-src`), unlock/protect, page numbers, watermark, PDF-to-images, PNG icons for full PWA install support.

v3: Office-to-PDF via headless LibreOffice on Cloud Run (EU region, in-memory only, opt-in and clearly labelled as the one tool that uploads). Update the CSP's `connect-src` and the privacy policy before shipping it.

## Known limits

Requires a modern browser (Chrome/Edge 119+, Safari 17.4+, Firefox 121+). Encrypted PDFs are rejected until unlock lands. Images are placed at 96 dpi page size; no paper-size options yet.
