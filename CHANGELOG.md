# Changelog

All notable changes to Cornerfold are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
This file is the source for the public page at /changes.html, which is generated on every build.

## [Unreleased]

## [1.1.6] - 2026-11-01

### Changed
- Privacy policy: describes more precisely what the site’s security policy protects against, and that the first safeguard is Cornerfold’s own code never sending files anywhere.

## [1.1.5] - 2026-11-01

### Changed
- Phones and tablets now show the stack of pages on the home screen, with its landing animation. On phones it sits above the headline, sized so the Choose files button stays on screen even on small phones; tablets in portrait use the same layout with a larger stack.
- On touch screens, the pages fan out when you press them, and sit slightly apart at rest.
- The privacy points line up as a tidy two-by-two grid at every screen size.
- The keyboard hint is hidden on touch screens, where it doesn’t apply.

## [1.1.4] - 2026-10-31

### Fixed
- The custom size box no longer reads “5 5” as 55 KB; it asks for a proper size instead. Found by the new automated tests.

## [1.1.3] - 2026-10-31

### Added
- A warning when you add a digitally signed PDF: any change, even compressing, makes the signature invalid, though the pages look the same.

### Fixed
- Fillable forms stay fillable after merging. Before, the fields still showed but could no longer be edited.
- A file that’s damaged in a way Cornerfold can’t repair now gets a readable message at export, not a technical error.
- If Cornerfold is updated while you have it open, it keeps working instead of failing to read new files, and tells you plainly if a reload is needed.
- Clearer messages when a file can’t be added: iPhone photos (HEIC) the browser can’t open, PDFs that need a password, PDFs with editing restrictions such as many bank statements, and empty files.
- The custom size box now understands sizes typed like “1,000 KB” or “1.5mb”, and explains what’s wrong instead of silently doing nothing.
- Memory used by files you’ve deleted, and can no longer undo, is now freed, so long sessions stay fast.

### Changed
- About page: describes precisely what Cornerfold does and doesn’t have, rather than claiming no system exists at all.
- Privacy policy: states that forwarded email arrives in Gmail and how long we keep it; lists exactly which document information exported PDFs keep and lose; and explains when India’s DPDP Act rights take effect.
- Terms: lists the browsers Cornerfold supports.

## [1.1.2] - 2026-10-31

### Added
- An About page: why Cornerfold exists, how it works without seeing your files, and who makes it.

### Changed
- Privacy policy, made more precise: Cornerfold itself collects nothing, and the policy now states plainly the two limited exceptions, technical details seen by our host and any email you send us.
- Privacy policy: the rights section now reflects that the only personal data we hold is email you’ve sent us.
- Privacy policy: a new Security section with how to report vulnerabilities.

## [1.1.1] - 2026-10-31

### Changed
- Cornerfold has its own address: cornerfold.org.
- Contact address is now hello@cornerfold.org.
- Privacy policy: explains that email to cornerfold.org is forwarded by Cloudflare.

### Security
- Added a security.txt file, so anyone who finds a vulnerability knows how to report it: security@cornerfold.org.

## [1.1.0] - 2026-10-31

### Added
- Compress PDFs. Choose Light, Balanced or Smallest and see each one’s exact size before you download, not a guess.
- Fit under a size limit: pick 100 KB, 200 KB, 500 KB, 1 MB, 2 MB or type your own, and Cornerfold finds the best quality that fits. Useful for forms and portals with upload limits.
- Compress works on whatever is on the page, so you can merge, rearrange and compress in one go.
- Compressing a single, unedited PDF keeps its bookmarks and form fields.

### Changed
- Privacy, front and centre. The home screen now says plainly what Cornerfold is: PDF tools that never see your files.
- While you work, a badge shows that your files are on this device. Lose your connection and it tells you you’re offline, with everything still working.
- Shared links now show a proper preview card in WhatsApp, LinkedIn and other apps.
- About half as much code to download before the app appears, so it opens faster, especially on mobile data.
- The first export after adding files starts instantly; the PDF engine now warms up in the background.

### Security
- Stricter security policy: the app can’t load anything from other websites, and can’t use inline styles or embedded data URLs.
- Privacy policy: explains what happens if you email us, and how to check for yourself that files never leave your device.

## [1.0.1] - 2026-10-31

### Added
- Terms of use.
- Open-source licenses page listing every third-party package Cornerfold ships with, generated on every build.
- The current version number, with links to the terms, licenses and contact, at the bottom of the home screen.

### Changed
- Privacy policy: explains how browser “Do Not Track” and Global Privacy Control signals are handled, and covers the UK GDPR alongside the EU GDPR and India’s DPDP Act.

## [1.0.0] - 2026-10-31

First public release.

### Added
- One workspace for merging, splitting, reordering, rotating and deleting pages, and for turning images into PDFs.
- Export everything or only the pages you select; split pages into separate PDFs, downloaded together as a zip.
- Drag to reorder, Shift-click to select a range, keyboard shortcuts, and undo and redo for every edit.
- Paste screenshots and images straight onto the page.
- Phone photos are placed upright automatically.
- Works offline after the first visit, and can be installed as an app.
- Privacy policy and this release history.

### Security
- All processing happens on your device. Files are never uploaded, and the site's security policy blocks requests to any other server.
- Exported PDFs carry no author, creator or producer metadata.
