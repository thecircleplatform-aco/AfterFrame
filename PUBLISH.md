# Publishing AfterFrame

## The decision that matters

You cannot publish *this codebase* with "credit only". Not because OpenChatCut
owns your work, but because copyleft runs the other way: their code is inside
your binary, so the AGPL's conditions attach to the whole distributed work, not
just to the lines they wrote. Your own code is still yours — you keep the
copyright — but the *distribution terms* for the combined app are AGPL.

| Path | You ship | You owe upstream | Effort |
|---|---|---|---|
| **A — ship this fork** | AGPL-3.0-or-later app + binaries | license text, notices, your modification record, source offer, credit. **No money, no permission, no code assignment.** | low — mostly done |
| **B — credit only** | any license you want, incl. closed | nothing beyond the MIT/Apache notice of the base you build on | high — rebuild on the OpenFilm (MIT) base in `../OpenFilm`; none of this fork's code may be copied into it |

Path A is legal today. Path B is legal only if the OpenChatCut code is left
behind entirely.

## Path A — what is already done

- [x] `LICENSE` — verbatim GNU AGPL v3
- [x] `package.json` — `"license": "AGPL-3.0-or-later"`
- [x] `NOTICE.md` — third-party components, §5(a) modification record, §13 network clause
- [x] `ADDITIONAL-TERMS.md` — mandatory "Built on AfterFrame" credit (§7(b)/(d))
- [x] `README.md`, `site/index.html` — license + credit surfaces
- [x] `public/fonts/LICENSES.md` — OFL-1.1 font notice

## Path A — what is left before you press publish

1. **Publish the source.** The source offer has to be real: create a public repo
   (this checkout has `.git` with no commits and no remote) and push. Every
   release must reference a tag whose tarball contains the exact code used to
   build the binaries.
2. **Decide Remotion.** `remotion` + `@remotion/*` (`4.0.537`) are under the
   Remotion License, not an OSI license: free for individuals and companies with
   ≤ 3 employees, otherwise a paid company license is required. Two options:
   - buy the company license and list it in `NOTICE.md`, or
   - keep Remotion out of the shipped bundle and let the user install it.
   Shipping today without either is a license violation, independent of AGPL.
3. **Fix the FFmpeg build.** `ffmpeg-static@^5.3.0` ships a GPL-2.0-or-later
   binary. Ship alongside it a written offer for the corresponding FFmpeg source
   (tag + build script), or switch to an LGPL-2.1 build.
4. **Attach the source archive.** Each GitHub release: `AfterFrame-<ver>-source.tar.gz`
   built from the release tag (`git archive`), plus `LICENSE`, `NOTICE.md`,
   `ADDITIONAL-TERMS.md`.
5. **Model weights & assets.** `public/models`, `public/mediapipe`,
   `public/whisper-cli`, and `assets/luts/*.cube` (Canon LUTs are
   "All Rights Reserved" — remove or replace them before redistributing).
6. **Trademark.** Keep the AfterFrame name off anything that implies endorsement;
   do not use the upstream project's name as your product name.

## Build commands

```powershell
$env:PATH="C:\Users\Dell\Afterframe\.node24\node-v24.22.1-win-x64;"+$env:PATH
npm run build                 # web bundle
npm run desktop:build:main    # electron main + preload
npm run desktop:dist:win      # NSIS installer  (or desktop:dist:mac-x64 / :linux)
```

## If you want credit-only

Then the product has to be `../OpenFilm` (MIT) with AfterFrame branding on top.
MIT asks only that the copyright notice and license text travel with copies.
Nothing from `AfterFrame/` may be merged in — that would drag AGPL back in.
