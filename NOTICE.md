# Third-Party Notices — AfterFrame

AfterFrame is free software: you can redistribute it and/or modify it under the
terms of the **GNU Affero General Public License, version 3 or (at your option)
any later version** (`AGPL-3.0-or-later`). The complete license text is in
[LICENSE](LICENSE).

It bundles third-party open-source components. Those components remain under
their own licenses, which apply to those components only and take precedence
over the AGPL-3.0-or-later for them. Nothing in the AGPL-3.0-or-later limits the
rights granted to you by those third-party licenses.

Redistribution additionally requires credit to AfterFrame — see
[ADDITIONAL-TERMS.md](ADDITIONAL-TERMS.md).

## Runtime components

| Component | License |
|---|---|
Electron | MIT |
React, React DOM | MIT |
Vite, Rolldown | MIT |
TypeScript | Apache-2.0 |
Remotion (`remotion`, `@remotion/renderer`, compositor) | Remotion License (see package) |
FFmpeg / ffprobe static builds | LGPL-2.1-or-later / GPL-2.0-or-later (per build) |
onnxruntime-node | MIT |
whisper.cpp | MIT |
MediaPipe (Tasks Vision) | Apache-2.0 |
sqlite-vec | MIT / Apache-2.0 |
better-sqlite3 / node:sqlite | MIT |
koffi | MIT |
qrcode | MIT |
lucide-style icon paths | ISC |

### Remotion licensing note

Remotion is **source-available, not open source**. It is distributed under the
proprietary [Remotion License](https://www.remotion.dev/license), which is not
an OSI-approved license.

This project is developed and operated by **a single individual**, so it
qualifies for the **Remotion Free License**, which covers individuals and teams
of up to 3 people for personal or commercial use, including automated rendering
and SaaS distribution. No seat count is derived from end-user volume.

If this project's development team ever grows to **4 or more people**, a
Remotion Company License becomes mandatory. Current pricing (at the time of
writing): "Remotion for Automators" at $0.01 per render with a $100/month
minimum, or "Remotion for Creators" at $25/month per seat. See
<https://www.remotion.dev/pricing>.

The embedded compositions here are parameterized templates driven by a
serialized timeline state; end users do not author or submit Remotion source
code. This is the use case the Remotion License FAQ lists as permitted
("allowing users to create and render their own personalized video based on
your Remotion template").

Note that Remotion enables **client-side render telemetry by default and it
cannot be disabled**; the Remotion project can observe rendering domains and
volumes for license-compliance purposes.

## Models and assets

| Asset | License |
|---|---|
Selfie Segmenter (MediaPipe) | Apache-2.0 |
BlazeFace short range (MediaPipe) | Apache-2.0 |
Whisper.cpp GGML speech models | MIT (model weights per upstream) |
Noto Sans / Google Fonts shipped in `public/fonts` | OFL-1.1 |

## Full texts

The complete license text for every dependency is available in
`node_modules/<package>/LICENSE` and is emitted by:

```bash
npx license-checker --production --summary
```

## Provenance and modifications

This codebase is a **modified fork of OpenChatCut**, which is distributed under
AGPL-3.0-or-later. The fork was rebranded and changed for AfterFrame; the
changes are described in [REBRAND.md](REBRAND.md). Upstream copyright notices
and the AGPL-3.0-or-later grant continue to apply — a fork cannot relicense AGPL
code on more restrictive terms, and the license of this work is the same as the
upstream project's.

**Notice of modification (AGPL-3.0 §5(a)):** this is a modified version of the
original work. Changes were made in 2026; see [REBRAND.md](REBRAND.md) for the
list of modifications.

**Remote Network Interaction (AGPL-3.0 §13):** if you run a modified version of
this program as a network service, you must offer all users interacting with it
remotely the opportunity to receive the Corresponding Source of your version,
free of charge, from a network server at no further charge.

**Attribution (AGPL-3.0 §7(b)/(d)):** distributions and hosted deployments must
credit AfterFrame as described in [ADDITIONAL-TERMS.md](ADDITIONAL-TERMS.md).
