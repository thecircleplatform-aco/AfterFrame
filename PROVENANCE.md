# Provenance & the path to a fully-owned app

This file exists so that the AGPL fork can be shipped **now** without poisoning
the **future** closed-source app. Rule of thumb: *you can always leave a
codebase, but only with code you actually own.*

## Why the fork can be shipped today and abandoned later

- Contributions **you** make to this repo are your copyright. You choose their
  license, today (AGPL, because it must combine with upstream code) and later
  (any license, in a new product).
- Files that are **derived from upstream OpenChatCut** stay AGPL forever. They
  cannot be copied into a proprietary product, no matter how much you edited
  them.
- Therefore the only question that matters long-term is: **which files are
  yours and which are theirs.**

## The three file classes — tag every file

| Class | Meaning | Can it go into the future closed app? |
|---|---|---|
| `UPSTREAM` | Existed upstream, or is an edit/rename of an upstream file | No — AGPL forever |
| `OWN` | New file you wrote, containing no copied upstream expression | Yes — you own it, relicense freely |
| `OWN-DEP` | New file you wrote that *imports* AGPL code | Only after the imports are rewritten |

Mark them with SPDX headers (one line, first line of the file):

```
// SPDX-FileCopyrightText: 2026 ACO Network
// SPDX-License-Identifier: AGPL-3.0-or-later
```

and keep the mapping in `PROVENANCE.tsv` (`path<TAB>class<TAB>note`). Generated
once, then updated by the script below as files change.

> A file is `OWN` only if `git diff <upstream-tag> -- <path>` shows it did not
> exist upstream **and** you did not copy upstream code into it. When in doubt,
> treat it as `UPSTREAM`. A false `UPSTREAM` costs you a rewrite; a false `OWN`
> costs you the company.

## Contributions from other people — the trap

If anyone else commits to this repo, their code is *theirs*. Under AGPL they
license it to everyone (fine), but you **cannot** move it into a closed app
without their permission. So, from day one of accepting outside PRs:

- require a **DCO or a short CLA** allowing ACO Network to relicense their
  contribution, or
- limit the fork to your own commits.

Fixing this after 50 contributors is expensive; fixing it at PR #1 is free.

## Migration plan

**Phase 0 — ship (now).** AGPL fork, public repo, release tags, source tarball
per release, `LICENSE` / `NOTICE.md` / `ADDITIONAL-TERMS.md` in the bundle. See
`PUBLISH.md`.

**Phase 1 — classify (1–2 weeks).** Add the upstream remote, get the fork point,
run the classifier, land `PROVENANCE.tsv`. Stop adding new code to files that
should be yours; put new work in new `OWN` files instead.

**Phase 2 — choose the foundation for app #2.**
- fast: `../OpenFilm` (MIT) + AfterFrame branding — days to a running shell
- full control: Tauri or Electron + React from scratch — weeks

**Phase 3 — port only `OWN` modules.** Copy, don't merge. Never `git subtree
add` this repo into the new one: that drags the whole AGPL history with it.

**Phase 4 — rewrite the shell.** Everything that touches the upstream-derived
core (store, timeline model, agent runtime) gets re-specified and reimplemented
in the new repo, without the AGPL files open in the same editor tab.

**Phase 5 — cut over.** Fork frozen at a final AGPL release; app #2 becomes the
product. The fork stays alive as the community edition — which is a *feature*:
it's a free funnel, and it's the reason nobody can close-source your work.

## Hard boundaries for app #2

- Zero AGPL files in the bundle — not even one utility file.
- Any shared service (sync, model proxy, billing) lives behind a documented
  HTTP/MCP API, as a separate program.
- Same brand, different product code: trademark is yours, copyright is what you
  must avoid importing.
