# Security policy

Cornerfold processes people's documents, so security reports are taken seriously and handled
quickly. Thank you for helping keep it safe.

## Reporting a vulnerability

Please report privately, never in a public issue:

- **Preferred:** use GitHub's private reporting. Go to this repository's **Security** tab and
  choose **Report a vulnerability**.
- **Or email** [security@cornerfold.org](mailto:security@cornerfold.org).

Helpful things to include:

- what the problem is, and what an attacker could do with it
- steps to reproduce it, ideally with a sample file if a document triggers it
- the browser and device you used

Please give us a reasonable chance to fix the problem before disclosing it publicly. We'll keep
you updated, and we're glad to credit you once it's fixed, if you'd like.

## No paid bounty

Cornerfold is a free, independent project and does not run a paid bug bounty. We can't pay for
reports, but we do take them seriously, fix real problems quickly, and offer public credit. Emails
that ask us to join a bounty platform, or that offer paid "security services", are not reports; real
ones go through the private channels above.

## Testing rules

Please keep testing non-destructive and limited to the in-scope assets below. In particular, please
don't:

- run denial-of-service or load tests against cornerfold.org
- access or change anyone else's data (Cornerfold keeps none, but the rule applies to the hosting)
- use social engineering against the maintainer or anyone else
- test third-party infrastructure (Cloudflare, GitHub) without their own permission

A finding you can show with a crafted file opened in your own browser is exactly the kind of report
we want. Public credit, if offered, does not imply payment.

## Supported versions

Only the latest version is supported. Cornerfold is a website, so everyone using
[cornerfold.org](https://cornerfold.org) automatically runs the newest release. Fixes are shipped
as new releases, listed in the [release history](https://cornerfold.org/changes.html).

## Scope

In scope: the Cornerfold app and its website at cornerfold.org, and the code in this repository.

Out of scope: problems in third-party services we rely on (report those to Cloudflare or GitHub
directly), and anything that requires an already-compromised device or browser.

Machine-readable contact details are also published at
[cornerfold.org/.well-known/security.txt](https://cornerfold.org/.well-known/security.txt).
