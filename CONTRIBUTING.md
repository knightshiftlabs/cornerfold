# Contributing to Cornerfold

Thank you for wanting to help. Bug reports, ideas and fixes are all welcome.

## Licence

Cornerfold is free software under the [GNU Affero General Public License v3.0 or later](LICENSE). In short: you
may use, study, change and share it, including running it as a service, but if you share a changed version, or let
people use one over a network, you must offer them its source under the same licence.

A different, commercial licence for uses that do not fit the AGPL can be arranged. Write to
[hello@cornerfold.org](mailto:hello@cornerfold.org).

## Code you send in

To keep that option open, the copyright holder needs the right to license contributed code both ways. So by
opening a pull request you confirm that:

1. you wrote the code, or have the right to submit it, and
2. you license your contribution to the project under the AGPL-3.0-or-later **and** grant KnightShift Labs the
   right to also license it under other terms, including commercial ones.

If that doesn't suit you, open an issue describing the change instead; we're glad to write it ourselves.

## Before you send a change

- `npm test` and `npm run build` must pass. Every bug fix gets a regression test.
- Add a plain-language line under `## [Unreleased]` in `CHANGELOG.md` for anything a user would notice.
- Security problems: do not open a public issue. See [SECURITY.md](SECURITY.md).
