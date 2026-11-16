<p align="center">
  <img src="public/afterframe-icon.png" width="96" alt="AfterFrame" />
</p>

<h1 align="center">AfterFrame</h1>

<p align="center">
  <strong>Agent-native, local-first video editor</strong>
</p>

<p align="center">
  A professional timeline editor where an AI agent reads, edits, and exports real
  projects — and stays fully undoable. Plus a phone remote that controls the
  agent over your own local network.
</p>

---

## What it is

AfterFrame is a desktop video editor built around an embedded agent. The agent
does not generate a video and hand you a file; it operates the same project
document you do, through the same commands, so every change lands as a normal
editable timeline operation and a single undo step.

- **Real editor, not a wrapper** — multi-track timeline, keyframes, transitions,
  captions, colour, audio, multicam, sequences, motion graphics.
- **Built-in agent** — plan, edit, verify frames, and iterate inside the editor.
- **External agents** — Codex, Claude Code, and Copilot can drive the same
  project over MCP.
- **Phone remote** — scan a QR, join the same Wi-Fi or hotspot, and send prompts
  from your phone while the desktop renders. No cloud relay, no account.
- **Local-first** — projects, media, and keys stay on your machine. Only model
  API calls leave the device, and only if you configure them.

## Stack

| Layer | |
|---|---|
UI | React 19 · TypeScript · Vite 8 |
Shell | Electron 43 |
Rendering | WebGL / WebGPU · Remotion |
Media | FFmpeg / ffprobe · FFprobe metadata |
Local inference | onnxruntime-node · whisper.cpp · MediaPipe |
Data | SQLite project store · sqlite-vec |

## Requirements

- **Node.js `>=24.22.1 <25`** — the toolchain refuses older releases.
- Windows, macOS, or Linux.
- For the agent: an API key for at least one provider (DeepSeek, OpenAI,
  Anthropic, Gemini), or one of the supported local CLI harnesses.

## Run it

```bash
npm install
npm run dev          # http://localhost:5199
```

The dev server runs an isolated profile under `~/.afterframe/` so development
never touches your real project library.

### Provider keys

Create `.env.local` in the project root:

```ini
LLM_PROVIDER=deepseek
LLM_DEEPSEEK_BASE_URL=https://api.deepseek.com
LLM_DEEPSEEK_MODEL=deepseek-v4-flash
LLM_DEEPSEEK_API_KEY=...
```

Once an isolated profile exists, it keeps its own `settings.env` and stops
reading `.env.local`. Either edit keys in the app (Settings → API Keys) or export
the `LLM_*` variables into the process environment before `npm run dev`.

### Phone remote

Open a project, click the QR icon in the chat header, and scan with your phone
camera. Both devices must share a network:

- **PC hotspot (recommended)** — Windows Mobile Hotspot gives the PC
  `192.168.137.1`; the phone keeps its own data plan untouched and the desktop
  keeps its broadband.
- **Phone hotspot** — the desktop joins the phone's network; agent calls then
  ride your mobile data.
- **Bluetooth tethering** — works via PAN on Android; too slow for frame preview.

The LAN listener exists only while the pairing sheet is open, and the phone
receives nothing but the conversation text — never the editor, the project
files, or the API keys.

## Desktop build

```bash
npm run desktop:dist:win     # → release/AfterFrame-<version>-x64.exe (NSIS)
npm run desktop:dist         # macOS (dmg + zip, arm64)
npm run desktop:dist:linux   # AppImage
```

Expect roughly **300–380 MB** for the Windows installer and **850 MB–1 GB**
installed, dominated by the Electron runtime, headless Chrome for Remotion,
FFmpeg, onnxruntime, and the bundled speech/vision models.

## Verification

```bash
npm run verify:i18n
npm run verify:server-tool-catalog
npx tsx src/theme-tokenization.verify.ts
npx tsc -p tsconfig.app.json --noEmit
```

## Architecture

A 17-part functional map of every subsystem — editor core, persistence, agent runtime, tool
policy, server/API surface, desktop shell, media pipeline, captions, GL/preview, export, UI
shell, MCP bridge, build gates, and a staged rebuild plan — lives in
[`docs/architecture/`](docs/architecture/00-INDEX.md). Start with `00-INDEX.md`.

## License

AfterFrame is free software under the **GNU Affero General Public License,
version 3 or later** (`AGPL-3.0-or-later`). See [LICENSE](LICENSE).

Copyright (C) 2026 ACO Network and other contributors.

This project is a modified fork of the AGPL-3.0-or-later OpenChatCut project.
The local changes are described in [REBRAND.md](REBRAND.md), and the notice
required by AGPL-3.0 §5(a) is in [NOTICE.md](NOTICE.md).

Under AGPL-3.0 §13, if you run a modified version as a network service you must
offer the users of that service the Corresponding Source.

**Attribution is required.** Per AGPL-3.0 §7(b)/§7(d), anyone who distributes,
deploys, or hosts this software must display a credit such as
*"Built on AfterFrame — https://github.com/ACO-Network/AfterFrame"*. The exact
wording and acceptable placements are in [ADDITIONAL-TERMS.md](ADDITIONAL-TERMS.md).
Forks may say they are *based on* AfterFrame but may not use the AfterFrame name
or logo as their own product name.

Bundled third-party open-source components keep their own licenses; see
[NOTICE.md](NOTICE.md).

---

<p align="center"><sub>Built by <strong>ACO Network</strong></sub></p>
