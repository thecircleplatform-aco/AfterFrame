# AfterFrame — local rebrand notes

This checkout is AfterFrame 0.2.17 (AGPL-3.0-or-later), rebranded locally to **AfterFrame**.
Nothing upstream was re-published; this is a private working copy.

## What was renamed

| Area | Change |
|---|---|
| Display name | `AfterFrame` → `AfterFrame` across `src/**` (120 files), incl. all 8 locale dictionaries — keys *and* values |
| Window/document title | `index.html` `<title>` |
| Wordmark | `src/components/icons.tsx` — `AF` badge + `AfterFrame` (viewBox widened 504 → 560) |
| Icon assets | `afterframe-icon.{png,icns}` → `afterframe-icon.{png,icns}` in `public/`, `assets/branding/`, `skills/afterframe/assets/` |
| Packaging | `productName: 'AfterFrame'` in `config/electron-builder.config.mjs` and `package.json` |
| Dev banner | `[AfterFrame] isolated profile …` → `[AfterFrame] …` |
| MCP tool catalog | regenerated via `npm run generate:server-tool-catalog` (tool descriptions embed the brand) |

## Deliberately NOT renamed

Renaming any of these breaks runtime behaviour, storage, or the MCP contract:

- `AFTERFRAME_*` environment variables (CLI, server, desktop bootstrap read them)
- `afterframe:*` IPC channel names (matched by Electron main/preload handlers)
- `~/.afterframe/` — project store, dev profiles, skills
- `appId: dev.afterframe.app`, npm package `name`, `desktopName`
- IndexedDB names (`afterframe-captions`, `afterframe-music-intelligence`), MIME types, `window.AfterFrameDesktop` bridge
- Upstream URLs (`github.com/ACO-Network/AfterFrame`) — the update checker and repo links must resolve
- `README.md` / `CHANGELOG.md` prose (upstream attribution)

## Icon + mark assets

The mark is a single rounded frame with a solid play head; the pink→purple→blue
gradient carries the "after" reading instead of a second shape.

| File | Purpose |
|---|---|
| `public/afterframe-mark.svg` | primary mark (also the favicon) |
| `public/afterframe-mark-mono.svg` | one-colour mark, play head knocked out |
| `BrandMark` / `BrandMarkMono` (`src/components/icons.tsx`) | components for app chrome |
| `public/afterframe-icon.png` | 512px, Linux icon |
| `assets/branding/afterframe-icon.png` | 1024px master |
| `assets/branding/afterframe-icon.ico` | Windows, 16–256px (7 entries) |
| `assets/branding/afterframe-icon.icns` | macOS, ic07–ic14 |

Regenerate all of them after changing the SVG:

```powershell
node scripts/build-icon.mjs
```

Both containers are written by hand in that script (ICONDIR + PNG entries for
`.ico`, `icns` magic + type-tagged PNG chunks for `.icns`); electron-builder
cannot derive either from a single PNG.

## Checks that must stay green

```powershell
npx tsc -p tsconfig.app.json --noEmit   # types
npm run verify:i18n                     # locale parity (153 files / 2525 strings)
npm run verify:server-tool-catalog      # catalog freshness
npx tsx src/theme-tokenization.verify.ts # no raw colours in chrome CSS
```

## Pulling upstream later

`git pull` will conflict in the renamed files. To re-apply the rebrand after a merge:

```powershell
node scripts/rename-brand.mjs     # word-boundary safe; skips identifiers
node scripts/rename-assets.mjs    # icon paths + dev banner
npm run generate:server-tool-catalog
```

Both scripts only rewrite the standalone word, so `AfterFrameTool`,
`AfterFrameWordmark` and `AfterFrameDesktop` survive untouched.
