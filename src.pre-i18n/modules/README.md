# Modules

`src/modules/*` holds the product's domain logic. Everything here is framework
neutral: no React, no editor store, no IPC. That is the point — a module can be
tested, reused, or replaced without dragging the UI along.

## Layers

```
LAYER 3   src/app  src/components  src/ui  src/hooks
          React, DOM, editor chrome. May import anything below.

LAYER 2   src/editor  src/agent  src/media  src/persist  src/export
          src/captions  src/gl  src/audio  src/i18n  src/library ...
          Application state and runtime services.

LAYER 1   src/modules/*
          Pure domain logic. Must NOT import LAYER 3.
```

Dependencies point **down only**. The rule is enforced, not documented-and-hoped:

```bash
npm run verify:modules
```

A module importing `components/` fails the check. When you hit that, one of two
things is true:

1. The shared piece really is a leaf → move it down into `src/modules/`
   (this is what happened to `icons`, which had zero imports and 35 consumers).
2. The dependency is real but inverted → accept a callback the caller supplies,
   so the module stays unaware of who draws it.

## Current modules

| Module | Files | Responsibility |
|---|---|---|
`color` | 5 | Colour analysis, scopes, auto-grade math |
`geometry` | 11 | Frame geometry, caption collision, visual placement |
`icons` | 1 | Icon set. Zero imports — the shared design primitive |
`reframe` | 4 | Subject-aware reframe detection |
`remote` | 4 | LAN phone remote: QR pairing, transcript mirror |
`review` | 4 | Review comments and annotation state |
`scene-detection` | 5 | Scene boundary detection |
`script` | 4 | Script/transcript serialization model |
`tracking` | 9 | Motion tracking |

## Adding a module

1. Create `src/modules/<name>/`.
2. Keep it free of React and of `src/editor` state. If it needs data, take it as
   an argument.
3. Run `npm run verify:modules` and `npx tsc -p tsconfig.app.json --noEmit`.

## Why the rest is not migrated yet

`src/agent` (513 files), `src/components` (222), `src/gl` (164) and
`src/editor` (131) are the heavy, highly-connected cores. Pulling them apart is
a per-domain job — each needs its public surface identified first, otherwise the
move just relocates the tangle. The codemod that did the current nine is
resolution-based (it rewrites relative specifiers by mapping old absolute path →
new absolute path), so it is reusable for the next batch.
